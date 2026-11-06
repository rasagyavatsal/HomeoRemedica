package io.github.rasagyavatsal.homeoremedica.chat

import androidx.annotation.VisibleForTesting
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.rasagyavatsal.homeoremedica.api.AnswerRatings
import io.github.rasagyavatsal.homeoremedica.api.ApiException
import io.github.rasagyavatsal.homeoremedica.api.FeedbackReason
import io.github.rasagyavatsal.homeoremedica.api.Rating
import io.github.rasagyavatsal.homeoremedica.api.ChatTurn
import io.github.rasagyavatsal.homeoremedica.api.GENERIC_ERROR
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.UUID

// The server's limit on one question.
const val MAX_QUESTION_CHARS = 4_000

/** Where the composer starts counting characters. */
const val COUNTER_FROM = MAX_QUESTION_CHARS - 500

data class ChatState(
    val id: String,
    /** The first question, on one line; empty for a new chat. */
    val title: String = "",
    /** When the last answer finished, in milliseconds; 0 for a chat with no answers yet. */
    val updatedAt: Long = 0,
    val messages: List<Message> = emptyList(),
    val history: List<ChatTurn> = emptyList(),
    /** What compacting the chat condensed its earlier turns into. */
    val summary: String? = null,
    val draft: String = "",
    /** Whether the chat's earlier turns are being condensed before the latest question is answered. */
    val compacting: Boolean = false,
    /** Saved chats, newest first; null while they load. */
    val chats: List<ChatSummary>? = null,
    /** A message for the reader, such as a chat that could not be saved. */
    val notice: String? = null,
    /** Whether [notice] is about a chat just deleted, which [ChatViewModel.undoDelete] puts back. */
    val restorable: Boolean = false,
    /** The open chat's ratings, by message id. */
    val ratings: Map<Long, AnswerRatings> = emptyMap(),
    /** Whether answers can be rated, which needs a verified account. */
    val canRate: Boolean = false,
) {
    /** Whether the last answer is still streaming. */
    val busy: Boolean get() = messages.lastOrNull()?.status == MessageStatus.Streaming
}

// Ports the web app's chat hook (src/web/useChat.ts) and its saved chats (src/web/App.tsx).
class ChatViewModel(
    private val api: HomeoRemedicaApi,
    /** Where chats are saved; null while that is being worked out, such as who is signed in. */
    library: ChatLibrary?,
    private val lastChat: LastChat,
    private val io: CoroutineDispatcher = Dispatchers.IO,
    private val clock: () -> Long = System::currentTimeMillis,
    private val newId: () -> String = { UUID.randomUUID().toString() },
) : ViewModel(), Workspace {
    private val _state = MutableStateFlow(ChatState(newId()))
    val state: StateFlow<ChatState> = _state.asStateFlow()
    /** The request streaming the last answer; read from the network thread too. */
    @Volatile
    private var request: Job? = null
    /** Keeps reads and writes of the library in the order they were made. */
    private val storage = Mutex()
    private var library: ChatLibrary? = library
    /** Chats answered before there is a library to save to, saved once there is one. */
    private val unsaved = LinkedHashMap<String, SavedChat>()
    // Ratings by feedback id: the newest, which each request sends, and the ones the server has.
    private val ratings = mutableMapOf<String, AnswerRatings>()
    private val savedRatings = mutableMapOf<String, AnswerRatings>()
    /** One request at a time per answer, so they arrive in order. */
    private val ratingQueues = mutableMapOf<String, Deferred<Boolean>>()
    /** Chats whose saved ratings were loaded, or are loading. */
    private val loadedRatings = mutableSetOf<String>()
    private val ratingClient: RatingClient? get() = library as? RatingClient
    /** The chat deleted last, while it can still be put back. */
    private var deleted: Deleted? = null

    /** A deleted [chat], the library it was deleted from, and whether it was [open]. */
    private class Deleted(val chat: SavedChat, val library: ChatLibrary, val open: Boolean)

    init {
        _state.update { it.copy(canRate = library is RatingClient) }
        library?.let(::load)
    }

    /**
     * Save chats to [library] from now on, or to nowhere yet when it is null. A [fresh] workspace starts a
     * new chat and forgets the last one's answer in progress, so one person's chat never stays open for
     * the next.
     */
    override fun useLibrary(library: ChatLibrary?, fresh: Boolean) {
        if (fresh) {
            request?.cancel()
            request = null
            unsaved.clear()
            ratings.clear()
            savedRatings.clear()
            ratingQueues.clear()
            loadedRatings.clear()
            deleted = null
            _state.update { ChatState(newId(), draft = it.draft, notice = it.notice.takeUnless { _ -> it.restorable }) }
        }
        this.library = library
        _state.update { it.copy(chats = null, canRate = library is RatingClient) }
        library?.let(::load)
        loadRatings()
    }

    /** Rate an answer, or its source numbered [source] from 1; a null [rating] takes it back. */
    fun rate(messageId: Long, source: Int?, rating: Rating?) = updateRatings(messageId) { it.rated(source, rating) }

    /**
     * Say why an answer was rated as it was: [reasons] and [comment] replace the saved ones unless null, and
     * an empty comment removes it. [onSaved] hears whether the change was saved.
     */
    fun note(messageId: Long, reasons: List<FeedbackReason>? = null, comment: String? = null, onSaved: (Boolean) -> Unit = {}) =
        updateRatings(messageId, onSaved) {
            it.copy(reasons = reasons ?: it.reasons, comment = if (comment == null) it.comment else comment.trim().ifEmpty { null })
        }

    /** Change an answer's ratings at once, and undo the change if it cannot be saved. */
    private fun updateRatings(messageId: Long, onSaved: (Boolean) -> Unit = {}, change: (AnswerRatings) -> AnswerRatings) {
        val client = ratingClient ?: return onSaved(false)
        val state = _state.value
        val id = feedbackId(state.id, messageId)
        val next = change(ratings[id] ?: Unrated)
        if (feedbackFor(state.messages, messageId, next) == null) return onSaved(false)
        showRating(id, next)
        val previous = ratingQueues[id]
        // Each request sends the newest ratings, so ones made while another is sent go together.
        val request = viewModelScope.async {
            previous?.await()
            val newest = ratings[id] ?: Unrated
            if (newest == (savedRatings[id] ?: Unrated)) return@async true
            try {
                client.rate(id, feedbackFor(state.messages, messageId, newest)!!)
                savedRatings[id] = newest
                true
            } catch (failure: Exception) {
                if (!unreachable(failure)) throw failure
                showRating(id, savedRatings[id] ?: Unrated)
                notify("Your feedback could not be saved. ${reason(failure)}")
                false
            }
        }
        ratingQueues[id] = request
        viewModelScope.launch { onSaved(request.await()) }
    }

    private fun showRating(id: String, answer: AnswerRatings) {
        ratings[id] = answer
        publishRatings()
    }

    /** Show the open chat's ratings. */
    private fun publishRatings() = _state.update { state ->
        val prefix = "${state.id}-"
        state.copy(ratings = ratings.entries.filter { it.key.startsWith(prefix) }.associate { it.key.removePrefix(prefix).toLong() to it.value })
    }

    /** Load the open chat's saved ratings once; ratings given while they load win over the loaded ones. */
    private fun loadRatings() {
        val client = ratingClient ?: return
        val state = _state.value
        val chatId = state.id
        if (state.messages.isEmpty() || !loadedRatings.add(chatId)) return
        viewModelScope.launch {
            val loaded = try {
                client.ratings(chatId)
            } catch (failure: Exception) {
                if (!unreachable(failure)) throw failure
                // Tried again the next time the chat opens.
                loadedRatings -= chatId
                return@launch
            }
            if (ratingClient !== client) return@launch
            for ((messageId, answer) in loaded) {
                val id = feedbackId(chatId, messageId)
                if (id in ratings) continue
                ratings[id] = answer
                savedRatings[id] = answer
            }
            publishRatings()
        }
    }

    /** Save the chats answered meanwhile to [library], then list its chats and reopen the one open last time. */
    private fun load(library: ChatLibrary) {
        val reopen = lastChat.get()
        val pending = unsaved.values.toList()
        unsaved.clear()
        withLibrary {
            for (chat in pending) saveTo(library, chat)
            val chats = try {
                stored { library.list() }
            } catch (failure: Exception) {
                if (!unreachable(failure)) throw failure
                if (this.library === library) _state.update { it.copy(restorable = false, notice = "Your chats could not be loaded. ${reason(failure)}") }
                emptyList()
            }
            if (this.library !== library) return@withLibrary
            _state.update { it.copy(chats = chats) }
            val saved = reopen?.let { id -> attempt { stored { library.open(id) } } }
            // A chat asked meanwhile stays.
            if (saved != null && this.library === library && _state.value.messages.isEmpty()) show(saved)
        }
    }

    fun updateDraft(draft: String) = _state.update { it.copy(draft = draft.take(MAX_QUESTION_CHARS)) }

    fun submit(text: String = _state.value.draft) {
        val question = text.trim()
        val start = _state.value
        if (question.isEmpty() || start.busy) return
        val next = (start.messages.lastOrNull()?.id ?: -1) + 1
        _state.update {
            it.copy(
                title = it.title.ifEmpty { titleFrom(question) },
                draft = "",
                messages = it.messages + listOf(
                    Message(next, Role.User, question),
                    Message(next + 1, Role.Assistant, "", status = MessageStatus.Streaming),
                ),
            )
        }
        lastChat.set(start.id)

        // Started once it is the current request, so a stopped request's late pieces are ignored.
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) {
            val self = coroutineContext.job
            fun current() = request === self
            var history = start.history
            var summary = start.summary
            // A chat near the server's limits is condensed first, so its earliest turns are summarized
            // rather than dropped.
            if (shouldCompact(history, summary)) {
                _state.update { it.copy(compacting = true) }
                try {
                    val compacted = api.compactChat(history, summary)
                    if (!current()) return@launch
                    history = compacted.history
                    summary = compacted.summary
                    _state.update { it.copy(history = history, summary = summary) }
                } catch (_: ApiException) {
                    // A failure still asks, and the server drops the earliest turns instead.
                } finally {
                    if (current()) _state.update { it.copy(compacting = false) }
                }
            }
            try {
                val response = api.sendMessage(
                    question,
                    history,
                    summary,
                    onSources = { sources -> if (current()) updateAnswer { it.copy(sources = sources) } },
                    onText = { piece -> if (current()) updateAnswer { it.copy(content = it.content + piece) } },
                )
                if (!current()) return@launch
                request = null
                updateAnswer(history = response.history, settled = true) {
                    Message(it.id, Role.Assistant, response.answer, response.sources)
                }
                save()
            } catch (failure: ApiException) {
                if (!current()) return@launch
                request = null
                updateAnswer { it.copy(status = MessageStatus.Error, error = failure.message ?: GENERIC_ERROR) }
            }
        }
        request = job
        job.start()
    }

    /** Ask the failed question at the end of the chat again. */
    fun retry() {
        val messages = _state.value.messages
        val question = messages.getOrNull(messages.size - 2)
        if (messages.lastOrNull()?.status != MessageStatus.Error || question?.role != Role.User) return
        _state.update { it.copy(messages = messages.dropLast(2)) }
        submit(question.content)
    }

    /** Mark the streaming answer stopped, cancel its request and save what arrived. */
    fun stop() {
        val job = request ?: return
        request = null
        job.cancel()
        _state.update { it.copy(compacting = false) }
        updateAnswer(settled = true) { it.copy(status = MessageStatus.Stopped) }
        save()
    }

    /** Start a new chat, stopping any answer in progress. */
    fun newChat() {
        stop()
        lastChat.set(null)
        _state.update {
            ChatState(newId(), draft = it.draft, chats = it.chats, notice = it.notice, restorable = it.restorable, canRate = it.canRate)
        }
    }

    /** Show a saved chat, stopping any answer in progress. */
    fun openChat(id: String) {
        val library = library ?: return
        if (id == _state.value.id) return
        withLibrary {
            val saved = try {
                stored { library.open(id) }
            } catch (failure: Exception) {
                if (!unreachable(failure)) throw failure
                _state.update { it.copy(restorable = false, notice = "That chat could not be opened. ${reason(failure)}") }
                return@withLibrary
            }
            if (this.library !== library) return@withLibrary
            if (saved == null) {
                _state.update { state -> state.copy(chats = state.chats?.filter { it.id != id }, notice = "That chat no longer exists.", restorable = false) }
                return@withLibrary
            }
            stop()
            show(saved)
        }
    }

    /** Delete a chat; [undoDelete] puts it back while the notice that says so shows. */
    fun deleteChat(id: String) {
        val library = library ?: return
        withLibrary { delete(library, id) }
    }

    private suspend fun delete(library: ChatLibrary, id: String) {
        val chat = try {
            stored { library.open(id) }.also { stored { library.remove(id) } }
        } catch (failure: Exception) {
            if (!unreachable(failure)) throw failure
            _state.update { it.copy(restorable = false, notice = "That chat could not be deleted. ${reason(failure)}") }
            return
        }
        if (this.library !== library) return
        val open = id == _state.value.id
        deleted = chat?.let { Deleted(it, library, open) }
        _state.update { state ->
            state.copy(
                chats = state.chats?.filter { it.id != id },
                notice = if (chat != null) "Deleted “${chat.title}”." else state.notice,
                restorable = chat != null || state.restorable,
            )
        }
        if (open) newChat()
    }

    /** Put back the chat deleted last, reopening it if it was open and nothing has been asked since. */
    fun undoDelete() {
        val deleted = deleted ?: return
        this.deleted = null
        _state.update { it.copy(notice = null, restorable = false) }
        withLibrary {
            if (this.library !== deleted.library) return@withLibrary
            try {
                stored { deleted.library.save(deleted.chat) }
            } catch (failure: Exception) {
                if (!unreachable(failure)) throw failure
                _state.update { it.copy(restorable = false, notice = "That chat could not be restored. ${reason(failure)}") }
                return@withLibrary
            }
            if (this.library !== deleted.library) return@withLibrary
            val summary = deleted.chat.summarize()
            _state.update { state ->
                state.copy(chats = state.chats?.let { chats -> (chats.filter { it.id != summary.id } + summary).sortedByDescending { it.updatedAt } })
            }
            if (deleted.open && _state.value.messages.isEmpty()) show(deleted.chat)
        }
    }

    fun dismissNotice() {
        if (_state.value.restorable) deleted = null
        _state.update { it.copy(notice = null, restorable = false) }
    }

    override fun notify(message: String) = _state.update { it.copy(restorable = false, notice = message) }

    private fun show(chat: SavedChat) {
        lastChat.set(chat.id)
        _state.update {
            ChatState(
                chat.id,
                chat.title,
                chat.updatedAt,
                chat.messages,
                chat.history,
                chat.summary,
                draft = it.draft,
                chats = it.chats,
                notice = it.notice,
                restorable = it.restorable,
                canRate = it.canRate,
            )
        }
        publishRatings()
        loadRatings()
    }

    /** Save the open chat once an answer settles, listing it first. */
    private fun save() {
        val state = _state.value
        if (state.messages.isEmpty()) return
        val chat = SavedChat(state.id, state.title, state.updatedAt, savedMessages(state.messages), state.history, state.summary)
        val library = library
        if (library == null) {
            unsaved[chat.id] = chat
            return
        }
        _state.update { it.copy(chats = listOf(chat.summarize()) + it.chats.orEmpty().filter { saved -> saved.id != chat.id }) }
        withLibrary { saveTo(library, chat) }
    }

    private suspend fun saveTo(library: ChatLibrary, chat: SavedChat) {
        try {
            stored { library.save(chat) }
        } catch (failure: Exception) {
            if (!unreachable(failure)) throw failure
            _state.update { it.copy(restorable = false, notice = "This chat could not be saved. ${reason(failure)}") }
        }
    }

    /** Use the library off the main thread, after every earlier use has finished. */
    private fun withLibrary(block: suspend () -> Unit) {
        viewModelScope.launch {
            storage.withLock { block() }
        }
    }

    /** Wait until every use of the library made so far has finished. */
    @VisibleForTesting
    internal suspend fun idle() = storage.withLock {}

    private suspend fun <T> stored(read: suspend () -> T): T = withContext(io) { read() }

    /** The value of [block], or null when the library could not be reached. */
    private suspend fun <T> attempt(block: suspend () -> T): T? = try {
        block()
    } catch (failure: Exception) {
        if (!unreachable(failure)) throw failure
        null
    }

    /** Change the last message, the answer being streamed; a [settled] answer marks the chat updated. */
    private fun updateAnswer(history: List<ChatTurn>? = null, settled: Boolean = false, change: (Message) -> Message) = _state.update {
        val answer = it.messages.lastOrNull() ?: return@update it
        it.copy(
            messages = it.messages.dropLast(1) + change(answer),
            history = history ?: it.history,
            updatedAt = if (settled) clock() else it.updatedAt,
        )
    }
}

/** A library that could not be read or written: the device's storage, or the account's server. */
private fun unreachable(failure: Exception) = failure is IOException || failure is ApiException

/** What to tell the reader about a library that could not be reached. */
private fun reason(failure: Exception): String = (failure as? ApiException)?.message ?: "Please try again."

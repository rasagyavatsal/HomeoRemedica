package io.github.rasagyavatsal.homeoremedica.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.rasagyavatsal.homeoremedica.api.ApiException
import io.github.rasagyavatsal.homeoremedica.api.Book
import io.github.rasagyavatsal.homeoremedica.api.ChatTurn
import io.github.rasagyavatsal.homeoremedica.api.GENERIC_ERROR
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

val SUGGESTIONS = listOf(
    "What are the keynote symptoms of Arsenicum album?",
    "Compare Bryonia and Rhus toxicodendron for joint pain.",
    "Which remedies are worse from cold, damp weather?",
    "How is the Pulsatilla temperament described?",
)

data class ChatState(
    val books: List<Book> = emptyList(),
    val messages: List<Message> = emptyList(),
    val history: List<ChatTurn> = emptyList(),
    /** What compacting the chat condensed its earlier turns into. */
    val summary: String? = null,
    val draft: String = "",
    /** Whether the chat's earlier turns are being condensed before the latest question is answered. */
    val compacting: Boolean = false,
) {
    /** Whether the last answer is still streaming. */
    val busy: Boolean get() = messages.lastOrNull()?.status == MessageStatus.Streaming

    val canClear: Boolean get() = messages.isNotEmpty() || draft.isNotEmpty()
}

// Ports the web app's chat hook (src/web/useChat.ts).
class ChatViewModel(
    private val api: HomeoRemedicaApi,
    private val store: ConversationStore,
    savedState: SavedStateHandle,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()
    /** The request streaming the last answer; read from the network thread too. */
    @Volatile
    private var request: Job? = null

    init {
        // Saved state survives only within one task, so a fresh launch starts a new conversation.
        if (savedState.get<Boolean>(SESSION_KEY) == true) {
            store.load()?.let { saved ->
                _state.update { it.copy(messages = saved.messages, history = saved.history, summary = saved.summary) }
            }
        } else {
            store.clear()
            savedState[SESSION_KEY] = true
        }

        // The catalog only decorates the empty state, so a failed load leaves the generic copy in place.
        viewModelScope.launch {
            try {
                val books = api.loadBooks().books
                _state.update { it.copy(books = books) }
            } catch (_: ApiException) {
            }
        }

        // Saved once each answer settles, without failed questions, like the web app's saved chats.
        viewModelScope.launch {
            _state.filter { !it.busy }
                .map { SavedConversation(savedMessages(it.messages), it.history, it.summary) }
                .distinctUntilChanged()
                .collect { conversation -> withContext(io) { store.save(conversation) } }
        }
    }

    fun updateDraft(draft: String) = _state.update { it.copy(draft = draft) }

    fun submit(text: String = _state.value.draft) {
        val question = text.trim()
        val start = _state.value
        if (question.isEmpty() || start.busy) return
        val next = (start.messages.lastOrNull()?.id ?: -1) + 1
        _state.update {
            it.copy(
                draft = "",
                messages = it.messages + listOf(
                    Message(next, Role.User, question),
                    Message(next + 1, Role.Assistant, "", status = MessageStatus.Streaming),
                ),
            )
        }

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
                updateAnswer(history = response.history) {
                    Message(it.id, Role.Assistant, response.answer, response.sources)
                }
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

    /** Mark the streaming answer stopped and cancel its request. */
    fun stop() {
        val job = request ?: return
        request = null
        job.cancel()
        _state.update { it.copy(compacting = false) }
        updateAnswer { it.copy(status = MessageStatus.Stopped) }
    }

    fun clearConversation() {
        stop()
        _state.update { it.copy(messages = emptyList(), history = emptyList(), summary = null, draft = "") }
    }

    /** Change the last message, the answer being streamed. */
    private fun updateAnswer(history: List<ChatTurn>? = null, change: (Message) -> Message) = _state.update {
        val answer = it.messages.lastOrNull() ?: return@update it
        it.copy(messages = it.messages.dropLast(1) + change(answer), history = history ?: it.history)
    }

    private companion object {
        const val SESSION_KEY = "session"
    }
}

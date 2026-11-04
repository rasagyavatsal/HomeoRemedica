package io.github.rasagyavatsal.homeoremedica.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.rasagyavatsal.homeoremedica.api.ApiException
import io.github.rasagyavatsal.homeoremedica.api.Book
import io.github.rasagyavatsal.homeoremedica.api.ChatTurn
import io.github.rasagyavatsal.homeoremedica.api.Citation
import io.github.rasagyavatsal.homeoremedica.api.GENERIC_ERROR
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

val SUGGESTIONS = listOf(
    "What are the keynote symptoms of Arsenicum album?",
    "Compare Bryonia and Rhus toxicodendron for joint pain.",
    "Which remedies are worse from cold, damp weather?",
    "How is the Pulsatilla temperament described?",
)

/** The question in flight and the part of its answer streamed so far. */
data class LiveExchange(
    val question: String,
    val content: String = "",
    val sources: List<Citation> = emptyList(),
)

data class ChatState(
    val books: List<Book> = emptyList(),
    val messages: List<Message> = emptyList(),
    val history: List<ChatTurn> = emptyList(),
    val draft: String = "",
    val live: LiveExchange? = null,
    val error: String = "",
) {
    val pending: Boolean get() = live != null

    val canClear: Boolean get() = !pending && (messages.isNotEmpty() || draft.isNotEmpty())
}

class ChatViewModel(
    private val api: HomeoRemedicaApi,
    private val store: ConversationStore,
    savedState: SavedStateHandle,
    private val io: CoroutineDispatcher = Dispatchers.IO,
) : ViewModel() {
    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()
    private var nextId = 0L

    init {
        // Saved state survives only within one task, so a fresh launch starts a new conversation.
        if (savedState.get<Boolean>(SESSION_KEY) == true) {
            store.load()?.let { saved ->
                _state.update { it.copy(messages = saved.messages, history = saved.history) }
                nextId = (saved.messages.maxOfOrNull { it.id } ?: -1) + 1
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

        viewModelScope.launch {
            _state.map { SavedConversation(it.messages, it.history) }
                .distinctUntilChanged()
                .collect { conversation -> withContext(io) { store.save(conversation) } }
        }
    }

    fun updateDraft(draft: String) = _state.update { it.copy(draft = draft) }

    fun submit(text: String = _state.value.draft) {
        val message = text.trim()
        val current = _state.value
        if (message.isEmpty() || current.pending) return
        _state.update { it.copy(draft = text, error = "", live = LiveExchange(message)) }
        viewModelScope.launch {
            try {
                val response = api.sendMessage(
                    message,
                    current.history,
                    onSources = { sources -> _state.update { it.copy(live = it.live?.copy(sources = sources)) } },
                    onText = { text -> _state.update { it.copy(live = it.live?.let { live -> live.copy(content = live.content + text) }) } },
                )
                _state.update {
                    it.copy(
                        messages = it.messages + listOf(
                            Message(nextId++, Role.User, message),
                            Message(nextId++, Role.Assistant, response.answer, response.sources),
                        ),
                        history = response.history,
                        draft = "",
                        live = null,
                    )
                }
            } catch (failure: ApiException) {
                // The failed question stays in the composer to retry; the partial answer is dropped.
                _state.update { it.copy(error = failure.message ?: GENERIC_ERROR, live = null) }
            }
        }
    }

    fun clearConversation() {
        if (_state.value.pending) return
        _state.update { it.copy(messages = emptyList(), history = emptyList(), draft = "", error = "") }
    }

    private companion object {
        const val SESSION_KEY = "session"
    }
}

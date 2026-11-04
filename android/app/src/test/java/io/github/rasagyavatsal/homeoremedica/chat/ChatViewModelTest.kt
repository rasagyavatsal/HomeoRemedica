package io.github.rasagyavatsal.homeoremedica.chat

import androidx.lifecycle.SavedStateHandle
import io.github.rasagyavatsal.homeoremedica.api.ApiJson
import io.github.rasagyavatsal.homeoremedica.api.ChatRequest
import io.github.rasagyavatsal.homeoremedica.api.ChatTurn
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val server = MockWebServer()
    private val chatResponses = LinkedBlockingQueue<MockResponse>()
    private val chatRequests = mutableListOf<ChatRequest>()
    private val store = MemoryStore()

    @Before
    fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                "/api/books" -> MockResponse().setBody("""{"books":[{"bookId":"kent_lectures","title":"Kent","author":"James Tyler Kent"}]}""")
                else -> {
                    synchronized(chatRequests) { chatRequests += ApiJson.decodeFromString<ChatRequest>(request.body.readUtf8()) }
                    chatResponses.take()
                }
            }
        }
        server.start()
    }

    @After
    fun stop() {
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun viewModel(savedState: SavedStateHandle = SavedStateHandle()) =
        ChatViewModel(HomeoRemedicaApi(server.url("/").toString()), store, savedState, UnconfinedTestDispatcher())

    private fun answer(text: String, history: List<ChatTurn>) {
        val body = """{"answer":"$text","corpusVersion":"v9","model":"glm","sources":[],"history":${ApiJson.encodeToString(history)}}"""
        chatResponses += MockResponse().setHeader("Content-Type", "text/event-stream")
            .setBody("event: text\ndata: {\"text\":\"$text\"}\n\nevent: done\ndata: $body\n\n")
    }

    private suspend fun ChatViewModel.settled() = state.first { !it.pending }

    @Test
    fun sendsTheServerTrimmedHistoryWithLaterQuestions() = runTest {
        val vm = viewModel()
        val trimmed = listOf(ChatTurn(Role.User, "First?"), ChatTurn(Role.Assistant, "Trimmed."))
        answer("One.", trimmed)
        vm.submit("First?")
        vm.settled()
        answer("Two.", trimmed)
        vm.submit("Second?")
        val state = vm.settled()

        assertEquals(listOf(emptyList(), trimmed), chatRequests.map { it.history })
        assertEquals(listOf("First?", "One.", "Second?", "Two."), state.messages.map { it.content })
        assertEquals("", state.draft)
    }

    @Test
    fun keepsAFailedDraftAndHistoryForARetry() = runTest {
        val vm = viewModel()
        chatResponses += MockResponse().setResponseCode(429).setBody("""{"detail":"Too many questions."}""")
        vm.updateDraft("  Pulsatilla?  ")
        vm.submit()
        var state = vm.settled()
        assertEquals("Too many questions.", state.error)
        assertEquals("  Pulsatilla?  ", state.draft)
        assertTrue(state.messages.isEmpty())

        answer("Mild.", listOf(ChatTurn(Role.User, "Pulsatilla?"), ChatTurn(Role.Assistant, "Mild.")))
        vm.submit()
        state = vm.settled()
        assertEquals("", state.error)
        assertEquals(listOf("Pulsatilla?", "Mild."), state.messages.map { it.content })
        assertEquals(listOf("Pulsatilla?", "Pulsatilla?"), chatRequests.map { it.message })
    }

    @Test
    fun restoresTheConversationAfterTheProcessRestarts() = runTest {
        val savedState = SavedStateHandle()
        val first = viewModel(savedState)
        answer("Mild.", listOf(ChatTurn(Role.User, "Pulsatilla?"), ChatTurn(Role.Assistant, "Mild.")))
        first.submit("Pulsatilla?")
        first.settled()

        val restored = viewModel(savedState).state.value
        assertEquals(listOf("Pulsatilla?", "Mild."), restored.messages.map { it.content })
        assertEquals(2, restored.history.size)

        // A fresh launch has no saved state, so it starts over.
        assertTrue(viewModel().state.value.messages.isEmpty())
        assertNull(store.saved)
    }

    @Test
    fun loadsTheBookCatalog() = runTest {
        val vm = viewModel()
        assertEquals("James Tyler Kent", vm.state.first { it.books.isNotEmpty() }.books.single().author)
    }

    private class MemoryStore : ConversationStore {
        var saved: SavedConversation? = null
        override fun load() = saved
        override fun save(conversation: SavedConversation) {
            saved = conversation.takeIf { it.messages.isNotEmpty() }
        }
        override fun clear() {
            saved = null
        }
    }
}

package io.github.rasagyavatsal.homeoremedica.chat

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import io.github.rasagyavatsal.homeoremedica.api.ApiJson
import io.github.rasagyavatsal.homeoremedica.api.ChatRequest
import io.github.rasagyavatsal.homeoremedica.api.ChatTurn
import io.github.rasagyavatsal.homeoremedica.api.CompactRequest
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
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
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val server = MockWebServer()
    private val chatResponses = LinkedBlockingQueue<MockResponse>()
    private val chatRequests = mutableListOf<ChatRequest>()
    private val compactResponses = LinkedBlockingQueue<MockResponse>()
    private val compactRequests = mutableListOf<CompactRequest>()
    private val store = MemoryStore()
    private val viewModels = mutableListOf<ChatViewModel>()

    @Before
    fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
                "/api/books" -> MockResponse().setBody("""{"books":[{"bookId":"kent_lectures","title":"Kent","author":"James Tyler Kent"}]}""")
                "/api/chat/compact" -> {
                    synchronized(compactRequests) { compactRequests += ApiJson.decodeFromString<CompactRequest>(request.body.readUtf8()) }
                    compactResponses.take()
                }
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
        // Let stopped requests finish before Main goes away.
        runBlocking { viewModels.map { it.viewModelScope.coroutineContext.job }.forEach { it.cancelAndJoin() } }
        server.shutdown()
        Dispatchers.resetMain()
    }

    private fun viewModel(savedState: SavedStateHandle = SavedStateHandle()) =
        ChatViewModel(HomeoRemedicaApi(server.url("/").toString()), store, savedState, UnconfinedTestDispatcher())
            .also { viewModels += it }

    private fun answer(text: String, history: List<ChatTurn>) {
        val body = """{"answer":"$text","corpusVersion":"v9","model":"glm","sources":[],"history":${ApiJson.encodeToString(history)}}"""
        chatResponses += MockResponse().setHeader("Content-Type", "text/event-stream")
            .setBody("event: text\ndata: {\"text\":\"$text\"}\n\nevent: done\ndata: $body\n\n")
    }

    private suspend fun ChatViewModel.settled() = state.first { !it.busy }

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

    /** A history as long as the server keeps, which is past the point of compacting. */
    private fun fullHistory(count: Int = 16) = List(count) { index ->
        ChatTurn(if (index % 2 == 0) Role.User else Role.Assistant, "Turn $index")
    }

    @Test
    fun compactsALongChatBeforeTheNextQuestion() = runTest {
        val vm = viewModel()
        answer("One.", fullHistory())
        vm.submit("First?")
        vm.settled()

        val kept = fullHistory().takeLast(2)
        compactResponses += MockResponse().setBody("""{"summary":"Earlier turns.","history":${ApiJson.encodeToString(kept)}}""")
        answer("Two.", kept + listOf(ChatTurn(Role.User, "Second?"), ChatTurn(Role.Assistant, "Two.")))
        vm.submit("Second?")
        val state = vm.settled()

        assertEquals(listOf(CompactRequest(fullHistory())), compactRequests)
        assertEquals(kept, chatRequests.last().history)
        assertEquals("Earlier turns.", chatRequests.last().summary)
        assertEquals("Earlier turns.", state.summary)
        assertFalse(state.compacting)
        assertEquals("Earlier turns.", store.saved?.summary)
    }

    @Test
    fun asksAnywayWhenCompactingFails() = runTest {
        val vm = viewModel()
        answer("One.", fullHistory())
        vm.submit("First?")
        vm.settled()

        compactResponses += MockResponse().setResponseCode(502)
        answer("Two.", fullHistory())
        vm.submit("Second?")
        val state = vm.settled()

        assertEquals(fullHistory(), chatRequests.last().history)
        assertNull(chatRequests.last().summary)
        assertEquals("Two.", state.messages.last().content)
        assertFalse(state.compacting)
    }

    @Test
    fun compactsOnlyNearTheServerLimits() {
        assertFalse(shouldCompact(fullHistory(14), null))
        assertTrue(shouldCompact(fullHistory(16), null))
        val long = listOf(ChatTurn(Role.User, "x".repeat(6_500)), ChatTurn(Role.Assistant, "y".repeat(6_500)))
        // Only turns older than the latest exchange can be condensed.
        assertFalse(shouldCompact(long, null))
        assertTrue(shouldCompact(long + long, null))
        assertTrue(shouldCompact(fullHistory(4), "z".repeat(13_000)))
    }

    @Test
    fun showsAFailureOnTheAnswerAndRetriesIt() = runTest {
        val vm = viewModel()
        chatResponses += MockResponse().setResponseCode(429).setBody("""{"detail":"Too many questions."}""")
        vm.updateDraft("  Pulsatilla?  ")
        vm.submit()
        var state = vm.settled()
        assertEquals(MessageStatus.Error, state.messages.last().status)
        assertEquals("Too many questions.", state.messages.last().error)
        assertEquals("", state.draft)
        // A failed question is not kept.
        assertNull(store.saved)

        answer("Mild.", listOf(ChatTurn(Role.User, "Pulsatilla?"), ChatTurn(Role.Assistant, "Mild.")))
        vm.retry()
        state = vm.settled()
        assertEquals(listOf("Pulsatilla?", "Mild."), state.messages.map { it.content })
        assertNull(state.messages.last().status)
        assertEquals(listOf("Pulsatilla?", "Pulsatilla?"), chatRequests.map { it.message })
    }

    @Test
    fun stopsAnAnswerAndKeepsWhatArrived() = runTest {
        val vm = viewModel()
        val first = "event: text\ndata: {\"text\":\"Mild\"}\n\n"
        // The first piece arrives at once; the rest would take a minute.
        chatResponses += MockResponse().setHeader("Content-Type", "text/event-stream")
            .setBody(first + "event: text\ndata: {\"text\":\" and gentle.\"}\n\n")
            .throttleBody(first.length.toLong(), 60, TimeUnit.SECONDS)
        vm.submit("Pulsatilla?")
        vm.state.first { it.messages.last().content == "Mild" }

        vm.stop()
        val state = vm.state.value
        assertFalse(state.busy)
        assertEquals(MessageStatus.Stopped, state.messages.last().status)
        assertEquals("Mild", state.messages.last().content)
        assertEquals(listOf("Pulsatilla?", "Mild"), store.saved?.messages?.map { it.content })
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

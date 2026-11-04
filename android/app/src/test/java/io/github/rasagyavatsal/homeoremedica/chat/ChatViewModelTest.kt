package io.github.rasagyavatsal.homeoremedica.chat

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
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
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
import java.io.IOException
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

@OptIn(ExperimentalCoroutinesApi::class)
class ChatViewModelTest {
    private val server = MockWebServer()
    private val chatResponses = LinkedBlockingQueue<MockResponse>()
    private val chatRequests = mutableListOf<ChatRequest>()
    private val compactResponses = LinkedBlockingQueue<MockResponse>()
    private val compactRequests = mutableListOf<CompactRequest>()
    private val library = MemoryLibrary()
    private val lastChat = MemoryLastChat()
    private var now = 1_000L
    private var ids = 0
    private val viewModels = mutableListOf<ChatViewModel>()

    @Before
    fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = when (request.path) {
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

    private fun viewModel(library: ChatLibrary? = this.library) =
        ChatViewModel(
            HomeoRemedicaApi(server.url("/").toString()),
            library,
            lastChat,
            UnconfinedTestDispatcher(),
            clock = { now++ },
            newId = { "chat-${ids++}" },
        ).also { viewModels += it }

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
        assertEquals("Earlier turns.", library.awaitSaved { it.singleOrNull()?.messages?.size == 4 }.single().summary)
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
        assertTrue(library.chats.value.isEmpty())

        answer("Mild.", listOf(ChatTurn(Role.User, "Pulsatilla?"), ChatTurn(Role.Assistant, "Mild.")))
        vm.retry()
        state = vm.settled()
        assertEquals(listOf("Pulsatilla?", "Mild."), state.messages.map { it.content })
        assertNull(state.messages.last().status)
        assertEquals(listOf("Pulsatilla?", "Pulsatilla?"), chatRequests.map { it.message })
    }

    @Test
    fun showsTheServerRateLimits() = runTest {
        // The server limits each client, and every client together to a daily total.
        val limits = listOf(
            "Too many questions in a short time. Please wait a minute and try again.",
            "HomeoRemedica has answered all the questions it can for now. Please try again later.",
        )
        val vm = viewModel()
        for (detail in limits) {
            chatResponses += MockResponse().setResponseCode(429).setHeader("Retry-After", "60").setBody("""{"detail":"$detail"}""")
            vm.submit("Pulsatilla?")
            assertEquals(detail, vm.settled().messages.last().error)
            vm.newChat()
        }
    }

    @Test
    fun asksAnywayWhenCompactingIsRateLimited() = runTest {
        val vm = viewModel()
        answer("One.", fullHistory())
        vm.submit("First?")
        vm.settled()

        // Compacting counts as a question, so a client at its limit is refused both.
        val detail = "Too many questions in a short time. Please wait a minute and try again."
        compactResponses += MockResponse().setResponseCode(429).setBody("""{"detail":"$detail"}""")
        chatResponses += MockResponse().setResponseCode(429).setBody("""{"detail":"$detail"}""")
        vm.submit("Second?")

        assertEquals(detail, vm.settled().messages.last().error)
        assertEquals(1, compactRequests.size)
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
        assertEquals(listOf("Pulsatilla?", "Mild"), library.awaitSaved { it.isNotEmpty() }.single().messages.map { it.content })
    }

    private suspend fun ChatViewModel.ask(question: String, reply: String) {
        answer(reply, listOf(ChatTurn(Role.User, question), ChatTurn(Role.Assistant, reply)))
        submit(question)
        val id = settled().id
        // Saving finishes after the answer does.
        library.awaitSaved { chats -> chats.any { it.id == id && it.messages.last().content == reply } }
    }

    @Test
    fun savesEachChatNewestFirstWithItsTitle() = runTest {
        val vm = viewModel()
        vm.ask("  Pulsatilla\n  in   children? ", "Mild.")
        vm.newChat()
        vm.ask("Sepia?", "Indifferent.")

        val chats = vm.state.value.chats.orEmpty()
        assertEquals(listOf("Sepia?", "Pulsatilla in children?"), chats.map { it.title })
        assertEquals(library.list(), chats)
        assertEquals(listOf("Sepia?", "Indifferent."), library.open(chats[0].id)?.messages?.map { it.content })
    }

    @Test
    fun reopensTheLastChatOnTheNextLaunch() = runTest {
        val first = viewModel()
        first.ask("Pulsatilla?", "Mild.")

        val reopened = viewModel().state.value
        assertEquals(first.state.value.id, reopened.id)
        assertEquals(listOf("Pulsatilla?", "Mild."), reopened.messages.map { it.content })
        assertEquals(2, reopened.history.size)
        assertEquals("Pulsatilla?", reopened.title)

        // A new chat is not reopened until it has a question.
        first.newChat()
        assertTrue(viewModel().state.value.messages.isEmpty())
    }

    @Test
    fun opensASavedChatAndKeepsTheDraft() = runTest {
        val vm = viewModel()
        vm.ask("Pulsatilla?", "Mild.")
        val pulsatilla = vm.state.value.id
        vm.newChat()
        vm.ask("Sepia?", "Indifferent.")
        vm.updateDraft("Next")

        vm.openChat(pulsatilla)
        val state = vm.state.value
        assertEquals(pulsatilla, state.id)
        assertEquals(listOf("Pulsatilla?", "Mild."), state.messages.map { it.content })
        assertEquals("Next", state.draft)
        assertEquals(pulsatilla, lastChat.id)
    }

    @Test
    fun deletesChatsAndStartsANewOneForTheOpenChat() = runTest {
        val vm = viewModel()
        vm.ask("Pulsatilla?", "Mild.")
        val pulsatilla = vm.state.value.id
        vm.newChat()
        vm.ask("Sepia?", "Indifferent.")
        val sepia = vm.state.value.id

        vm.deleteChat(pulsatilla)
        assertEquals(sepia, vm.state.value.id)
        assertEquals(listOf(sepia), vm.state.value.chats?.map { it.id })

        vm.deleteChat(sepia)
        assertTrue(vm.state.value.messages.isEmpty())
        assertTrue(vm.state.value.chats.orEmpty().isEmpty())
        assertTrue(library.chats.value.isEmpty())
        assertNull(lastChat.id)
    }

    @Test
    fun saysWhenAChatNoLongerExists() = runTest {
        val vm = viewModel()
        vm.ask("Pulsatilla?", "Mild.")
        val pulsatilla = vm.state.value.id
        vm.newChat()
        library.remove(pulsatilla)

        vm.openChat(pulsatilla)
        assertEquals("That chat no longer exists.", vm.state.value.notice)
        assertTrue(vm.state.value.chats.orEmpty().isEmpty())
        vm.dismissNotice()
        assertNull(vm.state.value.notice)
    }

    @Test
    fun saysWhenAChatCannotBeSaved() = runTest {
        library.full = true
        val vm = viewModel()
        answer("Mild.", emptyList())
        vm.submit("Pulsatilla?")
        assertEquals("This chat could not be saved. Please try again.", vm.state.first { it.notice != null }.notice)
    }

    @Test
    fun limitsTheDraftToTheServerLimit() {
        val vm = viewModel()
        vm.updateDraft("a".repeat(MAX_QUESTION_CHARS + 10))
        assertEquals(MAX_QUESTION_CHARS, vm.state.value.draft.length)
    }

    @Test
    fun savesChatsAnsweredBeforeThereIsALibraryOnceThereIsOne() = runTest {
        val vm = viewModel(library = null)
        answer("Mild.", emptyList())
        vm.submit("Pulsatilla?")
        val id = vm.settled().id
        assertNull(vm.state.value.chats)

        vm.useLibrary(library, fresh = false)
        assertEquals(listOf(id), library.awaitSaved { it.isNotEmpty() }.map { it.id })
        assertEquals(listOf(id), vm.state.first { it.chats != null }.chats!!.map { it.id })
        // The chat stays open.
        assertEquals(id, vm.state.value.id)
    }

    @Test
    fun aFreshWorkspaceStartsANewChatFromTheOtherLibrary() = runTest {
        val vm = viewModel()
        answer("Mild.", emptyList())
        vm.submit("Pulsatilla?")
        val first = vm.settled()
        library.awaitSaved { it.isNotEmpty() }

        val other = MemoryLibrary()
        other.save(SavedChat("theirs", "Sepia?", 5, listOf(Message(0, Role.User, "Sepia?")), emptyList()))
        vm.useLibrary(other, fresh = true)
        val state = vm.state.first { it.chats != null }
        assertTrue(state.id != first.id)
        assertTrue(state.messages.isEmpty())
        assertEquals(listOf("theirs"), state.chats!!.map { it.id })
    }

    private class MemoryLibrary : ChatLibrary {
        val chats = MutableStateFlow(emptyList<SavedChat>())
        @Volatile
        var full = false
        override suspend fun list() = chats.value.sortedByDescending { it.updatedAt }.map { it.summarize() }
        override suspend fun open(id: String) = chats.value.find { it.id == id }
        override suspend fun save(chat: SavedChat) {
            if (full) throw IOException("Full")
            chats.update { saved -> saved.filter { it.id != chat.id } + chat }
        }
        override suspend fun remove(id: String) = chats.update { saved -> saved.filter { it.id != id } }

        /** The saved chats once they match [done]; saves finish on another thread. */
        suspend fun awaitSaved(done: (List<SavedChat>) -> Boolean): List<SavedChat> = chats.first(done)
    }

    private class MemoryLastChat : LastChat {
        var id: String? = null
        override fun get() = id
        override fun set(id: String?) {
            this.id = id
        }
    }
}

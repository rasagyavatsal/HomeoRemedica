package io.github.rasagyavatsal.homeoremedica.api

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okio.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test

class HomeoRemedicaApiTest {
    private val server = MockWebServer()
    private lateinit var api: HomeoRemedicaApi

    @Before
    fun start() {
        server.start()
        api = HomeoRemedicaApi(server.url("/").toString())
    }

    @After
    fun stop() = server.shutdown()

    private val citation = """{"id":"kent_lectures:12","bookId":"kent_lectures","bookTitle":"Kent, Lectures","author":"James Tyler Kent","remedyName":"Pulsatilla","sectionTitle":"Mind","passageIndexes":[3],"text":"Mild, gentle, yielding."}"""
    private val done = """{"answer":"Mild [1].","corpusVersion":"v9","model":"glm","sources":[$citation],"history":[{"role":"user","content":"Pulsatilla?"},{"role":"assistant","content":"Mild [1]."}]}"""

    private fun stream(vararg events: Pair<String, String>) = MockResponse()
        .setHeader("Content-Type", "text/event-stream")
        .setBody(events.joinToString("") { (event, data) -> "event: $event\ndata: $data\n\n" })

    @Test
    fun streamsSourcesThenTextThenTheFullResponse() = runTest {
        server.enqueue(stream("sources" to "[$citation]", "text" to """{"text":"Mild "}""", "text" to """{"text":"[1]."}""", "done" to done))
        val sources = mutableListOf<List<Citation>>()
        val text = StringBuilder()

        val response = api.sendMessage("Pulsatilla?", emptyList(), onSources = { sources += it }, onText = { text.append(it) })

        assertEquals("Pulsatilla", sources.single().single().remedyName)
        assertEquals("Mild [1].", text.toString())
        assertEquals("Mild [1].", response.answer)
        assertEquals(listOf(Role.User, Role.Assistant), response.history.map { it.role })
        val request = server.takeRequest()
        assertEquals("/api/chat", request.path)
        assertEquals("text/event-stream", request.getHeader("Accept"))
        assertEquals("""{"message":"Pulsatilla?","history":[]}""", request.body.readUtf8())
    }

    @Test
    fun sendsHistoryWithTheQuestion() = runTest {
        server.enqueue(stream("done" to done))
        api.sendMessage("And Sepia?", listOf(ChatTurn(Role.User, "Pulsatilla?"), ChatTurn(Role.Assistant, "Mild.")))
        assertEquals(
            """{"message":"And Sepia?","history":[{"role":"user","content":"Pulsatilla?"},{"role":"assistant","content":"Mild."}]}""",
            server.takeRequest().body.readUtf8(),
        )
    }

    @Test
    fun sendsTheSummaryOfACompactedChat() = runTest {
        server.enqueue(stream("done" to done))
        api.sendMessage("And Sepia?", emptyList(), summary = "Asked about Pulsatilla.")
        assertEquals(
            """{"message":"And Sepia?","history":[],"summary":"Asked about Pulsatilla."}""",
            server.takeRequest().body.readUtf8(),
        )
    }

    @Test
    fun acceptsAResponseThatDoesNotStream() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(done))
        assertEquals("Mild [1].", api.sendMessage("Pulsatilla?", emptyList()).answer)
    }

    @Test
    fun reportsTheServerDetailOfARejectedRequest() = runTest {
        server.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "30")
            .setBody("""{"detail":"Too many questions in a short time. Please wait a minute and try again."}"""))
        assertFailsWith("Too many questions in a short time. Please wait a minute and try again.") {
            api.sendMessage("Pulsatilla?", emptyList())
        }
    }

    @Test
    fun joinsValidationMessages() = runTest {
        server.enqueue(MockResponse().setResponseCode(422).setBody("""{"detail":[{"msg":"message must not be blank"},{"msg":"history is too long"}]}"""))
        assertFailsWith("message must not be blank history is too long") { api.sendMessage(" ", emptyList()) }
    }

    @Test
    fun fallsBackToAGenericMessageWithoutADetail() = runTest {
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>Bad gateway</html>"))
        assertFailsWith(GENERIC_ERROR) { api.sendMessage("Pulsatilla?", emptyList()) }
    }

    @Test
    fun reportsAnErrorEvent() = runTest {
        server.enqueue(stream("sources" to "[]", "error" to """{"detail":"The answer service is unavailable."}"""))
        assertFailsWith("The answer service is unavailable.") { api.sendMessage("Pulsatilla?", emptyList()) }
    }

    @Test
    fun reportsAStreamThatEndsWithoutAnAnswer() = runTest {
        server.enqueue(stream("sources" to "[]", "text" to """{"text":"Mild"}"""))
        assertFailsWith(INTERRUPTED_ERROR) { api.sendMessage("Pulsatilla?", emptyList()) }
    }

    @Test
    fun rejectsAMalformedResponse() = runTest {
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody("""{"answer":1}"""))
        assertFailsWith(INVALID_RESPONSE_ERROR) { api.sendMessage("Pulsatilla?", emptyList()) }
    }

    @Test
    fun reportsAnUnreachableServer() = runTest {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))
        assertFailsWith(NETWORK_ERROR) { api.sendMessage("Pulsatilla?", emptyList()) }
    }

    @Test
    fun readsMultilineAndCrlfEvents() {
        val reader = ServerSentEventReader(Buffer().writeUtf8(": comment\r\n\r\nevent: text\r\ndata: one\r\ndata:two\r\n\r\ndata: last"))
        assertEquals(ServerSentEvent("text", "one\ntwo"), reader.next())
        assertEquals(ServerSentEvent("message", "last"), reader.next())
        assertNull(reader.next())
    }

    private suspend fun assertFailsWith(message: String, block: suspend () -> Unit) {
        try {
            block()
        } catch (failure: ApiException) {
            assertEquals(message, failure.message)
            return
        }
        fail("expected ApiException: $message")
    }
}

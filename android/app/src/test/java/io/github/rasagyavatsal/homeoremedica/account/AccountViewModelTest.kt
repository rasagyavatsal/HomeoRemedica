package io.github.rasagyavatsal.homeoremedica.account

import io.github.rasagyavatsal.homeoremedica.api.Citation
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.api.Role
import io.github.rasagyavatsal.homeoremedica.chat.AccountLibrary
import io.github.rasagyavatsal.homeoremedica.chat.ChatLibrary
import io.github.rasagyavatsal.homeoremedica.chat.ChatSummary
import io.github.rasagyavatsal.homeoremedica.chat.LastChat
import io.github.rasagyavatsal.homeoremedica.chat.Message
import io.github.rasagyavatsal.homeoremedica.chat.MessageStatus
import io.github.rasagyavatsal.homeoremedica.chat.SavedChat
import io.github.rasagyavatsal.homeoremedica.chat.Workspace
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
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
import java.util.Collections

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {
    private val server = MockWebServer()
    private val requests = Collections.synchronizedList(mutableListOf<RecordedRequest>())
    private var failDeletes = false
    /** Chat ids the server refuses to save. */
    private val refused = mutableSetOf<String>()
    private val local = MemoryLibrary()
    private val workspace = RecordingWorkspace()

    @Before
    fun start() {
        Dispatchers.setMain(UnconfinedTestDispatcher())
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                requests += request
                val id = request.path!!.substringAfterLast('/')
                return when {
                    request.method == "PUT" && id in refused -> MockResponse().setResponseCode(413).setBody("""{"detail":"This chat is too long to save."}""")
                    request.method == "DELETE" && failDeletes ->
                        MockResponse().setResponseCode(500).setBody("""{"detail":"Your saved chats could not be reached. Please try again."}""")
                    request.method == "PUT" -> MockResponse().setBody("""{"id":"$id","title":"T","updatedAt":1}""")
                    request.path == "/api/chats" -> MockResponse().setBody("""{"chats":[]}""")
                    else -> MockResponse().setResponseCode(204)
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

    private val lastChat = object : LastChat {
        var id: String? = "open"
        override fun get() = id
        override fun set(id: String?) {
            this.id = id
        }
    }

    private fun viewModel(auth: AuthClient?) = AccountViewModel(
        auth,
        workspace,
        local,
        remote = { client -> AccountLibrary(HomeoRemedicaApi(server.url("/").toString()), client::token) },
        lastChat = lastChat,
    )

    private val verified = Account("u1", "a@b.co", null, verified = true)
    private val unverified = verified.copy(verified = false)

    private fun chat(id: String) = SavedChat(
        id,
        "Chat $id",
        1,
        listOf(
            Message(0, Role.User, "Pulsatilla?"),
            Message(1, Role.Assistant, "Mild [1]", listOf(Citation("v9/b/c", "b", "Book", null, "Pulsatilla", "Mind", listOf(1), "Text"))),
            Message(2, Role.User, "And Sepia?"),
            Message(3, Role.Assistant, "Ind", status = MessageStatus.Stopped),
        ),
        emptyList(),
    )

    @Test
    fun withoutAccountsChatsStayOnTheDevice() {
        val state = viewModel(null).state.value
        assertFalse(state.available)
        assertNull(state.account)
        assertEquals(listOf(Use(local, fresh = false)), workspace.uses)
    }

    @Test
    fun asksForVerificationAndKeepsChatsOnTheDeviceUntilThen() = runBlocking {
        val auth = FakeAuth(unverified)
        local.save(chat("a"))
        val vm = viewModel(auth)
        assertEquals(listOf(VERIFY_NOTICE), workspace.notices)
        assertEquals(listOf(Use(local, fresh = false)), workspace.uses)

        auth.verifiedOnRefresh = true
        vm.refresh()
        assertTrue(vm.state.value.account!!.verified)
        // Verifying moves the chats into the account, in a fresh workspace.
        val account = workspace.awaitAccount()
        assertEquals(listOf(Use(local, false), Use(null, true), Use(account, false)), workspace.uses)
        assertTrue(local.list().isEmpty())
        // Verified accounts are not checked again.
        vm.refresh()
        assertEquals(listOf("refresh"), auth.calls)
    }

    @Test
    fun movesTheDevicesChatsIntoTheAccountAsTheServerWantsThem() = runBlocking {
        local.save(chat("a"))
        viewModel(FakeAuth(verified))
        workspace.awaitAccount()

        // Signed in as the app opens: not a change of account.
        assertEquals(Use(null, fresh = false), workspace.uses.first())
        val put = requests.single { it.method == "PUT" }
        assertEquals("/api/chats/a", put.path)
        assertEquals("Bearer token-u1", put.getHeader("Authorization"))
        val body = Json.parseToJsonElement(put.body.readUtf8()).jsonObject
        assertEquals(setOf("title", "updatedAt", "messages", "history"), body.keys)
        val messages = body["messages"]!!.jsonArray.map { it.jsonObject }
        // Questions have no sources, answers keep theirs with every field, and no message keeps its status.
        assertEquals(setOf("id", "role", "content"), messages[0].keys)
        assertEquals(JsonNull, messages[1]["sources"]!!.jsonArray[0].jsonObject["author"])
        assertTrue(messages.none { "status" in it })
        assertTrue(local.list().isEmpty())
    }

    @Test
    fun keepsChatsThatCouldNotBeMovedOnTheDevice() = runBlocking {
        for (id in listOf("a", "b", "c")) local.save(chat(id))
        refused += listOf("b", "c")
        viewModel(FakeAuth(verified))
        workspace.awaitAccount()

        assertEquals(listOf("b", "c"), local.list().map { it.id }.sorted())
        assertEquals(listOf("2 chats on this device could not be moved into your account."), workspace.notices)
    }

    @Test
    fun signingOutReturnsToTheDevicesChatsInAFreshWorkspace() = runBlocking {
        val auth = FakeAuth(verified)
        viewModel(auth)
        workspace.awaitAccount()
        auth.signOut()
        assertEquals(Use(local, fresh = true), workspace.uses.last())
    }

    @Test
    fun deletesTheAccountThenSignsOut() = runBlocking {
        val auth = FakeAuth(unverified)
        viewModel(auth).deleteAccount()
        val delete = requests.single { it.method == "DELETE" }
        assertEquals("/api/account", delete.path)
        assertEquals("Bearer token-u1", delete.getHeader("Authorization"))
        assertEquals(listOf("signOut"), auth.calls)
        assertNull(lastChat.id)
        assertEquals("Your account and its chats were deleted.", workspace.notices.last())
    }

    @Test
    fun keepsTheAccountWhenItCouldNotBeDeleted() = runBlocking {
        val auth = FakeAuth(unverified)
        failDeletes = true
        val failure = runCatching { viewModel(auth).deleteAccount() }.exceptionOrNull()
        assertEquals("Your saved chats could not be reached. Please try again.", failure?.message)
        assertTrue(auth.calls.isEmpty())
        assertEquals("open", lastChat.id)
    }

    @Test
    fun resendsTheVerificationLink() {
        val auth = FakeAuth(unverified)
        val vm = viewModel(auth)
        vm.resendVerification()
        auth.failure = AuthException("Too many attempts. Wait a moment and try again.")
        vm.resendVerification()
        assertEquals(
            listOf(VERIFY_NOTICE, "A new verification link was sent to a@b.co.", "Too many attempts. Wait a moment and try again."),
            workspace.notices,
        )
    }

    private data class Use(val library: ChatLibrary?, val fresh: Boolean)

    private class RecordingWorkspace : Workspace {
        val uses = Collections.synchronizedList(mutableListOf<Use>())
        val notices = mutableListOf<String>()
        private val account = MutableStateFlow<AccountLibrary?>(null)

        override fun useLibrary(library: ChatLibrary?, fresh: Boolean) {
            uses += Use(library, fresh)
            if (library is AccountLibrary) account.value = library
        }

        override fun notify(message: String) {
            notices += message
        }

        /** The account library, once the device's chats have been moved into it on another thread. */
        suspend fun awaitAccount(): AccountLibrary = withTimeout(5_000) { account.first { it != null }!! }
    }

    private class MemoryLibrary : ChatLibrary {
        private val chats = Collections.synchronizedMap(linkedMapOf<String, SavedChat>())
        override suspend fun list() = chats.values.map { ChatSummary(it.id, it.title, it.updatedAt) }
        override suspend fun open(id: String) = chats[id]
        override suspend fun save(chat: SavedChat) {
            chats[chat.id] = chat
        }
        override suspend fun remove(id: String) {
            chats.remove(id)
        }
    }
}

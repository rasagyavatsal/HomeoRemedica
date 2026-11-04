package io.github.rasagyavatsal.homeoremedica.account

import io.github.rasagyavatsal.homeoremedica.chat.Workspace
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AccountViewModelTest {
    private val notices = mutableListOf<String>()
    private val workspace = object : Workspace {
        override fun notify(message: String) {
            notices += message
        }
    }

    @Before
    fun start() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun stop() = Dispatchers.resetMain()

    private val unverified = Account("u1", "a@b.co", null, verified = false)

    @Test
    fun withoutAccountsTheAppIsAGuest() {
        val state = AccountViewModel(null, workspace).state.value
        assertFalse(state.available)
        assertEquals(null, state.account)
    }

    @Test
    fun asksForVerificationOnceAndChecksWhenTheAppReturns() {
        val auth = FakeAuth(unverified)
        val vm = AccountViewModel(auth, workspace)
        assertEquals(listOf(VERIFY_NOTICE), notices)

        auth.verifiedOnRefresh = true
        vm.refresh()
        assertTrue(vm.state.value.account!!.verified)
        // Verified accounts are not checked again.
        vm.refresh()
        assertEquals(listOf("refresh"), auth.calls)
        assertEquals(listOf(VERIFY_NOTICE), notices)
    }

    @Test
    fun resendsTheVerificationLink() {
        val auth = FakeAuth(unverified)
        val vm = AccountViewModel(auth, workspace)
        vm.resendVerification()
        auth.failure = AuthException("Too many attempts. Wait a moment and try again.")
        vm.resendVerification()
        assertEquals(
            listOf(VERIFY_NOTICE, "A new verification link was sent to a@b.co.", "Too many attempts. Wait a moment and try again."),
            notices,
        )
    }
}

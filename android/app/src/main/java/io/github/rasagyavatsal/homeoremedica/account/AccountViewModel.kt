package io.github.rasagyavatsal.homeoremedica.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.rasagyavatsal.homeoremedica.chat.AccountLibrary
import io.github.rasagyavatsal.homeoremedica.chat.ChatLibrary
import io.github.rasagyavatsal.homeoremedica.chat.LastChat
import io.github.rasagyavatsal.homeoremedica.chat.Workspace
import io.github.rasagyavatsal.homeoremedica.chat.moveIntoAccount
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** Who is signed in, and what the account menu shows. */
data class AccountState(
    /** Whether this build has accounts; without them chats stay on the device. */
    val available: Boolean,
    val account: Account?,
)

const val VERIFY_NOTICE = "Verify your email address to sync your chats. The link is in your inbox."

// Ports the web app's account handling (src/web/App.tsx).
class AccountViewModel(
    /** Null when this build has no accounts. */
    val auth: AuthClient?,
    private val workspace: Workspace,
    /** The chats saved on the device. */
    private val local: ChatLibrary,
    /** The signed-in account's chats. */
    private val remote: (AuthClient) -> AccountLibrary,
    private val lastChat: LastChat,
) : ViewModel() {
    val state: StateFlow<AccountState> = (auth?.account ?: MutableStateFlow(null))
        .map { AccountState(auth != null, it) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, AccountState(auth != null, auth?.account?.value))

    init {
        // Signed in with a verified email: move the device's chats into the account before showing the
        // account's. Learning who is signed in as the app opens is no change of account, so a chat asked
        // meanwhile stays.
        viewModelScope.launch {
            var known = false
            state.map { it.account?.takeIf(Account::verified)?.uid }.distinctUntilChanged().collectLatest { uid ->
                val fresh = known
                known = true
                if (uid == null || auth == null) {
                    workspace.useLibrary(local, fresh)
                    return@collectLatest
                }
                workspace.useLibrary(null, fresh)
                val account = remote(auth)
                val failed = moveIntoAccount(local, account)
                if (failed > 0) {
                    workspace.notify("${if (failed == 1) "One chat" else "$failed chats"} on this device could not be moved into your account.")
                }
                workspace.useLibrary(account, fresh = false)
            }
        }
        // Until the email is verified, chats stay on the device.
        viewModelScope.launch {
            state.map { it.account?.takeUnless(Account::verified)?.uid }.distinctUntilChanged().collect { unverified ->
                if (unverified != null) workspace.notify(VERIFY_NOTICE)
            }
        }
    }

    /** Check for a verification made elsewhere, such as from the link in the email, when the app returns. */
    fun refresh() {
        val auth = auth ?: return
        if (state.value.account?.verified != false) return
        viewModelScope.launch {
            try {
                auth.refresh()
            } catch (_: AuthException) {
                // Checked again the next time the app returns.
            }
        }
    }

    fun signOut() {
        val auth = auth ?: return
        viewModelScope.launch {
            try {
                auth.signOut()
            } catch (failure: AuthException) {
                workspace.notify("Signing out failed. ${failure.message ?: "Please try again."}")
            }
        }
    }

    /** Delete the account and every chat saved to it; throws [ApiException] with a message to show if it cannot. */
    suspend fun deleteAccount() {
        val auth = auth ?: return
        // An unverified account has no chats in it yet, but can still be deleted.
        remote(auth).deleteAccount()
        lastChat.set(null)
        try {
            auth.signOut()
        } catch (_: AuthException) {
            // The account is gone either way.
        }
        workspace.notify("Your account and its chats were deleted.")
    }

    fun resendVerification() {
        val auth = auth ?: return
        viewModelScope.launch {
            try {
                auth.sendVerification()
                workspace.notify("A new verification link was sent to ${state.value.account?.email ?: "your email address"}.")
            } catch (failure: AuthException) {
                workspace.notify(failure.message ?: "The link could not be sent. Please try again.")
            }
        }
    }
}

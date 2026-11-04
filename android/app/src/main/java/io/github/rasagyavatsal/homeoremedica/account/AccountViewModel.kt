package io.github.rasagyavatsal.homeoremedica.account

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.github.rasagyavatsal.homeoremedica.chat.Workspace
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
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
) : ViewModel() {
    val state: StateFlow<AccountState> = (auth?.account ?: MutableStateFlow(null))
        .map { AccountState(auth != null, it) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, AccountState(auth != null, auth?.account?.value))

    init {
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

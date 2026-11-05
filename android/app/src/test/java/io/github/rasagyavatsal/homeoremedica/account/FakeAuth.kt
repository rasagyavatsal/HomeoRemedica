package io.github.rasagyavatsal.homeoremedica.account

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow

/** An [AuthClient] whose account the test sets. */
class FakeAuth(account: Account? = null) : AuthClient {
    override val account = MutableStateFlow(account)
    override val google = false
    var verifiedOnRefresh = false
    var failure: AuthException? = null
    val calls = mutableListOf<String>()

    override suspend fun token(): String = failure?.let { throw it } ?: "token-${account.value?.uid}"

    override suspend fun signIn(email: String, password: String) {
        calls += "signIn"
    }

    override suspend fun signUp(email: String, password: String) {
        calls += "signUp"
    }

    override suspend fun signInWithGoogle(context: Context) {
        calls += "google"
    }

    override suspend fun sendVerification() {
        calls += "sendVerification"
        failure?.let { throw it }
    }

    override suspend fun refresh() {
        calls += "refresh"
        if (verifiedOnRefresh) account.value = account.value?.copy(verified = true)
    }

    override suspend fun resetPassword(email: String) {
        calls += "resetPassword"
    }

    override suspend fun signOut() {
        calls += "signOut"
        account.value = null
    }
}

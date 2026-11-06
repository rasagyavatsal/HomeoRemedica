package io.github.rasagyavatsal.homeoremedica.account

import android.annotation.SuppressLint
import android.content.Context
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.FirebaseTooManyRequestsException
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await
import io.github.rasagyavatsal.homeoremedica.BuildConfig

/** Sign-in through the Firebase project the build was configured with. */
class FirebaseAuthClient private constructor(
    private val auth: FirebaseAuth,
    private val credentials: CredentialManager,
    /** The project's web client, which Google sign-in asks for an ID token for; null without Google sign-in. */
    private val googleClientId: String?,
) : AuthClient {
    private val current = MutableStateFlow(auth.currentUser?.toAccount())
    override val account: StateFlow<Account?> = current.asStateFlow()
    override val google: Boolean get() = googleClientId != null

    init {
        // ID token changes include sign-in, sign-out, and the refresh after an email is verified.
        auth.addIdTokenListener(FirebaseAuth.IdTokenListener { current.value = it.currentUser?.toAccount() })
    }

    override suspend fun token(): String = attempt {
        val user = auth.currentUser ?: throw AuthException(SIGN_IN_AGAIN)
        user.getIdToken(false).await().token ?: throw AuthException(SIGN_IN_AGAIN)
    }

    override suspend fun signIn(email: String, password: String) = attempt {
        auth.signInWithEmailAndPassword(email, password).await()
        Unit
    }

    override suspend fun signUp(email: String, password: String) = attempt {
        val user = auth.createUserWithEmailAndPassword(email, password).await().user
        // The account exists either way; a link that fails to send can be sent again from the menu.
        runCatching { user?.sendEmailVerification()?.await() }
        Unit
    }

    override suspend fun signInWithGoogle(context: Context) = attempt {
        val clientId = googleClientId ?: throw AuthException(authErrorMessage("ERROR_OPERATION_NOT_ALLOWED"))
        val request = GetCredentialRequest(listOf(GetSignInWithGoogleOption.Builder(clientId).build()))
        val credential = try {
            credentials.getCredential(context, request).credential
        } catch (_: GetCredentialCancellationException) {
            throw AuthException(authErrorMessage(CANCELLED))
        } catch (_: NoCredentialException) {
            throw AuthException(authErrorMessage("ERROR_NO_GOOGLE_ACCOUNT"))
        } catch (_: GetCredentialException) {
            throw AuthException(SIGN_IN_FAILED)
        }
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw AuthException(SIGN_IN_FAILED)
        }
        val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
        auth.signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()
        Unit
    }

    override suspend fun sendVerification() = attempt {
        val user = auth.currentUser ?: throw AuthException(SIGN_IN_AGAIN)
        user.sendEmailVerification().await()
        Unit
    }

    override suspend fun refresh() = attempt {
        val user = auth.currentUser
        if (user == null || user.isEmailVerified) return@attempt
        user.reload().await()
        // Fetch a new ID token before telling anyone: the API calls they start must carry the verified claim.
        if (user.isEmailVerified) user.getIdToken(true).await()
        current.value = auth.currentUser?.toAccount()
    }

    override suspend fun resetPassword(email: String) = attempt {
        auth.sendPasswordResetEmail(email).await()
        Unit
    }

    override suspend fun signOut() {
        auth.signOut()
        // So the next Google sign-in offers a choice of accounts again.
        try {
            credentials.clearCredentialState(ClearCredentialStateRequest())
        } catch (failure: CancellationException) {
            throw failure
        } catch (_: Exception) {
        }
    }

    companion object {
        /** The client for the build's Firebase project, or null when the build has none. */
        // The web client's ID is a resource only when google-services.json names one.
        @SuppressLint("DiscouragedApi")
        fun create(context: Context): FirebaseAuthClient? {
            if (BuildConfig.E2E) return emulated(context)
            val app = FirebaseApp.getApps(context).firstOrNull() ?: FirebaseApp.initializeApp(context) ?: return null
            val clientRes = context.resources.getIdentifier("default_web_client_id", "string", context.packageName)
            val clientId = if (clientRes != 0) context.getString(clientRes) else null
            return FirebaseAuthClient(FirebaseAuth.getInstance(app), CredentialManager.create(context), clientId)
        }

        /** The end-to-end tests' accounts: the Auth emulator's demo project (e2e/scenario.ts), without Google sign-in. */
        private fun emulated(context: Context): FirebaseAuthClient {
            val existing = FirebaseApp.getApps(context).find { it.name == E2E_APP }
            val app = existing ?: FirebaseApp.initializeApp(
                context,
                FirebaseOptions.Builder()
                    .setProjectId("demo-homeoremedica")
                    .setApiKey("e2e-api-key")
                    .setApplicationId("1:1:android:1")
                    .build(),
                E2E_APP,
            )
            val auth = FirebaseAuth.getInstance(app)
            // The emulator can be set only before the instance is first used.
            if (existing == null) auth.useEmulator("localhost", 9099)
            return FirebaseAuthClient(auth, CredentialManager.create(context), googleClientId = null)
        }

        private const val E2E_APP = "e2e"
    }
}

private fun FirebaseUser.toAccount() = Account(uid, email, displayName, isEmailVerified)

/** Run a Firebase call, turning its failures into [AuthException]s with the web app's messages. */
private suspend fun <T> attempt(block: suspend () -> T): T = try {
    block()
} catch (failure: CancellationException) {
    throw failure
} catch (failure: AuthException) {
    throw failure
} catch (failure: FirebaseAuthException) {
    throw AuthException(authErrorMessage(failure.errorCode))
} catch (_: FirebaseNetworkException) {
    throw AuthException(authErrorMessage("ERROR_NETWORK_REQUEST_FAILED"))
} catch (_: FirebaseTooManyRequestsException) {
    throw AuthException(authErrorMessage("ERROR_TOO_MANY_REQUESTS"))
} catch (_: Exception) {
    throw AuthException(SIGN_IN_FAILED)
}

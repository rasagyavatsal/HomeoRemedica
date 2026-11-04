package io.github.rasagyavatsal.homeoremedica.account

import android.content.Context
import kotlinx.coroutines.flow.StateFlow

// Ports the web app's sign-in (src/web/auth.ts).

data class Account(
    val uid: String,
    val email: String?,
    val name: String?,
    /** Chats sync only once the email address is verified; Google sign-ins always are. */
    val verified: Boolean,
)

/** Sign-in through Firebase Authentication. */
interface AuthClient {
    /** The signed-in account, or null; it changes on sign-in, sign-out and email verification. */
    val account: StateFlow<Account?>

    /** Whether this build can sign in with Google. */
    val google: Boolean

    /** A current ID token for the API. */
    suspend fun token(): String

    suspend fun signIn(email: String, password: String)

    /** Create the account and send its email verification link. */
    suspend fun signUp(email: String, password: String)

    /** Choose a Google account through the system's sheet, which [context] opens. */
    suspend fun signInWithGoogle(context: Context)

    /** Send the signed-in account another email verification link. */
    suspend fun sendVerification()

    /** Check whether the email address has been verified since sign-in, perhaps on another device. */
    suspend fun refresh()

    suspend fun resetPassword(email: String)

    suspend fun signOut()
}

/** A failed sign-in, whose message is safe to show; a null message means there is nothing to report. */
class AuthException(message: String?) : Exception(message)

const val SIGN_IN_AGAIN = "Please sign in again."
const val SIGN_IN_FAILED = "Signing in failed. Please try again."

// The web app's messages, by Firebase's error codes on Android.
private val AUTH_MESSAGES = mapOf(
    "ERROR_INVALID_CREDENTIAL" to "The email or password is incorrect.",
    "ERROR_WRONG_PASSWORD" to "The email or password is incorrect.",
    "ERROR_USER_NOT_FOUND" to "The email or password is incorrect.",
    "ERROR_INVALID_EMAIL" to "Enter a valid email address.",
    "ERROR_MISSING_PASSWORD" to "Enter your password.",
    "ERROR_EMAIL_ALREADY_IN_USE" to "An account with this email already exists. Sign in instead.",
    "ERROR_WEAK_PASSWORD" to "Choose a password of at least 6 characters.",
    "ERROR_TOO_MANY_REQUESTS" to "Too many attempts. Wait a moment and try again.",
    "ERROR_NETWORK_REQUEST_FAILED" to "The sign-in service could not be reached. Check your connection.",
    "ERROR_OPERATION_NOT_ALLOWED" to "This way of signing in is not available.",
    "ERROR_USER_DISABLED" to "This account has been disabled.",
    "ERROR_NO_GOOGLE_ACCOUNT" to "Add a Google account to this device to sign in with Google.",
)

// Closing the Google sheet is a choice, not a failure.
const val CANCELLED = "CANCELLED"

/** A message for a failed sign-in with Firebase's error [code], or null when there is nothing to report. */
fun authErrorMessage(code: String?): String? =
    if (code == CANCELLED) null else AUTH_MESSAGES[code] ?: SIGN_IN_FAILED

/** The form's own checks, which the web app leaves to the browser; null when the form can be sent. */
fun authFormError(email: String, password: String?, signingUp: Boolean): String? = when {
    !Regex("""^[^@\s]+@[^@\s]+$""").matches(email) -> AUTH_MESSAGES["ERROR_INVALID_EMAIL"]
    password == null -> null
    password.isEmpty() -> AUTH_MESSAGES["ERROR_MISSING_PASSWORD"]
    signingUp && password.length < 6 -> AUTH_MESSAGES["ERROR_WEAK_PASSWORD"]
    else -> null
}

package io.github.rasagyavatsal.homeoremedica.account

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AuthTest {
    @Test
    fun showsTheWebAppsMessages() {
        assertEquals("The email or password is incorrect.", authErrorMessage("ERROR_INVALID_CREDENTIAL"))
        assertEquals("An account with this email already exists. Sign in instead.", authErrorMessage("ERROR_EMAIL_ALREADY_IN_USE"))
        assertEquals(SIGN_IN_FAILED, authErrorMessage("ERROR_SOMETHING_NEW"))
        assertEquals(SIGN_IN_FAILED, authErrorMessage(null))
    }

    @Test
    fun saysNothingWhenTheGoogleSheetIsClosed() {
        assertNull(authErrorMessage(CANCELLED))
    }

    @Test
    fun checksTheFormBeforeSending() {
        assertEquals("Enter a valid email address.", authFormError("someone", "secret", signingUp = false))
        assertEquals("Enter your password.", authFormError("a@b.co", "", signingUp = false))
        assertEquals("Choose a password of at least 6 characters.", authFormError("a@b.co", "short", signingUp = true))
        assertNull(authFormError("a@b.co", "short", signingUp = false))
        // A reset needs only the email.
        assertNull(authFormError("a@b.co", null, signingUp = false))
    }
}

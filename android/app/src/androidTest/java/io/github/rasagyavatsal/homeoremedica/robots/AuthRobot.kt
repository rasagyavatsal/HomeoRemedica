package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.performTextInput
import io.github.rasagyavatsal.homeoremedica.support.TestUser

/** The dialog that signs in, creates an account or sends a password reset link. */
class AuthRobot(rule: ComposeTestRule) : Robot(rule) {
    fun signIn(user: TestUser) {
        fill(user.email, user.password)
        tap(button("Sign in"))
        closes()
    }

    fun createAccount(user: TestUser) {
        tap(button("Create an account"))
        fill(user.email, user.password)
        tap(button("Create an account"))
        closes()
    }

    fun resetPassword(email: String) {
        tap(button("Forgot password?"))
        field("Email", email)
        tap(button("Send reset link"))
        waitFor(hasText("If an account uses $email, a reset link is on its way."))
    }

    private fun fill(email: String, password: String) {
        field("Email", email)
        field("Password", password)
    }

    private fun field(label: String, value: String) {
        val matcher = hasContentDescription(label) and hasSetTextAction()
        waitFor(matcher)
        rule.onNode(matcher).performTextInput(value)
    }

    private fun closes() = waitForNo(hasText("By continuing, you agree to the", substring = true))
}

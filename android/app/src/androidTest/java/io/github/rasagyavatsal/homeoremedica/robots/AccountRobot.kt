package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import io.github.rasagyavatsal.homeoremedica.support.TestUser

/** The profile at the foot of the chats, and its menu. */
class AccountRobot(rule: ComposeTestRule) : Robot(rule) {
    /** Open the sign-in dialog. */
    fun openSignIn(): AuthRobot {
        choose("Sign in to sync chats")
        return AuthRobot(rule)
    }

    fun signIn(user: TestUser) = openSignIn().signIn(user)

    fun signOut() = choose("Sign out")

    fun deleteAccount() {
        choose("Delete account…")
        tap(button("Delete account"))
    }

    fun showsGuest() = waitFor(profile("Guest"))

    fun showsAccount(email: String) = waitFor(profile(email))

    /** The menu offers to send the verification link again only until the email is verified. */
    fun offersNoVerificationEmail() {
        openMenu()
        rule.onAllNodes(button("Resend verification email")).assertCountEquals(0)
    }

    private fun choose(item: String) {
        openMenu()
        tap(button(item))
    }

    private fun openMenu() = tap(hasClickLabel("Account"))

    private fun profile(label: String) = hasText(label) and hasClickLabel("Account")
}

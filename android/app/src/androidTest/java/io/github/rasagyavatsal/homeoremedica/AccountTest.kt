package io.github.rasagyavatsal.homeoremedica

import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rasagyavatsal.homeoremedica.robots.chat
import io.github.rasagyavatsal.homeoremedica.robots.drawer
import io.github.rasagyavatsal.homeoremedica.robots.start
import io.github.rasagyavatsal.homeoremedica.support.Accounts
import io.github.rasagyavatsal.homeoremedica.support.AppRule
import io.github.rasagyavatsal.homeoremedica.support.Device
import io.github.rasagyavatsal.homeoremedica.support.Server
import io.github.rasagyavatsal.homeoremedica.support.eventually
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AccountTest {
    @get:Rule val app = AppRule()

    @Test
    fun syncsChatsOnceANewAccountVerifiesItsEmail() {
        val user = Accounts.newUser()
        app.start()
        app.drawer {
            account { openSignIn().createAccount(user) }
            close()
        }
        // Until the email is verified, chats stay on the device. The notice sits above the composer, so the
        // question can be sent while it shows.
        app.chat {
            seesNotice("Verify your email address to sync your chats.")
            askAndWait("cannot bear to be touched")
        }
        eventually { assertEquals(listOf("cannot bear to be touched"), Device.chatTitles()) }

        Accounts.follow(Accounts.emailedLink(user.email, "VERIFY_EMAIL"))
        // The app checks again when it comes back, as after following the link in a mail app.
        app.leaveAndComeBack()

        eventually { assertEquals(listOf("cannot bear to be touched"), Server.chatTitles(user)) }
        app.drawer {
            lists("cannot bear to be touched")
            account { offersNoVerificationEmail() }
        }
    }

    @Test
    fun movesTheDevicesChatsIntoTheAccountAtSignIn() {
        val user = Accounts.createUser()
        app.start()
        app.chat { askAndWait("chilly and constipated") }
        eventually { assertEquals(listOf("chilly and constipated"), Device.chatTitles()) }

        app.drawer {
            account {
                signIn(user)
                showsAccount(user.email)
            }
        }
        eventually { assertEquals(listOf("chilly and constipated"), Server.chatTitles(user)) }
    }

    @Test
    fun signsOutToTheDevicesChatsAndBackInToTheAccounts() {
        val user = Accounts.createUser()
        app.start()
        app.drawer {
            account { signIn(user) }
            close()
        }
        app.chat { askAndWait("aversion to company") }
        eventually { assertEquals(listOf("aversion to company"), Server.chatTitles(user)) }

        app.drawer {
            account {
                signOut()
                showsGuest()
            }
            isEmpty()
            account { signIn(user) }
            lists("aversion to company")
        }
    }

    @Test
    fun sendsAPasswordResetLink() {
        val user = Accounts.createUser()
        app.start()
        app.drawer { account { openSignIn().resetPassword(user.email) } }
        Accounts.emailedLink(user.email, "PASSWORD_RESET")
    }

    @Test
    fun deletesTheAccountAndItsChats() {
        val user = Accounts.createUser()
        app.start()
        app.drawer {
            account { signIn(user) }
            close()
        }
        app.chat { askAndWait("fear of thunderstorms") }
        eventually { assertEquals(listOf("fear of thunderstorms"), Server.chatTitles(user)) }

        app.drawer {
            account {
                deleteAccount()
                showsGuest()
            }
        }
        app.chat { seesNotice("Your account and its chats were deleted.") }
        eventually { assertNull(Accounts.token(user)) }
    }
}

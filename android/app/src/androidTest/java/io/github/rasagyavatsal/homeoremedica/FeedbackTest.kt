package io.github.rasagyavatsal.homeoremedica

import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rasagyavatsal.homeoremedica.api.FeedbackReason
import io.github.rasagyavatsal.homeoremedica.api.Rating
import io.github.rasagyavatsal.homeoremedica.robots.ChatRobot
import io.github.rasagyavatsal.homeoremedica.robots.chat
import io.github.rasagyavatsal.homeoremedica.robots.drawer
import io.github.rasagyavatsal.homeoremedica.robots.start
import io.github.rasagyavatsal.homeoremedica.support.ANSWER
import io.github.rasagyavatsal.homeoremedica.support.Accounts
import io.github.rasagyavatsal.homeoremedica.support.AppRule
import io.github.rasagyavatsal.homeoremedica.support.Server
import io.github.rasagyavatsal.homeoremedica.support.TestUser
import io.github.rasagyavatsal.homeoremedica.support.eventually
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class FeedbackTest {
    @get:Rule val app = AppRule()

    @Test
    fun offersRatingsOnlyToSignedInReaders() {
        app.start()
        app.chat {
            askAndWait("restless legs")
            seesAnswer(ANSWER)
            offersNoRatings()
        }
    }

    @Test
    fun ratesAnAnswerDownWithAReasonAndAComment() {
        val user = signedIn()
        app.chat {
            askAndSave(user, "cough worse lying down")
            rating {
                rateDown()
                pick("Wrong remedy")
                comment("Expected Bryonia first.")
            }
        }
        eventually {
            val saved = Server.ratings(user, "cough worse lying down")
            assertEquals(Rating.Down, saved?.answer)
            assertEquals(listOf(FeedbackReason.WrongRemedy), saved?.reasons)
            assertEquals("Expected Bryonia first.", saved?.comment)
        }

        // The rating comes back with the chat.
        app.restart()
        app.chat { rating { isRatedDown() } }
    }

    @Test
    fun ratesASourcePassage() {
        val user = signedIn()
        app.chat {
            askAndSave(user, "aversion to company")
            openSource(1).rate("Relevant")
        }
        eventually { assertEquals(mapOf(1 to Rating.Up), Server.ratings(user, "aversion to company")?.sources) }

        app.restart()
        app.chat { openSource(1).isRated("Relevant") }
    }

    /** Past the notice and signed in to a new, verified account, which can rate answers. */
    private fun signedIn(): TestUser {
        val user = Accounts.createUser()
        app.start()
        app.drawer {
            account { signIn(user) }
            close()
        }
        return user
    }

    /** Ask, and wait until the chat is saved to the account, as rating needs. */
    private fun ChatRobot.askAndSave(user: TestUser, question: String) {
        askAndWait(question)
        eventually { assertEquals(listOf(question), Server.chatTitles(user)) }
    }
}

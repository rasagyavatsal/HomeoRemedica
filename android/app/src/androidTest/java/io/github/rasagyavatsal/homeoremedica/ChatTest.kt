package io.github.rasagyavatsal.homeoremedica

import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rasagyavatsal.homeoremedica.robots.chat
import io.github.rasagyavatsal.homeoremedica.robots.notice
import io.github.rasagyavatsal.homeoremedica.robots.start
import io.github.rasagyavatsal.homeoremedica.support.ANSWER
import io.github.rasagyavatsal.homeoremedica.support.AppRule
import io.github.rasagyavatsal.homeoremedica.support.BRYONIA_PASSAGE
import io.github.rasagyavatsal.homeoremedica.support.CHAT_LIMIT
import io.github.rasagyavatsal.homeoremedica.support.FAIL_ONCE
import io.github.rasagyavatsal.homeoremedica.support.NUX_VOMICA_PASSAGE
import io.github.rasagyavatsal.homeoremedica.support.SLOW
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ChatTest {
    @get:Rule val app = AppRule()

    @Test
    fun showsThePractitionerNoticeOnlyUntilItIsAcknowledged() {
        app.notice { acknowledge() }
        app.restart()
        app.chat { seesWelcome() }
        app.notice { isGone() }
    }

    @Test
    fun streamsAnAnswerAndOpensItsCitedPassages() {
        app.start()
        app.chat {
            askAndWait("irritable and chilly")
            seesAnswer(ANSWER)
            openSource(1).apply {
                showsPassage(NUX_VOMICA_PASSAGE)
                close()
            }
            openCitation(2).showsPassage(BRYONIA_PASSAGE)
        }
    }

    @Test
    fun stopsAnAnswerWhileItIsWritten() {
        app.start()
        app.chat {
            ask("thirst for large quantities $SLOW")
            waitForAnswerToStart()
            stop()
            seesStopped()
        }
    }

    @Test
    fun asksAFailedQuestionAgain() {
        app.start()
        app.chat {
            ask("worse from motion $FAIL_ONCE")
            offersRetry()
            retry()
            waitForAnswer()
            seesAnswer(ANSWER)
        }
    }

    @Test
    fun sendsTheConversationSoFarWithAFollowUp() {
        app.start()
        app.chat {
            askAndWait("chilly and constipated")
            askAndWait("and which is worse in the morning?")
            seesFollowUpTo("chilly and constipated")
        }
    }

    @Test
    fun explainsWhenTooManyQuestionsAreAsked() {
        app.start()
        app.chat {
            repeat(CHAT_LIMIT) { askAndWait("question ${it + 1}") }
            ask("one question too many")
            seesError("Too many questions in a short time.")
        }
    }
}

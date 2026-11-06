package io.github.rasagyavatsal.homeoremedica

import androidx.test.ext.junit.runners.AndroidJUnit4
import io.github.rasagyavatsal.homeoremedica.robots.chat
import io.github.rasagyavatsal.homeoremedica.robots.drawer
import io.github.rasagyavatsal.homeoremedica.robots.start
import io.github.rasagyavatsal.homeoremedica.support.AppRule
import io.github.rasagyavatsal.homeoremedica.support.Device
import io.github.rasagyavatsal.homeoremedica.support.eventually
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LibraryTest {
    @get:Rule val app = AppRule()

    @Test
    fun reopensTheOpenChatAfterARestart() {
        app.start()
        app.chat { askAndWait("cannot bear to be touched") }
        eventually { assertEquals(listOf("cannot bear to be touched"), Device.chatTitles()) }

        app.restart()
        app.chat { seesQuestion("cannot bear to be touched") }
    }

    @Test
    fun startsANewChatAndOpensAnEarlierOne() {
        app.start()
        app.chat { askAndWait("chilly and constipated") }
        app.drawer { newChat() }
        app.chat {
            seesWelcome()
            askAndWait("weeps easily")
        }

        app.drawer {
            lists("weeps easily", "chilly and constipated")
            openChat("chilly and constipated")
        }
        app.chat { seesQuestion("chilly and constipated") }
    }

    @Test
    fun putsADeletedChatBackWithUndo() {
        app.start()
        app.chat { askAndWait("restless legs") }
        app.drawer { delete("restless legs") }
        app.chat {
            seesNotice("Deleted “restless legs”.")
            undo()
            seesQuestion("restless legs")
        }
        app.drawer { lists("restless legs") }
        eventually { assertEquals(listOf("restless legs"), Device.chatTitles()) }
    }

    @Test
    fun deletesAChat() {
        app.start()
        app.chat { askAndWait("restless legs") }
        app.drawer {
            delete("restless legs")
            isEmpty()
        }
        eventually { assertEquals(emptyList<String>(), Device.chatTitles()) }
    }
}

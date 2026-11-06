package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.ComposeTestRule
import io.github.rasagyavatsal.homeoremedica.support.AppRule

/** The practitioner notice, which covers the app on its first launch: a sheet on phones, a dialog on wide screens. */
class NoticeRobot(rule: ComposeTestRule) : Robot(rule) {
    /** Acknowledge the notice, and wait for it to slide away. */
    fun acknowledge() {
        tap(button("I understand"))
        waitForNo(button("I understand"))
    }

    fun isShown() = waitFor(button("I understand"))

    fun isGone() = rule.onAllNodes(button("I understand")).assertCountEquals(0)
}

fun AppRule.notice(block: NoticeRobot.() -> Unit) = NoticeRobot(compose).apply(block)

/** Past the notice, as every test that is not about it begins. */
fun AppRule.start() = notice { acknowledge() }

package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import io.github.rasagyavatsal.homeoremedica.support.AppRule

/**
 * The chats: a drawer that slides over the chat on phones and a sidebar beside it on wide screens, so the
 * same steps work on both.
 */
class DrawerRobot(rule: ComposeTestRule) : Robot(rule) {
    fun open() {
        if (exists(hasContentDescription("Open chats")) && !exists(hasContentDescription("Close chats"))) {
            tap(hasContentDescription("Open chats"))
        }
        waitFor(button("New chat"))
    }

    fun close() {
        if (exists(hasContentDescription("Close chats"))) tap(hasContentDescription("Close chats"))
    }

    /** Start a new chat, which closes the drawer. */
    fun newChat() = tap(button("New chat"))

    /** Open the chat titled [title], which closes the drawer. */
    fun openChat(title: String) = tap(chat(title))

    fun delete(title: String) {
        tap(hasContentDescription("Delete “$title”"))
        tap(button("Delete"))
        waitForNo(chat(title))
    }

    fun lists(vararg titles: String) = titles.forEach { waitFor(chat(it)) }

    fun isEmpty() = waitFor(hasText("Your chats will appear here."))

    /** The account at the foot of the chats. */
    fun account(block: AccountRobot.() -> Unit) = AccountRobot(rule).apply(block)

    private fun chat(title: String) = hasText(title) and hasClickLabel("Open chat")
}

fun AppRule.drawer(block: DrawerRobot.() -> Unit) = DrawerRobot(compose).apply {
    open()
    block()
}

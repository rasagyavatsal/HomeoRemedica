package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.swipeLeft
import androidx.compose.ui.test.swipeRight
import androidx.compose.ui.test.performTouchInput
import io.github.rasagyavatsal.homeoremedica.support.AppRule

/**
 * The chats: a drawer that slides over the chat on phones and a sidebar beside it on wide screens, so the
 * same steps work on both.
 */
class DrawerRobot(rule: ComposeTestRule) : Robot(rule) {
    fun open() {
        if (!exists(button("New chat"))) tap(hasContentDescription("Open chats"))
        waitFor(button("New chat"))
    }

    /** Close the drawer with its close button, or its scrim where one shows; the sidebar on wide screens stays. */
    fun close() {
        if (exists(hasClickLabel("Close chats"))) {
            press(hasClickLabel("Close chats"))
            waitForNo(button("New chat"))
        }
    }

    /** Drag the chat sideways, which pulls the drawer in. */
    fun swipeOpen() {
        rule.onRoot().performTouchInput { swipeRight(startX = width * 0.2f, endX = width * 0.9f) }
        waitFor(button("New chat"))
    }

    /** Drag the drawer back out of the way. */
    fun swipeClosed() {
        rule.onRoot().performTouchInput { swipeLeft(startX = width * 0.6f, endX = width * 0.05f) }
        waitForNo(button("New chat"))
    }

    /** Start a new chat, which closes the drawer. */
    fun newChat() = tap(button("New chat"))

    /** Open the chat titled [title], which closes the drawer. */
    fun openChat(title: String) = tap(chat(title))

    /**
     * Delete the chat titled [title]: from its long-press sheet on phones, and with its delete button and
     * the confirmation that follows on wide screens.
     */
    fun delete(title: String) {
        waitFor(chat(title))
        if (exists(hasContentDescription("Delete “$title”"))) {
            tap(hasContentDescription("Delete “$title”"))
            tap(button("Delete"))
        } else {
            rule.onNode(chat(title)).performTouchInput { longClick() }
            tap(button("Delete chat"))
        }
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

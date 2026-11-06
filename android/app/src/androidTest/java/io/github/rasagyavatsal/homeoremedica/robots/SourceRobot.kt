package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.ComposeTestRule

/** The cited passages: a sheet over the chat on phones that swipes between them, and a panel beside it on wide screens. */
class SourceRobot(rule: ComposeTestRule) : Robot(rule) {
    fun showsPassage(text: String) = waitFor(hasText(text, substring = true))

    /** Rate the passage [label], "Relevant" or "Not relevant"; again to take the rating back. */
    fun rate(label: String) = tap(hasContentDescription(label))

    fun isRated(label: String) = waitFor(hasContentDescription(label) and isSelected())

    fun close() {
        tap(hasContentDescription("Close source"))
        waitForNo(hasContentDescription("Close source"))
    }
}

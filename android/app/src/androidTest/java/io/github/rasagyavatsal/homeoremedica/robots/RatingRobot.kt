package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.isSelected
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTextInput

/** The newest answer's ratings and the box that opens under them for reasons and a comment. */
class RatingRobot(rule: ComposeTestRule) : Robot(rule) {
    fun rateUp() = press(hasContentDescription("Helpful"))

    fun rateDown() = press(hasContentDescription("Not helpful"))

    /** Pick one of the reasons offered for an answer rated down, such as "Wrong remedy". */
    fun pick(reason: String) = press(button(reason))

    fun comment(text: String) {
        waitFor(hasContentDescription("Comment"))
        rule.onNodeWithContentDescription("Comment").performTextInput(text)
        press(hasContentDescription("Send comment"))
    }

    fun isRatedDown() = waitFor(hasContentDescription("Not helpful") and isSelected())

    fun isRatedUp() = waitFor(hasContentDescription("Helpful") and isSelected())
}

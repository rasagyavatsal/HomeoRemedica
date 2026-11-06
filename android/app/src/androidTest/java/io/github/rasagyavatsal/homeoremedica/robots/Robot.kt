package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import io.github.rasagyavatsal.homeoremedica.support.TIMEOUT

/**
 * A screen of the app as a reader uses it. Robots are the only code that knows how the screens are built:
 * tests say what the reader does and sees, and robots find the elements by their text and labels.
 */
@OptIn(ExperimentalTestApi::class)
abstract class Robot(protected val rule: ComposeTestRule) {
    protected fun waitFor(matcher: SemanticsMatcher, timeout: Long = TIMEOUT) = rule.waitUntilAtLeastOneExists(matcher, timeout)

    protected fun waitForNo(matcher: SemanticsMatcher, timeout: Long = TIMEOUT) = rule.waitUntilDoesNotExist(matcher, timeout)

    protected fun exists(matcher: SemanticsMatcher) = rule.onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()

    /** Tap the only element [matcher] finds, once it appears. */
    protected fun tap(matcher: SemanticsMatcher) {
        waitFor(matcher)
        rule.onNode(matcher).performClick()
    }

    /**
     * Press the last element [matcher] finds, as the newest answer's, through its click action rather than a
     * touch: the composer floats over the bottom of the conversation and would take a touch there.
     */
    protected fun press(matcher: SemanticsMatcher): SemanticsNodeInteraction {
        waitFor(matcher)
        return rule.onAllNodes(matcher).onLast().performSemanticsAction(SemanticsActions.OnClick)
    }
}

/** A button, link or menu item showing [text]. */
fun button(text: String) = hasText(text) and hasClickAction()

/** An element whose tap action is described as [label], or has no description when [label] is null. */
fun hasClickLabel(label: String?) = SemanticsMatcher("tap is labelled $label") { node ->
    node.config.getOrNull(SemanticsActions.OnClick)?.let { it.label == label } == true
}

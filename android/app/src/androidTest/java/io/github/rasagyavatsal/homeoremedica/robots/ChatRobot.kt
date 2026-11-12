package io.github.rasagyavatsal.homeoremedica.robots

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performTextInput
import io.github.rasagyavatsal.homeoremedica.support.AppRule

/** The open chat: the composer, the conversation and its answers. */
class ChatRobot(rule: ComposeTestRule) : Robot(rule) {
    /** Ask [question] and wait until it is in the conversation, without waiting for its answer. */
    fun ask(question: String) {
        rule.onNodeWithContentDescription("Message").performTextInput(question)
        // Through its click action: the keyboard rising may still be moving the composer.
        press(hasContentDescription("Send message"))
        waitFor(hasContentDescription("You: $question"))
    }

    /** Ask [question] and wait for its answer to finish. */
    fun askAndWait(question: String) {
        ask(question)
        waitForAnswer()
    }

    fun waitForAnswer() = waitForNo(hasContentDescription("Stop answering"))

    fun waitForAnswerToStart() = waitFor(hasText("The books answer", substring = true))

    fun stop() = tap(hasContentDescription("Stop answering"))

    fun retry() = press(button("Try again"))

    /** The case's symptom numbered [number] from 1, as it was read or as the reader left it. */
    fun seesSymptom(number: Int, text: String) = waitFor(hasContentDescription("Symptom $number") and hasText(text))

    fun removeSymptom(number: Int) = press(hasContentDescription("Remove symptom $number"))

    /** Add a disease to the case under review, in the row that takes a new one. */
    fun addDisease(text: String) {
        waitFor(hasContentDescription("Add disease"))
        rule.onNodeWithContentDescription("Add disease").performTextInput(text)
    }

    /** Have the case under review answered as the reader left it. */
    fun confirmCase() = press(button("Continue"))

    fun seesQuestion(question: String) = waitFor(hasContentDescription("You: $question"))

    fun seesAnswer(text: String) = waitFor(hasText(text, substring = true))

    fun seesFollowUpTo(question: String) = waitFor(hasText("Following on from “$question”", substring = true))

    fun seesStopped() = waitFor(hasText("Stopped before the answer finished."))

    fun seesError(text: String) = waitFor(hasText(text, substring = true))

    fun offersRetry() = waitFor(button("Try again"))

    /** A message shown for a few seconds over the chat, such as a chat that could not be saved. */
    fun seesNotice(text: String) = waitFor(hasText(text, substring = true))

    /** Take back what the notice reports, such as a deleted chat. */
    fun undo() = tap(button("Undo"))

    /** The empty chat, which welcomes the reader with the tagline. */
    fun seesWelcome() = waitFor(hasContentDescription("Ask the classical homoeopathic literature."))

    /** Open source [number] of the newest answer from its card under the answer. */
    fun openSource(number: Int): SourceRobot {
        press(hasContentDescription("Source $number:", substring = true) and hasClickLabel("Open source"))
        return SourceRobot(rule)
    }

    /** Open source [number] of the newest answer from its `[n]` chip in the answer's text. */
    fun openCitation(number: Int): SourceRobot {
        press(hasContentDescription("Source $number:", substring = true) and hasClickLabel(null))
        return SourceRobot(rule)
    }

    fun rating(block: RatingRobot.() -> Unit) = RatingRobot(rule).apply(block)

    fun offersNoRatings() = rule.onAllNodes(hasContentDescription("Rate this answer")).assertCountEquals(0)
}

fun AppRule.chat(block: ChatRobot.() -> Unit) = ChatRobot(compose).apply(block)

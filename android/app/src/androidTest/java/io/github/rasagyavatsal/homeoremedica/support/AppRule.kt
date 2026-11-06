package io.github.rasagyavatsal.homeoremedica.support

import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import io.github.rasagyavatsal.homeoremedica.MainActivity
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement

/**
 * The app as a test drives it: opened when the test starts, from a fresh install (the orchestrator clears
 * the app's data between tests), and closed when it ends.
 */
class AppRule : TestRule {
    val compose: ComposeTestRule = createEmptyComposeRule()
    private var scenario: ActivityScenario<MainActivity>? = null

    override fun apply(base: Statement, description: Description): Statement = compose.apply(
        object : Statement() {
            override fun evaluate() {
                try {
                    open()
                    base.evaluate()
                } finally {
                    scenario?.close()
                }
            }
        },
        description,
    )

    /** Close the app and open it again, as a reader does, so it starts from what it saved. */
    fun restart() {
        scenario?.close()
        open()
    }

    /** Leave the app and return to it, as after following an email's link in another app. */
    fun leaveAndComeBack() {
        val scenario = checkNotNull(scenario)
        scenario.moveToState(Lifecycle.State.CREATED)
        scenario.moveToState(Lifecycle.State.RESUMED)
    }

    private fun open() {
        scenario = ActivityScenario.launch(MainActivity::class.java)
    }
}

package io.github.rasagyavatsal.homeoremedica.support

// What the app's end-to-end tests and the web app's e2e server agree on (e2e/scenario.ts).

/** A question containing this streams its answer slowly enough to be stopped. */
const val SLOW = "[slow]"

/** A question containing this fails the first time it is asked and is answered after that. */
const val FAIL_ONCE = "[fail once]"

/** A question containing this describes a case, whose symptoms are shown for review. */
const val CASE = "[case]"
val CASE_SYMPTOMS = listOf("Mind: weeping", "Stomach: thirstless")

/** Questions each client may ask a minute. */
const val CHAT_LIMIT = 5

/** Every answer cites these, from the scripted sources: Kent on Nux vomica [1] and Boericke on Bryonia [2]. */
const val ANSWER = "Kent describes the irritability of Nux vomica"
const val NUX_VOMICA_PASSAGE = "oversensitive to noise, light and odours"
const val BRYONIA_PASSAGE = "chill with external coldness"

/** How long a test waits for the app or the server before failing. */
const val TIMEOUT = 15_000L

/** Retry [check] until it stops throwing, for state the app saves in the background. */
fun <T> eventually(timeout: Long = TIMEOUT, check: () -> T): T {
    val deadline = System.currentTimeMillis() + timeout
    while (true) {
        try {
            return check()
        } catch (failure: Throwable) {
            if (System.currentTimeMillis() > deadline) throw failure
            Thread.sleep(250)
        }
    }
}

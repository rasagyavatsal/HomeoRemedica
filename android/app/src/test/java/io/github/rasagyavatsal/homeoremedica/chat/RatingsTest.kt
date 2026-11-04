package io.github.rasagyavatsal.homeoremedica.chat

import io.github.rasagyavatsal.homeoremedica.api.AnswerRatings
import io.github.rasagyavatsal.homeoremedica.api.ApiException
import io.github.rasagyavatsal.homeoremedica.api.Citation
import io.github.rasagyavatsal.homeoremedica.api.Feedback
import io.github.rasagyavatsal.homeoremedica.api.FeedbackReason
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.api.RatedSource
import io.github.rasagyavatsal.homeoremedica.api.Rating
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RatingsTest {
    private fun source(n: Int) = Citation("v9/b/$n", "b", "Book", null, "Remedy $n", "Mind", listOf(n), "Text $n")

    private val messages = listOf(
        Message(0, Role.User, "Pulsatilla?"),
        Message(1, Role.Assistant, "Mild [2].", listOf(source(1), source(2))),
        Message(2, Role.User, "Sepia?"),
        Message(3, Role.Assistant, "Indiff", status = MessageStatus.Stopped),
    )

    @Test
    fun sendsTheAnswerWithEachSourcesRatingAndWhetherItIsCited() {
        val ratings = AnswerRatings(Rating.Down, mapOf(1 to Rating.Down), listOf(FeedbackReason.Unclear), "Too short")
        assertEquals(
            Feedback(
                "Pulsatilla?",
                "Mild [2].",
                Rating.Down,
                listOf(RatedSource("v9/b/1", false, Rating.Down), RatedSource("v9/b/2", true, null)),
                listOf(FeedbackReason.Unclear),
                "Too short",
            ),
            feedbackFor(messages, 1, ratings),
        )
        // A stopped answer, or a question, cannot be rated.
        assertNull(feedbackFor(messages, 3, Unrated))
        assertNull(feedbackFor(messages, 0, Unrated))
    }

    @Test
    fun reasonsGoWhenTheAnswerIsNoLongerRatedDown() {
        val down = Unrated.rated(null, Rating.Down).copy(reasons = listOf(FeedbackReason.WrongRemedy))
        assertEquals(listOf(FeedbackReason.WrongRemedy), down.rated(2, Rating.Up).reasons)
        assertEquals(emptyList<FeedbackReason>(), down.rated(null, Rating.Up).reasons)
        assertEquals(emptyMap<Int, Rating>(), down.rated(2, Rating.Up).rated(2, null).sources)
    }

    // The view model, with a library that keeps ratings as an account does.

    private val library = RatingLibrary()

    @Before
    fun start() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @After
    fun stop() = Dispatchers.resetMain()

    private fun viewModel(library: ChatLibrary = this.library) = ChatViewModel(
        HomeoRemedicaApi("http://localhost"),
        library,
        object : LastChat {
            override fun get(): String? = null
            override fun set(id: String?) {}
        },
        UnconfinedTestDispatcher(),
    )

    private suspend fun ChatLibrary.withChat() = also { save(SavedChat("c", "Pulsatilla?", 1, messages, emptyList())) }

    @Test
    fun answersOnTheDeviceCannotBeRated() = runTest {
        val local = MemoryLibrary().withChat()
        val vm = viewModel(local)
        vm.openChat("c")
        assertFalse(vm.state.value.canRate)
        vm.rate(1, null, Rating.Up)
        assertTrue(vm.state.value.ratings.isEmpty())
    }

    @Test
    fun showsARatingAtOnceAndSavesItUnderTheAnswersId() = runTest {
        library.withChat()
        val vm = viewModel()
        vm.openChat("c")
        assertTrue(vm.state.value.canRate)

        vm.rate(1, null, Rating.Down)
        var saved: Boolean? = null
        vm.note(1, reasons = listOf(FeedbackReason.MissingInformation), comment = "  Needs dose  ") { saved = it }
        vm.rate(1, 2, Rating.Up)

        val expected = AnswerRatings(Rating.Down, mapOf(2 to Rating.Up), listOf(FeedbackReason.MissingInformation), "Needs dose")
        assertEquals(expected, vm.state.value.ratings[1])
        assertEquals(true, saved)
        assertEquals("c-1", library.rated.last().first)
        assertEquals(expected.comment, library.rated.last().second.comment)
    }

    @Test
    fun undoesARatingThatCouldNotBeSaved() = runTest {
        library.withChat()
        val vm = viewModel()
        vm.openChat("c")
        library.failure = ApiException("Too many ratings in a short time. Please try again later.", 429)
        vm.rate(1, null, Rating.Up)

        assertNull(vm.state.value.ratings[1]?.answer)
        assertEquals("Your feedback could not be saved. Too many ratings in a short time. Please try again later.", vm.state.value.notice)
    }

    @Test
    fun loadsTheSavedRatingsWhenAChatOpensWithoutReplacingNewerOnes() = runTest {
        library.withChat()
        library.saved = CompletableDeferred()
        val vm = viewModel()
        vm.openChat("c")
        // Rated while the saved ratings load.
        vm.rate(1, 1, Rating.Down)
        library.saved!!.complete(mapOf(1L to AnswerRatings(Rating.Up), 3L to AnswerRatings(Rating.Down)))

        assertEquals(AnswerRatings(sources = mapOf(1 to Rating.Down)), vm.state.value.ratings[1])
        assertEquals(Rating.Down, vm.state.value.ratings[3]?.answer)
    }

    private open class MemoryLibrary : ChatLibrary {
        val chats = mutableMapOf<String, SavedChat>()
        override suspend fun list() = chats.values.map { it.summarize() }
        override suspend fun open(id: String) = chats[id]
        override suspend fun save(chat: SavedChat) {
            chats[chat.id] = chat
        }
        override suspend fun remove(id: String) {
            chats.remove(id)
        }
    }

    private class RatingLibrary : MemoryLibrary(), RatingClient {
        val rated = mutableListOf<Pair<String, Feedback>>()
        var failure: ApiException? = null
        var saved: CompletableDeferred<Map<Long, AnswerRatings>>? = null

        override suspend fun rate(id: String, feedback: Feedback) {
            failure?.let { throw it }
            rated += id to feedback
        }

        override suspend fun ratings(chatId: String) = saved?.await() ?: emptyMap()
    }
}

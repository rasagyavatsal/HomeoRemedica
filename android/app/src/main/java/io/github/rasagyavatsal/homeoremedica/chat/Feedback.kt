package io.github.rasagyavatsal.homeoremedica.chat

import io.github.rasagyavatsal.homeoremedica.answer.citedNumbers
import io.github.rasagyavatsal.homeoremedica.api.AnswerRatings
import io.github.rasagyavatsal.homeoremedica.api.Feedback
import io.github.rasagyavatsal.homeoremedica.api.RatedSource
import io.github.rasagyavatsal.homeoremedica.api.Rating
import io.github.rasagyavatsal.homeoremedica.api.Role

// Ports the web app's ratings (src/web/useFeedback.ts).

/** Where ratings are saved, and loaded from when a chat opens; only a verified account has one. */
interface RatingClient {
    suspend fun rate(id: String, feedback: Feedback)

    /** The ratings saved for a chat's answers, by message id. */
    suspend fun ratings(chatId: String): Map<Long, AnswerRatings>
}

val Unrated = AnswerRatings()

/** The id every rating of an answer is saved under. */
fun feedbackId(chatId: String, messageId: Long) = "$chatId-$messageId"

/** What the server keeps for an answer, or null while the answer cannot be rated. */
fun feedbackFor(messages: List<Message>, messageId: Long, ratings: AnswerRatings): Feedback? {
    val index = messages.indexOfFirst { it.id == messageId }
    val answer = messages.getOrNull(index)
    val question = messages.getOrNull(index - 1)
    if (answer?.role != Role.Assistant || answer.status != null || answer.content.isEmpty() || question?.role != Role.User) return null
    val sources = answer.sources.orEmpty()
    val cited = citedNumbers(answer.content, sources.size)
    return Feedback(
        question = question.content,
        answer = answer.content,
        rating = ratings.answer,
        sources = sources.mapIndexed { i, source -> RatedSource(source.id, (i + 1) in cited, ratings.sources[i + 1]) },
        reasons = ratings.reasons,
        comment = ratings.comment,
    )
}

/** Rate the answer, or its source numbered [source] from 1; a null [rating] takes it back. */
fun AnswerRatings.rated(source: Int?, rating: Rating?): AnswerRatings = when {
    // Reasons say what was wrong, so they go when the answer is no longer rated down.
    source == null -> copy(answer = rating, reasons = if (rating == Rating.Down) reasons else emptyList())
    rating == null -> copy(sources = sources - source)
    else -> copy(sources = sources + (source to rating))
}

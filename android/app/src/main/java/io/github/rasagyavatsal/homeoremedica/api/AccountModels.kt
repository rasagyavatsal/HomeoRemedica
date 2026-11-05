package io.github.rasagyavatsal.homeoremedica.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Mirrors the web app's contracts for saved chats and ratings (src/server/contracts.ts). The server
// rejects unknown fields and wants nullable ones present, so requests are encoded with explicit nulls.

/** A citation as an account saves it; unlike [Citation], every field is sent. */
@Serializable
data class SavedCitation(
    val id: String,
    val bookId: String,
    val bookTitle: String,
    val author: String?,
    val remedyName: String?,
    val sectionTitle: String,
    val passageIndexes: List<Int>,
    val text: String,
) {
    fun toCitation() = Citation(id, bookId, bookTitle, author, remedyName, sectionTitle, passageIndexes, text)
}

fun Citation.toSaved() = SavedCitation(id, bookId, bookTitle, author, remedyName, sectionTitle, passageIndexes, text)

@Serializable
data class SavedMessage(
    val id: Long,
    val role: Role,
    val content: String,
    /** Left out, not null, for a question or an answer without sources. */
    val sources: List<SavedCitation>? = null,
)

/** `PUT /api/chats/:id`: the whole chat, as the app shows it. */
@Serializable
data class SavedChatBody(
    val title: String,
    val updatedAt: Long,
    val messages: List<SavedMessage>,
    val history: List<ChatTurn>,
    val summary: String? = null,
)

/** `GET /api/chats/:id` */
@Serializable
data class SavedConversation(
    val messages: List<SavedMessage>,
    val history: List<ChatTurn>,
    val summary: String? = null,
)

/** A saved chat as `GET /api/chats` lists it. */
@Serializable
data class RemoteChatSummary(val id: String, val title: String, val updatedAt: Long)

/** `GET /api/chats`, newest first. */
@Serializable
data class ChatList(val chats: List<RemoteChatSummary>)

@Serializable
enum class Rating {
    @SerialName("up") Up,
    @SerialName("down") Down,
}

/** What was wrong with an answer rated down. */
@Serializable
enum class FeedbackReason(val label: String) {
    @SerialName("wrong_remedy") WrongRemedy("Wrong remedy"),
    @SerialName("irrelevant_sources") IrrelevantSources("Irrelevant sources"),
    @SerialName("missing_information") MissingInformation("Missing information"),
    @SerialName("unclear") Unclear("Unclear"),
}

/** The server's limit on a comment. */
const val MAX_FEEDBACK_COMMENT_CHARS = 1_000

@Serializable
data class RatedSource(
    /** The citation id, `corpusVersion/bookId/chunkId`. */
    val id: String,
    /** Whether the answer cites this source. */
    val cited: Boolean,
    val rating: Rating?,
)

/** `PUT /api/feedback/:id`: a user's rating of one answer and of its sources. */
@Serializable
data class Feedback(
    val question: String,
    val answer: String,
    val rating: Rating?,
    /** In the order they were retrieved, so a source's position is its rank. */
    val sources: List<RatedSource>,
    val reasons: List<FeedbackReason>,
    val comment: String?,
)

/** An answer's ratings: its own, each source's by its number in the answer from 1, and why. */
@Serializable
data class AnswerRatings(
    val answer: Rating? = null,
    val sources: Map<Int, Rating> = emptyMap(),
    val reasons: List<FeedbackReason> = emptyList(),
    val comment: String? = null,
)

/** `GET /api/chats/:id/feedback`: the user's ratings of the chat's answers, by message id. */
@Serializable
data class ChatRatings(val ratings: Map<Long, AnswerRatings>)

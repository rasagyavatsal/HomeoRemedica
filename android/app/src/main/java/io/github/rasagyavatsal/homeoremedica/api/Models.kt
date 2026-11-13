package io.github.rasagyavatsal.homeoremedica.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Mirrors the web app's server contracts (src/server/contracts.ts).

@Serializable
enum class Role {
    @SerialName("user") User,
    @SerialName("assistant") Assistant,
}

@Serializable
data class ChatTurn(val role: Role, val content: String)

@Serializable
data class Citation(
    val id: String,
    val bookId: String,
    val bookTitle: String,
    val author: String? = null,
    /** Null for chunks about principles rather than a remedy, such as the Organon's. */
    val remedyName: String? = null,
    val sectionTitle: String,
    val passageIndexes: List<Int> = emptyList(),
    val text: String,
)

@Serializable
data class ChatRequest(
    val message: String,
    val history: List<ChatTurn>,
    /** What the server condensed the chat's earlier turns into. */
    val summary: String? = null,
    /** The case's symptoms as the user confirmed them, searched in place of the server's own. */
    val symptoms: List<String>? = null,
    /** The case's diseases as the user confirmed them, ranked by in place of the server's own. */
    val diseases: List<String>? = null,
)

/** Whether a question describes a patient, whose symptoms are read, or asks about anything else. */
@Serializable
enum class QuestionKind {
    @SerialName("case") Case,
    @SerialName("question") Question,
}

/** `POST /api/kind`: decided before a question is answered, so only a case is read for symptoms. */
@Serializable
data class KindResponse(val kind: QuestionKind)

/** `POST /api/symptoms`: the symptoms of the case a question describes; none when it describes no patient. */
@Serializable
data class SymptomsResponse(val symptoms: List<String>)

/** `POST /api/diseases`: the diseases the case a question describes names; none when it names none. */
@Serializable
data class DiseasesResponse(val diseases: List<String>)

/** `POST /api/chat`: the answer plus the trimmed history and the summary to send with the next question. */
@Serializable
data class ChatResponse(
    val answer: String,
    val corpusVersion: String,
    val model: String,
    val sources: List<Citation>,
    val history: List<ChatTurn>,
    /** What the chat's earlier turns were condensed into, now or before. */
    val summary: String? = null,
)

package io.github.rasagyavatsal.homeoremedica.api

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

// Mirrors the web app's server contracts (src/server/contracts.ts).

@Serializable
data class Book(
    val bookId: String,
    val title: String,
    val author: String? = null,
)

/** `GET /api/books` */
@Serializable
data class BookCatalog(val books: List<Book>)

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
data class ChatRequest(val message: String, val history: List<ChatTurn>)

/** `POST /api/chat`: the answer plus the trimmed history to send with the next question. */
@Serializable
data class ChatResponse(
    val answer: String,
    val corpusVersion: String,
    val model: String,
    val sources: List<Citation>,
    val history: List<ChatTurn>,
)

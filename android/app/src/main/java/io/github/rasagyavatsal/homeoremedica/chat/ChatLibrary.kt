package io.github.rasagyavatsal.homeoremedica.chat

import io.github.rasagyavatsal.homeoremedica.api.ApiJson
import io.github.rasagyavatsal.homeoremedica.api.ChatTurn
import io.github.rasagyavatsal.homeoremedica.api.Citation
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

// Ports the web app's saved chats (src/web/library.ts) for chats kept on the device.

/** How many chats the device keeps; saving another drops the oldest. */
const val MAX_LOCAL_CHATS = 50

private const val MAX_TITLE_CHARS = 80

enum class MessageStatus { Streaming, Stopped, Error }

@Serializable
data class Message(
    val id: Long,
    val role: Role,
    val content: String,
    /** Null until the server has sent the passages it found. */
    val sources: List<Citation>? = null,
    /** Null once an answer is complete. */
    val status: MessageStatus? = null,
    val error: String? = null,
)

/** The messages worth keeping: failed questions and their errors are left out. */
fun savedMessages(messages: List<Message>): List<Message> = messages.filterIndexed { index, message ->
    message.status != MessageStatus.Error && messages.getOrNull(index + 1)?.status != MessageStatus.Error
}

/** A chat's title: its first question on one line, cut to 80 characters. */
fun titleFrom(question: String): String {
    val line = question.replace(Regex("""\s+"""), " ").trim()
    return if (line.length > MAX_TITLE_CHARS) "${line.take(MAX_TITLE_CHARS - 1).trimEnd()}…" else line
}

/** A saved chat as the chat list shows it. */
@Serializable
data class ChatSummary(val id: String, val title: String, val updatedAt: Long)

@Serializable
data class SavedChat(
    val id: String,
    val title: String,
    /** When the last answer finished, in milliseconds. */
    val updatedAt: Long,
    val messages: List<Message>,
    val history: List<ChatTurn>,
    val summary: String? = null,
) {
    fun summarize() = ChatSummary(id, title, updatedAt)
}

/** Where saved chats live. */
interface ChatLibrary {
    /** Saved chats, newest first. */
    fun list(): List<ChatSummary>

    fun open(id: String): SavedChat?

    /** Save [chat], replacing any earlier copy; throws [IOException] if it cannot be stored. */
    fun save(chat: SavedChat)

    fun remove(id: String)
}

/** The chat the app had open, so the next launch returns to it. */
interface LastChat {
    fun get(): String?
    fun set(id: String?)
}

/** Chats kept in one file on the device, at most [MAX_LOCAL_CHATS] of them. */
class FileChatLibrary(private val file: File) : ChatLibrary {
    /** Every stored chat, newest first; unreadable entries are skipped. */
    private fun all(): List<SavedChat> {
        val entries = try {
            ApiJson.decodeFromString<List<JsonElement>>(file.readText())
        } catch (_: Exception) {
            return emptyList()
        }
        return entries
            .mapNotNull { runCatching { ApiJson.decodeFromJsonElement<SavedChat>(it) }.getOrNull() }
            .sortedByDescending { it.updatedAt }
    }

    override fun list(): List<ChatSummary> = all().map { it.summarize() }

    override fun open(id: String): SavedChat? = all().find { it.id == id }

    override fun save(chat: SavedChat) = write((listOf(chat) + all().filter { it.id != chat.id }).take(MAX_LOCAL_CHATS))

    override fun remove(id: String) = write(all().filter { it.id != id })

    private fun write(chats: List<SavedChat>) {
        // Written whole and then swapped in, so a failed write leaves the earlier chats.
        val partial = File(file.parentFile, "${file.name}.tmp")
        partial.writeText(ApiJson.encodeToString(chats))
        Files.move(partial.toPath(), file.toPath(), StandardCopyOption.ATOMIC_MOVE)
    }
}

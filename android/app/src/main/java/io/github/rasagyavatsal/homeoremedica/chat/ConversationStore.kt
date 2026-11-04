package io.github.rasagyavatsal.homeoremedica.chat

import io.github.rasagyavatsal.homeoremedica.api.ApiJson
import io.github.rasagyavatsal.homeoremedica.api.ChatTurn
import io.github.rasagyavatsal.homeoremedica.api.Citation
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.serialization.Serializable
import java.io.File
import java.io.IOException

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

@Serializable
data class SavedConversation(val messages: List<Message>, val history: List<ChatTurn>, val summary: String? = null)

/** Where the conversation is kept so it outlives the process, like the web app's tab session storage. */
interface ConversationStore {
    fun load(): SavedConversation?
    fun save(conversation: SavedConversation)
    fun clear()
}

class FileConversationStore(private val file: File) : ConversationStore {
    override fun load(): SavedConversation? = try {
        ApiJson.decodeFromString<SavedConversation>(file.readText())
    } catch (_: Exception) {
        // A missing or unreadable copy starts a fresh conversation.
        null
    }

    override fun save(conversation: SavedConversation) {
        if (conversation.messages.isEmpty()) return clear()
        try {
            val partial = File(file.parentFile, "${file.name}.tmp")
            partial.writeText(ApiJson.encodeToString(conversation))
            partial.renameTo(file)
        } catch (_: IOException) {
            // A full disk only loses the copy kept for process restarts.
        }
    }

    override fun clear() {
        file.delete()
    }
}

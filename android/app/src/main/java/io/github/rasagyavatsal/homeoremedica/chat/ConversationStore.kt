package io.github.rasagyavatsal.homeoremedica.chat

import io.github.rasagyavatsal.homeoremedica.api.ApiJson
import io.github.rasagyavatsal.homeoremedica.api.ChatTurn
import io.github.rasagyavatsal.homeoremedica.api.Citation
import io.github.rasagyavatsal.homeoremedica.api.Role
import kotlinx.serialization.Serializable
import java.io.File
import java.io.IOException

@Serializable
data class Message(
    val id: Long,
    val role: Role,
    val content: String,
    val sources: List<Citation> = emptyList(),
)

@Serializable
data class SavedConversation(val messages: List<Message>, val history: List<ChatTurn>)

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

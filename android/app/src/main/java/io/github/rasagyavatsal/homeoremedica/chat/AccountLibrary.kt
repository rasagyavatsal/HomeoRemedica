package io.github.rasagyavatsal.homeoremedica.chat

import io.github.rasagyavatsal.homeoremedica.account.AuthException
import io.github.rasagyavatsal.homeoremedica.account.SIGN_IN_AGAIN
import io.github.rasagyavatsal.homeoremedica.api.AnswerRatings
import io.github.rasagyavatsal.homeoremedica.api.ApiException
import io.github.rasagyavatsal.homeoremedica.api.Feedback
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.api.Role
import io.github.rasagyavatsal.homeoremedica.api.SavedChatBody
import io.github.rasagyavatsal.homeoremedica.api.SavedMessage
import io.github.rasagyavatsal.homeoremedica.api.toSaved
import java.io.IOException

// Ports the web app's account library (src/web/library.ts).

/** Chats saved to the signed-in account through the API; [token] gives a current ID token. */
class AccountLibrary(private val api: HomeoRemedicaApi, private val token: suspend () -> String) : ChatLibrary {
    private suspend fun signedIn(): String = try {
        token()
    } catch (failure: AuthException) {
        throw ApiException(failure.message ?: SIGN_IN_AGAIN, 401)
    }

    override suspend fun list(): List<ChatSummary> = api.listChats(signedIn()).map { ChatSummary(it.id, it.title, it.updatedAt) }

    override suspend fun open(id: String): SavedChat? {
        val chat = api.getChat(signedIn(), id) ?: return null
        val messages = chat.messages.map { Message(it.id, it.role, it.content, it.sources?.map { source -> source.toCitation() }) }
        val title = titleFrom(messages.firstOrNull { it.role == Role.User }?.content.orEmpty())
        return SavedChat(id, title, 0, messages, chat.history, chat.summary)
    }

    override suspend fun save(chat: SavedChat) {
        val messages = savedMessages(chat.messages).map { SavedMessage(it.id, it.role, it.content, it.sources?.map { source -> source.toSaved() }) }
        api.putChat(signedIn(), chat.id, SavedChatBody(chat.title, chat.updatedAt, messages, chat.history, chat.summary))
    }

    override suspend fun remove(id: String) = api.deleteChat(signedIn(), id)

    /** Save the ratings of one answer, replacing any sent for it before. */
    suspend fun rate(id: String, feedback: Feedback) = api.putFeedback(signedIn(), id, feedback)

    /** The ratings saved for a chat's answers, by message id. */
    suspend fun ratings(chatId: String): Map<Long, AnswerRatings> = api.chatRatings(signedIn(), chatId)

    /** Delete every chat and then the account itself. */
    suspend fun deleteAccount() = api.deleteAccount(signedIn())
}

/**
 * Move the chats saved on the device into the account, removing each from the device once it is
 * saved. Returns how many could not be moved; they stay on the device.
 */
suspend fun moveIntoAccount(local: ChatLibrary, account: ChatLibrary): Int {
    var failed = 0
    for (summary in local.list()) {
        try {
            val chat = local.open(summary.id) ?: continue
            account.save(chat)
            local.remove(chat.id)
        } catch (_: IOException) {
            failed++
        } catch (_: ApiException) {
            failed++
        }
    }
    return failed
}

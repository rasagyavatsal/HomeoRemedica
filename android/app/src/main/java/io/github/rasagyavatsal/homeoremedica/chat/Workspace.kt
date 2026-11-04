package io.github.rasagyavatsal.homeoremedica.chat

/** What the account side changes in the chats: where they are saved, and the notices it shows. */
interface Workspace {
    /** Show [message] to the reader, as the web app's toast. */
    fun notify(message: String)
}

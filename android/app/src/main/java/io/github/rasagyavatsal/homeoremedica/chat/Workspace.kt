package io.github.rasagyavatsal.homeoremedica.chat

/** What the account side changes in the chats: where they are saved, and the notices it shows. */
interface Workspace {
    /** Save chats to [library], or to nowhere yet when it is null; a [fresh] workspace starts a new chat. */
    fun useLibrary(library: ChatLibrary?, fresh: Boolean)

    /** Show [message] to the reader, as the web app's toast. */
    fun notify(message: String)
}

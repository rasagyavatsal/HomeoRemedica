package io.github.rasagyavatsal.homeoremedica.chat

import io.github.rasagyavatsal.homeoremedica.api.Role
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class FileChatLibraryTest {
    @get:Rule
    val folder = TemporaryFolder()

    private fun chat(id: String, updatedAt: Long) =
        SavedChat(id, "Chat $id", updatedAt, listOf(Message(0, Role.User, "Question $id")), emptyList())

    @Test
    fun keepsTheNewestFiftyChats() {
        val library = FileChatLibrary(folder.root.resolve("chats.json"))
        for (n in 1..MAX_LOCAL_CHATS + 2) library.save(chat("$n", n.toLong()))

        val listed = library.list()
        assertEquals(MAX_LOCAL_CHATS, listed.size)
        assertEquals("${MAX_LOCAL_CHATS + 2}", listed.first().id)
        assertEquals("3", listed.last().id)
        assertNull(library.open("1"))
    }

    @Test
    fun replacesRemovesAndReopensChats() {
        val file = folder.root.resolve("chats.json")
        val library = FileChatLibrary(file)
        library.save(chat("a", 1))
        library.save(chat("b", 2))
        library.save(chat("a", 3).copy(title = "Renamed"))
        library.remove("b")

        val reopened = FileChatLibrary(file)
        assertEquals(listOf(ChatSummary("a", "Renamed", 3)), reopened.list())
        assertEquals("Question a", reopened.open("a")?.messages?.single()?.content)
    }

    @Test
    fun skipsUnreadableChats() {
        val file = folder.root.resolve("chats.json")
        file.writeText("""[{"id":"a","title":"A","updatedAt":1,"messages":[],"history":[]},{"id":3}]""")
        assertEquals(listOf("a"), FileChatLibrary(file).list().map { it.id })

        file.writeText("not json")
        assertTrue(FileChatLibrary(file).list().isEmpty())
    }

    @Test
    fun titlesChatsWithTheirFirstQuestionOnOneLine() {
        assertEquals("Pulsatilla in children?", titleFrom("  Pulsatilla\n in   children? "))
        val long = titleFrom("word ".repeat(40))
        assertEquals(80, long.length)
        assertTrue(long.endsWith("…"))
    }
}

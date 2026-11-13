package io.github.rasagyavatsal.homeoremedica.ui

import io.github.rasagyavatsal.homeoremedica.chat.ChatSummary
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneOffset
import java.util.Locale

class SidebarTest {
    private val today = LocalDate.of(2026, 11, 4)

    private fun chat(id: String, at: LocalDateTime) = ChatSummary(id, id, at.toInstant(ZoneOffset.UTC).toEpochMilli())

    @Test
    fun groupsChatsByAge() {
        val chats = listOf(
            chat("morning", today.atTime(9, 0)),
            chat("midnight", today.atStartOfDay()),
            chat("yesterday", today.minusDays(1).atTime(23, 59)),
            chat("last week", today.minusDays(7).atTime(12, 0)),
            chat("older", today.minusDays(8).atTime(12, 0)),
        )

        val groups = groupByAge(chats, today, ZoneOffset.UTC)
        assertEquals(listOf("Today", "Yesterday", "Previous 7 days", "Older"), groups.map { it.label })
        assertEquals(listOf("morning", "midnight"), groups[0].chats.map { it.id })
        assertEquals(listOf(listOf("yesterday"), listOf("last week"), listOf("older")), groups.drop(1).map { group -> group.chats.map { it.id } })
    }

    @Test
    fun shortensAChatsTimeByAge() {
        fun time(at: LocalDateTime) = chatTime(chat("", at).updatedAt, today, ZoneOffset.UTC, Locale.UK)
        assertEquals("09:00", time(today.atTime(9, 0)))
        assertEquals("Tue", time(today.minusDays(1).atTime(23, 59)))
        assertEquals("Thu", time(today.minusDays(6).atTime(12, 0)))
        assertEquals("28 Oct", time(today.minusDays(7).atTime(12, 0)))
        assertEquals("4 Nov 2025", time(today.minusYears(1).atTime(12, 0)))
    }
}

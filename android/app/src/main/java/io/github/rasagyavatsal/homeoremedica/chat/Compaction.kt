package io.github.rasagyavatsal.homeoremedica.chat

import io.github.rasagyavatsal.homeoremedica.api.ChatTurn

// Ports the web app's compaction check (src/web/conversation.ts).

// The server's limits on what the model reads from earlier in a chat.
const val CONTEXT_CHARS = 16_000
const val CONTEXT_TURNS = 20

// The server keeps the latest exchange word for word when it compacts a chat.
private const val KEPT_TURNS = 2

// How full the context may get before a chat is compacted ahead of the next question, leaving room
// for that exchange so the server does not drop the earliest turns instead.
private const val COMPACT_FROM = 0.8

/** How full the model's context is, from 0 to 1, by whichever limit is nearer. */
fun contextFraction(history: List<ChatTurn>, summary: String?): Double {
    val chars = history.sumOf { it.content.length } + (summary?.length ?: 0)
    return minOf(1.0, maxOf(chars.toDouble() / CONTEXT_CHARS, history.size.toDouble() / CONTEXT_TURNS))
}

/** Whether to condense a chat's earlier turns before its next question. */
fun shouldCompact(history: List<ChatTurn>, summary: String?): Boolean =
    // Only turns older than the latest exchange can be condensed.
    history.size > KEPT_TURNS && contextFraction(history, summary) >= COMPACT_FROM

package io.github.rasagyavatsal.homeoremedica.api

import okio.BufferedSource

data class ServerSentEvent(val event: String, val data: String)

/** Read the events of a `text/event-stream` body one at a time; null once the stream ends. */
class ServerSentEventReader(private val source: BufferedSource) {
    fun next(): ServerSentEvent? {
        var event = "message"
        val data = mutableListOf<String>()
        while (true) {
            val line = source.readUtf8Line()
            if (line == null || line.isEmpty()) {
                // A blank line ends an event; blocks without data, such as comments, are skipped.
                if (data.isNotEmpty()) return ServerSentEvent(event, data.joinToString("\n"))
                if (line == null) return null
                event = "message"
                continue
            }
            when {
                line.startsWith("event:") -> event = line.substring(6).trim()
                line.startsWith("data:") -> data += line.substring(5).removePrefix(" ")
            }
        }
    }
}

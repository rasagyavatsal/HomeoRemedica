package io.github.rasagyavatsal.homeoremedica.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.decodeFromJsonElement
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

/** A failure whose message is safe to show as is. */
class ApiException(message: String) : Exception(message)

// The web app's messages (src/web/api.ts).
const val GENERIC_ERROR = "Something went wrong. Please try again."
const val INVALID_RESPONSE_ERROR = "The API returned an invalid response. Please try again."
const val INTERRUPTED_ERROR = "The answer stopped before it finished. Please try again."
const val NETWORK_ERROR = "The server could not be reached. Check your connection and try again."

val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
}

/** The HomeoRemedica web API; the server holds the provider keys, so the app holds none. */
class HomeoRemedicaApi(
    baseUrl: String,
    private val client: OkHttpClient = defaultClient(),
) {
    private val baseUrl = baseUrl.trimEnd('/')

    /** Ask a question, reporting sources and answer text as the server streams them. */
    suspend fun sendMessage(
        message: String,
        history: List<ChatTurn>,
        summary: String? = null,
        onSources: (List<Citation>) -> Unit = {},
        onText: (String) -> Unit = {},
    ): ChatResponse {
        val body = ApiJson.encodeToString(ChatRequest(message, history, summary)).toRequestBody(JSON)
        val request = Request.Builder()
            .url("$baseUrl/api/chat")
            .header("Accept", "text/event-stream")
            .post(body)
            .build()
        return client.newCall(request).await { response ->
            // Errors raised before streaming starts, and servers that do not stream, answer with JSON.
            val type = response.header("Content-Type").orEmpty()
            if (!response.isSuccessful || !type.contains("text/event-stream")) readResponse<ChatResponse>(response)
            else readStream(ServerSentEventReader(response.body.source()), onSources, onText)
        }
    }

    /** Condense a chat's earlier turns into a summary, keeping the latest exchange word for word. */
    suspend fun compactChat(history: List<ChatTurn>, summary: String?): CompactResponse {
        val body = ApiJson.encodeToString(CompactRequest(history, summary)).toRequestBody(JSON)
        val request = Request.Builder().url("$baseUrl/api/chat/compact").post(body).build()
        return client.newCall(request).await { response -> readResponse<CompactResponse>(response) }
    }

    /** Stream order: `sources`, then `text` pieces, then `done` with the full response or `error`. */
    private fun readStream(
        events: ServerSentEventReader,
        onSources: (List<Citation>) -> Unit,
        onText: (String) -> Unit,
    ): ChatResponse {
        while (true) {
            val (event, data) = events.next() ?: throw ApiException(INTERRUPTED_ERROR)
            when (event) {
                "sources" -> onSources(decode<List<Citation>>(data))
                "text" -> onText(decode<TextPiece>(data).text)
                "done" -> return decode<ChatResponse>(data)
                "error" -> throw ApiException(detailOf(parse(data)) ?: GENERIC_ERROR)
            }
        }
    }

    @Serializable
    private data class TextPiece(val text: String)

    companion object {
        private val JSON = "application/json".toMediaType()

        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            // Retrieval and generation can pause between events, and Cloud Run may start cold.
            .readTimeout(90, TimeUnit.SECONDS)
            .build()
    }
}

/** Run the call off the main thread, cancelling it with the calling coroutine. */
private suspend fun <T> Call.await(read: (Response) -> T): T = coroutineScope {
    // A blocking read never sees the coroutine cancelled, so cancel the call itself as soon as it is.
    val watcher = launch {
        try {
            awaitCancellation()
        } finally {
            this@await.cancel()
        }
    }
    try {
        withContext(Dispatchers.IO) {
            try {
                execute().use(read)
            } catch (failure: IOException) {
                ensureActive()
                throw ApiException(NETWORK_ERROR)
            }
        }
    } finally {
        watcher.cancel()
    }
}

private inline fun <reified T> readResponse(response: Response): T {
    val body = parse(response.body.string())
    if (!response.isSuccessful) throw ApiException(detailOf(body) ?: GENERIC_ERROR)
    if (body !is JsonObject) throw ApiException(INVALID_RESPONSE_ERROR)
    return try {
        ApiJson.decodeFromJsonElement<T>(body)
    } catch (_: SerializationException) {
        throw ApiException(INVALID_RESPONSE_ERROR)
    } catch (_: IllegalArgumentException) {
        throw ApiException(INVALID_RESPONSE_ERROR)
    }
}

private inline fun <reified T> decode(data: String): T = try {
    ApiJson.decodeFromString<T>(data)
} catch (_: SerializationException) {
    throw ApiException(INVALID_RESPONSE_ERROR)
} catch (_: IllegalArgumentException) {
    throw ApiException(INVALID_RESPONSE_ERROR)
}

private fun parse(text: String): JsonElement? = try {
    ApiJson.parseToJsonElement(text)
} catch (_: SerializationException) {
    null
}

/** The server's `detail`: a message, or a list of validation issues with `msg` fields. */
internal fun detailOf(body: JsonElement?): String? {
    val detail = (body as? JsonObject)?.get("detail") ?: return null
    return when (detail) {
        is JsonPrimitive -> detail.contentOrNull.takeIf { detail.isString }
        is JsonArray -> detail
            .mapNotNull { item -> ((item as? JsonObject)?.get("msg") as? JsonPrimitive)?.contentOrNull }
            .filter(String::isNotEmpty)
            .joinToString(" ")
            .ifEmpty { null }
        else -> null
    }
}

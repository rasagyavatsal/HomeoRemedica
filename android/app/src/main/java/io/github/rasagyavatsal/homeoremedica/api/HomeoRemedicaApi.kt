package io.github.rasagyavatsal.homeoremedica.api

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
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

const val GENERIC_ERROR = "The request could not be completed. Please try again."
const val INVALID_RESPONSE_ERROR = "The API returned an invalid response. Please try again."
const val INTERRUPTED_ERROR = "The answer was interrupted. Please try again."
const val NETWORK_ERROR = "Could not reach HomeoRemedica. Check your connection and try again."

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

    suspend fun loadBooks(): BookCatalog {
        val request = Request.Builder().url("$baseUrl/api/books").get().build()
        return client.newCall(request).await { response -> readResponse<BookCatalog>(response) }
    }

    /** Ask a question, reporting sources and answer text as the server streams them. */
    suspend fun sendMessage(
        message: String,
        history: List<ChatTurn>,
        onSources: (List<Citation>) -> Unit = {},
        onText: (String) -> Unit = {},
    ): ChatResponse {
        val body = ApiJson.encodeToString(ChatRequest(message, history)).toRequestBody(JSON)
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
private suspend fun <T> Call.await(read: (Response) -> T): T = withContext(Dispatchers.IO) {
    val cancellation = coroutineContext.job.invokeOnCompletion { cancel() }
    try {
        execute().use(read)
    } catch (failure: IOException) {
        coroutineContext.ensureActive()
        throw ApiException(NETWORK_ERROR)
    } finally {
        cancellation.dispose()
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

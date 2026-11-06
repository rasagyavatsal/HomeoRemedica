package io.github.rasagyavatsal.homeoremedica.support

import androidx.test.platform.app.InstrumentationRegistry
import io.github.rasagyavatsal.homeoremedica.BuildConfig
import io.github.rasagyavatsal.homeoremedica.api.AnswerRatings
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.chat.FileChatLibrary
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.util.UUID

data class TestUser(val email: String, val password: String)

/** Accounts in the Firebase Auth emulator, reached through `adb reverse` as the app reaches it (e2e/accounts.ts). */
object Accounts {
    private const val EMULATOR = "http://localhost:9099"
    private const val PROJECT_ID = "demo-homeoremedica"
    private const val API_KEY = "e2e-api-key"
    private val http = OkHttpClient()
    private val json = "application/json".toMediaType()

    /** An email address no other test uses. */
    fun newUser() = TestUser("android-e2e-${UUID.randomUUID()}@example.com", "e2e-password")

    /** Create an account, with its email address already verified unless asked not to. */
    fun createUser(verified: Boolean = true): TestUser {
        val user = newUser()
        val created = post(
            "$EMULATOR/identitytoolkit.googleapis.com/v1/accounts:signUp?key=$API_KEY",
            buildJsonObject {
                put("email", user.email)
                put("password", user.password)
                put("returnSecureToken", true)
            },
        ) ?: error("The Auth emulator did not create ${user.email}.")
        if (verified) {
            post(
                "$EMULATOR/identitytoolkit.googleapis.com/v1/projects/$PROJECT_ID/accounts:update",
                buildJsonObject {
                    put("localId", created.getValue("localId").jsonPrimitive.content)
                    put("emailVerified", true)
                },
                // The emulator takes this as an administrator's credential.
                admin = true,
            ) ?: error("The Auth emulator did not verify ${user.email}.")
        }
        return user
    }

    /** An ID token for [user], or null when the account cannot sign in, as once it is deleted. */
    fun token(user: TestUser): String? = post(
        "$EMULATOR/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=$API_KEY",
        buildJsonObject {
            put("email", user.email)
            put("password", user.password)
            put("returnSecureToken", true)
        },
    )?.getValue("idToken")?.jsonPrimitive?.content

    /** The latest link of [kind] (VERIFY_EMAIL or PASSWORD_RESET) the emulator would have emailed to [email]. */
    fun emailedLink(email: String, kind: String): String = eventually {
        val body = get("$EMULATOR/emulator/v1/projects/$PROJECT_ID/oobCodes")
        Json.parseToJsonElement(body).jsonObject.getValue("oobCodes").jsonArray
            .map { it.jsonObject }
            .lastOrNull { it["email"]?.jsonPrimitive?.content == email && it["requestType"]?.jsonPrimitive?.content == kind }
            ?.getValue("oobLink")?.jsonPrimitive?.content
            ?: throw AssertionError("No $kind link was sent to $email.")
    }

    /** Follow an emailed link, as the reader would in their mail app. */
    fun follow(link: String) {
        get(link)
    }

    private fun post(url: String, body: JsonObject, admin: Boolean = false): JsonObject? {
        val request = Request.Builder()
            .url(url)
            .apply { if (admin) header("Authorization", "Bearer owner") }
            .post(body.toString().toRequestBody(json))
            .build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) return null
            return Json.parseToJsonElement(response.body.string()).jsonObject
        }
    }

    private fun get(url: String): String = http.newCall(Request.Builder().url(url).build()).execute().use { response ->
        check(response.isSuccessful) { "GET $url answered ${response.code}." }
        response.body.string()
    }
}

/** What the e2e server keeps for an account, read through the app's own API client. */
object Server {
    private val api = HomeoRemedicaApi(BuildConfig.API_BASE_URL)

    /** The titles of [user]'s saved chats, newest first. */
    fun chatTitles(user: TestUser): List<String> = runBlocking { api.listChats(token(user)).map { it.title } }

    /** The ratings saved for the only answer in [user]'s chat titled [title]. */
    fun ratings(user: TestUser, title: String): AnswerRatings? = runBlocking {
        val token = token(user)
        val chat = api.listChats(token).first { it.title == title }
        api.chatRatings(token, chat.id).values.singleOrNull()
    }

    private fun token(user: TestUser) = Accounts.token(user) ?: error("${user.email} cannot sign in.")
}

/** The chats the app keeps on the device for a signed-out reader. */
object Device {
    private val library get() = FileChatLibrary(File(InstrumentationRegistry.getInstrumentation().targetContext.noBackupFilesDir, "chats.json"))

    fun chatTitles(): List<String> = runBlocking { library.list().map { it.title } }
}

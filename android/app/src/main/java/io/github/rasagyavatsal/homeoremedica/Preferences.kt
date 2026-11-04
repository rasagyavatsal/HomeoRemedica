package io.github.rasagyavatsal.homeoremedica

import android.content.SharedPreferences
import androidx.core.content.edit
import io.github.rasagyavatsal.homeoremedica.chat.LastChat
import io.github.rasagyavatsal.homeoremedica.ui.theme.ThemeChoice

/** What the app remembers on the device besides its chats, as the web app keeps in local storage. */
class Preferences(private val prefs: SharedPreferences) {
    var theme: ThemeChoice
        get() = ThemeChoice.entries.find { it.key == prefs.getString(THEME, null) } ?: ThemeChoice.System
        set(value) = prefs.edit {
            if (value == ThemeChoice.System) remove(THEME) else putString(THEME, value.key)
        }

    /** The chat the app had open, so the next launch returns to it. */
    val lastChat = object : LastChat {
        override fun get(): String? = prefs.getString(OPEN_CHAT, null)
        override fun set(id: String?) = prefs.edit { if (id == null) remove(OPEN_CHAT) else putString(OPEN_CHAT, id) }
    }

    private companion object {
        const val THEME = "theme"
        const val OPEN_CHAT = "openChat"
    }
}

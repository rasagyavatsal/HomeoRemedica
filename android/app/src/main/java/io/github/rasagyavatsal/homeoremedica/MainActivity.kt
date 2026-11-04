package io.github.rasagyavatsal.homeoremedica

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.toArgb
import androidx.compose.runtime.CompositionLocalProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.chat.ChatViewModel
import io.github.rasagyavatsal.homeoremedica.chat.FileConversationStore
import io.github.rasagyavatsal.homeoremedica.ui.ChatScreen
import io.github.rasagyavatsal.homeoremedica.ui.theme.DarkPalette
import io.github.rasagyavatsal.homeoremedica.ui.theme.HomeoRemedicaTheme
import io.github.rasagyavatsal.homeoremedica.ui.theme.LightPalette
import io.github.rasagyavatsal.homeoremedica.ui.theme.LocalThemeControl
import io.github.rasagyavatsal.homeoremedica.ui.theme.ThemeChoice
import io.github.rasagyavatsal.homeoremedica.ui.theme.ThemeControl
import java.io.File

class MainActivity : ComponentActivity() {
    private val viewModel: ChatViewModel by viewModels {
        val conversation = File(noBackupFilesDir, "conversation.json")
        viewModelFactory {
            initializer {
                ChatViewModel(HomeoRemedicaApi(BuildConfig.API_BASE_URL), FileConversationStore(conversation), createSavedStateHandle())
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val preferences = Preferences(getSharedPreferences("homeoremedica", MODE_PRIVATE))
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContent {
            var theme by remember { mutableStateOf(preferences.theme) }
            val dark = when (theme) {
                ThemeChoice.System -> isSystemInDarkTheme()
                ThemeChoice.Light -> false
                ThemeChoice.Dark -> true
            }
            // The system bars and the window behind the app follow the chosen theme, not only the system's.
            LaunchedEffect(dark) {
                val bars = if (dark) SystemBarStyle.dark(Color.TRANSPARENT) else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
                window.setBackgroundDrawable(ColorDrawable((if (dark) DarkPalette else LightPalette).canvas.toArgb()))
            }
            val control = remember(theme) {
                ThemeControl(theme) {
                    theme = theme.next
                    preferences.theme = theme
                }
            }
            CompositionLocalProvider(LocalThemeControl provides control) {
                HomeoRemedicaTheme(dark) {
                    ChatScreen(viewModel)
                }
            }
        }
    }
}

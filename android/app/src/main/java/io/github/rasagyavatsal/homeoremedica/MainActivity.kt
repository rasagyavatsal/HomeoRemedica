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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.toArgb
import androidx.compose.runtime.CompositionLocalProvider
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.rasagyavatsal.homeoremedica.account.AccountViewModel
import io.github.rasagyavatsal.homeoremedica.account.FirebaseAuthClient
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.chat.AccountLibrary
import io.github.rasagyavatsal.homeoremedica.chat.ChatViewModel
import io.github.rasagyavatsal.homeoremedica.chat.FileChatLibrary
import io.github.rasagyavatsal.homeoremedica.ui.AccountControls
import io.github.rasagyavatsal.homeoremedica.ui.AuthDialog
import io.github.rasagyavatsal.homeoremedica.ui.DeleteAccountDialog
import io.github.rasagyavatsal.homeoremedica.ui.ChatScreen
import io.github.rasagyavatsal.homeoremedica.ui.LegalPage
import io.github.rasagyavatsal.homeoremedica.ui.LegalPageName
import io.github.rasagyavatsal.homeoremedica.ui.LocalOpenLegal
import io.github.rasagyavatsal.homeoremedica.ui.PractitionerNotice
import io.github.rasagyavatsal.homeoremedica.ui.theme.DarkPalette
import io.github.rasagyavatsal.homeoremedica.ui.theme.HomeoRemedicaTheme
import io.github.rasagyavatsal.homeoremedica.ui.theme.LightPalette
import io.github.rasagyavatsal.homeoremedica.ui.theme.LocalThemeControl
import io.github.rasagyavatsal.homeoremedica.ui.theme.ThemeChoice
import io.github.rasagyavatsal.homeoremedica.ui.theme.ThemeControl
import java.io.File

class MainActivity : ComponentActivity() {
    private val preferences by lazy { Preferences(getSharedPreferences("homeoremedica", MODE_PRIVATE)) }

    private val api by lazy { HomeoRemedicaApi(BuildConfig.API_BASE_URL) }

    // The account view model tells it where chats are saved once it knows who is signed in.
    private val viewModel: ChatViewModel by viewModels {
        viewModelFactory { initializer { ChatViewModel(api, null, preferences.lastChat) } }
    }

    private val accounts: AccountViewModel by viewModels {
        viewModelFactory {
            initializer {
                val local = FileChatLibrary(File(noBackupFilesDir, "chats.json"))
                AccountViewModel(
                    FirebaseAuthClient.create(applicationContext),
                    viewModel,
                    local,
                    remote = { auth -> AccountLibrary(api, auth::token) },
                    lastChat = preferences.lastChat,
                )
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
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
            // A legal page shows over the chat, which keeps answering underneath.
            var legal by rememberSaveable { mutableStateOf<LegalPageName?>(null) }
            var notice by remember { mutableStateOf(!preferences.noticeAcknowledged) }
            var signingIn by rememberSaveable { mutableStateOf(false) }
            var deleting by rememberSaveable { mutableStateOf(false) }
            val account by accounts.state.collectAsStateWithLifecycle()
            // A verification made from the link in the email shows when the app comes back.
            LifecycleResumeEffect(Unit) {
                accounts.refresh()
                onPauseOrDispose {}
            }
            CompositionLocalProvider(LocalThemeControl provides control, LocalOpenLegal provides { legal = it }) {
                HomeoRemedicaTheme(dark) {
                    ChatScreen(viewModel) {
                        AccountControls(
                            account.account,
                            onSignIn = if (account.available) ({ signingIn = true }) else null,
                            onResendVerification = accounts::resendVerification,
                            onSignOut = accounts::signOut,
                            onDeleteAccount = { deleting = true },
                        )
                    }
                    val auth = accounts.auth
                    if (signingIn && auth != null) AuthDialog(auth) { signingIn = false }
                    if (deleting && account.account != null) {
                        DeleteAccountDialog(
                            onDelete = {
                                accounts.deleteAccount()
                                deleting = false
                            },
                            onClose = { deleting = false },
                        )
                    }
                    if (notice) {
                        PractitionerNotice {
                            preferences.acknowledgeNotice()
                            notice = false
                        }
                    }
                    legal?.let { page -> LegalPage(page, onOpen = { legal = it }, onClose = { legal = null }) }
                }
            }
        }
    }
}

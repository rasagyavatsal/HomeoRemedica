package io.github.rasagyavatsal.homeoremedica

import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import io.github.rasagyavatsal.homeoremedica.api.HomeoRemedicaApi
import io.github.rasagyavatsal.homeoremedica.chat.ChatViewModel
import io.github.rasagyavatsal.homeoremedica.chat.FileConversationStore
import io.github.rasagyavatsal.homeoremedica.ui.ChatScreen
import io.github.rasagyavatsal.homeoremedica.ui.theme.HomeoRemedicaTheme
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
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(Color.TRANSPARENT, Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        setContent {
            HomeoRemedicaTheme {
                ChatScreen(viewModel)
            }
        }
    }
}

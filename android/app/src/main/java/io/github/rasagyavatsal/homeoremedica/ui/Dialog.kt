package io.github.rasagyavatsal.homeoremedica.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Ports the web app's modal dialog (src/web/Dialog.tsx).

/** A modal dialog over the app, open while it is composed; back, the close button and the scrim call [onClose]. */
@Composable
fun Dialog(title: String, onClose: () -> Unit, description: String? = null, content: @Composable () -> Unit) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(16.dp)
    BackHandler(onBack = onClose)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(Modifier.fillMaxSize().background(colors.scrim).pressable(label = "Close", onClick = onClose))
        Column(
            Modifier
                .safeDrawingPadding()
                .padding(16.dp)
                .widthIn(max = 384.dp)
                .fillMaxWidth()
                .rise(title, 200)
                .shadowLarge(shape, colors.shadow)
                .background(colors.surfaceRaised, shape)
                .border(1.dp, colors.border, shape)
                // Scrolling also takes the dialog's taps, so they stay off the scrim.
                .verticalScroll(rememberScrollState())
                .padding(24.dp)
                .semantics { paneTitle = title },
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(
                    Modifier.fillMaxWidth().padding(top = 0.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    BasicText(
                        title,
                        style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 22.sp, lineHeight = 28.sp),
                        modifier = Modifier.weight(1f).semantics { heading() },
                    )
                    IconButton(Icons.Close, "Close", onClose, Modifier.padding(end = 0.dp), raised = true)
                }
                // The web app's `.dialog-description`.
                if (description != null) {
                    BasicText(description, style = TextStyle(color = colors.textMuted, fontFamily = Fonts.sans, fontSize = 13.sp, lineHeight = 18.sp))
                }
            }
            content()
        }
    }
}

/** The body text of a dialog. */
@Composable
fun dialogText(): TextStyle = TextStyle(color = Theme.colors.text, fontFamily = Fonts.sans, fontSize = 15.sp, lineHeight = 21.sp)

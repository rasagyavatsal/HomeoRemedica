package io.github.rasagyavatsal.homeoremedica.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

/** Closes the dialog being composed, sliding its sheet away first on phones. */
private val LocalDialogClose = compositionLocalOf<(() -> Unit)?> { null }

/** What closes the dialog around this: its sheet's slide on phones, or [onClose]. */
@Composable
fun dialogClose(onClose: () -> Unit): () -> Unit = LocalDialogClose.current ?: onClose

/**
 * A modal dialog over the app, open while it is composed: a bottom sheet on phones, and a centred dialog
 * on wide screens, as the web app's (src/web/Dialog.tsx). Back, the scrim and the sheet's handle or the
 * dialog's close button call [onClose]; while it is not [dismissible], they do nothing.
 */
@Composable
fun Dialog(
    title: String,
    onClose: () -> Unit,
    description: String? = null,
    dismissible: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colors = Theme.colors
    if (LocalCompact.current) {
        BottomSheet(title, onClose, title = title, dismissible = dismissible) {
            CompositionLocalProvider(LocalDialogClose provides ::dismiss) {
                Column(
                    Modifier
                        .verticalScroll(rememberScrollState())
                        .padding(start = 24.dp, end = 24.dp, bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    if (description != null) {
                        BasicText(description, style = TextStyle(color = colors.textMuted, fontFamily = Fonts.sans, fontSize = 14.sp, lineHeight = 20.sp))
                    }
                    content()
                }
            }
        }
        return
    }
    val close = { if (dismissible) onClose() }
    val shape = RoundedCornerShape(16.dp)
    BackHandler(onBack = close)
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Box(Modifier.fillMaxSize().background(colors.scrim).pressable(label = "Close", onClick = close))
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
                    IconButton(Icons.Close, "Close", close, Modifier.padding(end = 0.dp), raised = true)
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

/**
 * A dialog's buttons, given in order of importance: stacked across the full width on phones, the most
 * important first, and in a row at the end on wide screens, the most important last.
 */
@Composable
fun DialogButtons(vararg buttons: @Composable (Modifier) -> Unit) {
    if (LocalCompact.current) {
        Column(Modifier.fillMaxWidth().padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (button in buttons) button(Modifier.fillMaxWidth())
        }
    } else {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            for (button in buttons.reversed()) button(Modifier)
        }
    }
}

/**
 * A task such as signing in: a page over the whole app on phones, with a back arrow and room for the
 * keyboard, and a [Dialog] on wide screens. Back and the back arrow call [onClose].
 */
@Composable
fun TaskPage(title: String, onClose: () -> Unit, content: @Composable () -> Unit) {
    if (!LocalCompact.current) {
        Dialog(title, onClose, content = content)
        return
    }
    val colors = Theme.colors
    Layer {
        BackHandler(onBack = onClose)
        Column(
            Modifier
                .fillMaxSize()
                .background(colors.canvas)
                // Keeps touches off the app underneath.
                .pointerInput(Unit) {}
                .rise(Unit, 200)
                .semantics { paneTitle = title },
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .heightIn(min = 56.dp)
                    .padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(Icons.ArrowLeft, "Close", onClose, size = 48.dp, iconSize = 22.dp, color = colors.text)
                BasicText(
                    title,
                    style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 18.sp, fontWeight = FontWeight.Medium),
                    modifier = Modifier.semantics { heading() },
                )
            }
            Column(
                Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
                    .navigationBarsPadding()
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(Modifier.widthIn(max = 440.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(20.dp)) { content() }
            }
        }
    }
}

/** The body text of a dialog. */
@Composable
fun dialogText(): TextStyle = TextStyle(color = Theme.colors.text, fontFamily = Fonts.sans, fontSize = 15.sp, lineHeight = 21.sp)

package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import io.github.rasagyavatsal.homeoremedica.BuildConfig
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Ports the web app's profile and account menu (src/web/AccountControls.tsx). Accounts come later, so the
// app is always a guest.

/** The sidebar's profile, which opens a menu of the legal pages and the app's version. */
@Composable
fun AccountControls() {
    val colors = Theme.colors
    val openLegal = LocalOpenLegal.current
    var open by remember { mutableStateOf(false) }
    var width by remember { mutableIntStateOf(0) }
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()

    Box {
        Row(
            Modifier
                .fillMaxWidth()
                .onSizeChanged { width = it.width }
                .padding(vertical = 0.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(if (pressed || open) colors.surfaceHover else Color.Transparent)
                .pressable(label = "Account", interactionSource = interactions) { open = !open }
                .semantics(mergeDescendants = true) { stateDescription = if (open) "Expanded" else "Collapsed" }
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(28.dp).clip(RoundedCornerShape(percent = 50)).background(colors.surfaceSelected),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.User, colors.textMuted, 16.dp)
            }
            BasicText(
                "Guest",
                style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 13.sp),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        if (open) {
            val gap = with(LocalDensity.current) { 8.dp.roundToPx() }
            Popup(
                popupPositionProvider = remember(gap) { AboveAnchor(gap) },
                onDismissRequest = { open = false },
                properties = PopupProperties(focusable = true),
            ) {
                val close = { page: LegalPageName ->
                    open = false
                    openLegal(page)
                }
                AccountMenu(Modifier.width(with(LocalDensity.current) { width.toDp() }), onTerms = { close(LegalPageName.Terms) }) {
                    close(LegalPageName.Privacy)
                }
            }
        }
    }
}

@Composable
private fun AccountMenu(modifier: Modifier, onTerms: () -> Unit, onPrivacy: () -> Unit) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(10.dp)
    Column(
        modifier
            .rise(Unit, 120)
            .shadowMedium(shape, colors.shadow)
            .background(colors.surfaceRaised, shape)
            .border(1.dp, colors.border, shape)
            .padding(4.dp)
            .semantics { contentDescription = "Account" },
    ) {
        MenuItem(Icons.Document, LegalPageName.Terms.title, onTerms)
        MenuItem(Icons.Shield, LegalPageName.Privacy.title, onPrivacy)
        BasicText(
            "v${BuildConfig.VERSION_NAME}",
            style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 12.sp, textAlign = TextAlign.Center),
            modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 4.dp),
        )
    }
}

@Composable
private fun MenuItem(icon: ImageVector, text: String, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 36.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (pressed) colors.surfaceRaisedHover else Color.Transparent)
            .pressable(role = Role.Button, label = text, interactionSource = interactions, onClick = onClick)
            .padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, colors.textMuted, 16.dp)
        BasicText(text, style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 13.sp))
    }
}

/** Opens a menu upwards from its anchor, lined up with its start, as the web app's menu opens from the sidebar footer. */
private class AboveAnchor(private val gap: Int) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize) =
        IntOffset(anchorBounds.left, maxOf(0, anchorBounds.top - popupContentSize.height - gap))
}

package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.text.font.FontWeight
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
import kotlinx.coroutines.launch
import io.github.rasagyavatsal.homeoremedica.BuildConfig
import io.github.rasagyavatsal.homeoremedica.account.Account
import io.github.rasagyavatsal.homeoremedica.api.ApiException
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Ports the web app's profile and account menu (src/web/AccountControls.tsx).

/**
 * The sidebar's profile: a guest, or the signed-in [account], with a menu of the legal pages, what can be
 * done, and the app's version. [onSignIn] is null when this build has no accounts.
 */
@Composable
fun AccountControls(
    account: Account?,
    onSignIn: (() -> Unit)?,
    onResendVerification: () -> Unit,
    onSignOut: () -> Unit,
    /** Asks first, in [DeleteAccountDialog]. */
    onDeleteAccount: () -> Unit,
) {
    val colors = Theme.colors
    if (account == null) {
        AccountMenu("Guest", avatar = { Icon(Icons.User, colors.textMuted, 16.dp) }, avatarColor = colors.surfaceSelected) {
            if (onSignIn != null) {
                MenuSeparator()
                MenuItem(Icons.SignIn, "Sign in to sync chats", onClick = onSignIn)
            }
        }
        return
    }
    val label = account.email ?: account.name ?: "Signed in"
    AccountMenu(
        label,
        avatar = {
            BasicText(
                label.take(1).uppercase(),
                style = TextStyle(color = colors.accentText, fontFamily = Fonts.sans, fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
            )
        },
        avatarColor = colors.accentSoft,
    ) {
        MenuSeparator()
        if (!account.verified) MenuItem(Icons.Mail, "Resend verification email", onClick = onResendVerification)
        MenuItem(Icons.SignOut, "Sign out", onClick = onSignOut)
        MenuItem(Icons.Trash, "Delete account…", danger = true, onClick = onDeleteAccount)
    }
}

/** Confirms deleting the account; [onDelete] throws [ApiException] with a message to show if it fails. */
@Composable
fun DeleteAccountDialog(onDelete: suspend () -> Unit, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var working by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Dialog(
        "Delete your account?",
        { if (!working) onClose() },
        description = "This permanently deletes the account and every chat saved to it. It cannot be undone.",
    ) {
        error?.let { FormMessage(it) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
            Button("Cancel", ButtonStyle.Quiet, onClose, enabled = !working, raised = true)
            Button(
                if (working) "Deleting…" else "Delete account",
                ButtonStyle.Danger,
                {
                    working = true
                    error = null
                    scope.launch {
                        try {
                            onDelete()
                        } catch (failure: ApiException) {
                            error = failure.message
                            working = false
                        }
                    }
                },
                enabled = !working,
            )
        }
    }
}

/** What an account menu lists after the legal pages; choosing any item closes the menu first. */
private class MenuScope(val close: () -> Unit)

/** The profile, which opens a menu of the legal pages followed by [items] and the version. */
@Composable
private fun AccountMenu(
    label: String,
    avatar: @Composable () -> Unit,
    avatarColor: Color,
    items: @Composable MenuScope.() -> Unit,
) {
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
                .clip(RoundedCornerShape(10.dp))
                .background(if (pressed || open) colors.surfaceHover else Color.Transparent)
                .pressable(label = "Account", interactionSource = interactions) { open = !open }
                .semantics(mergeDescendants = true) { stateDescription = if (open) "Expanded" else "Collapsed" }
                .padding(4.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(
                Modifier.size(28.dp).clip(RoundedCornerShape(percent = 50)).background(avatarColor),
                contentAlignment = Alignment.Center,
            ) { avatar() }
            BasicText(
                label,
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
                val shape = RoundedCornerShape(10.dp)
                val scope = MenuScope { open = false }
                Column(
                    Modifier
                        .width(with(LocalDensity.current) { width.toDp() })
                        .rise(Unit, 120)
                        .shadowMedium(shape, colors.shadow)
                        .background(colors.surfaceRaised, shape)
                        .border(1.dp, colors.border, shape)
                        .padding(4.dp)
                        .semantics { contentDescription = "Account" },
                ) {
                    for (page in listOf(LegalPageName.Terms, LegalPageName.Privacy)) {
                        scope.MenuItem(if (page == LegalPageName.Terms) Icons.Document else Icons.Shield, page.title) { openLegal(page) }
                    }
                    scope.items()
                    BasicText(
                        "v${BuildConfig.VERSION_NAME}",
                        style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 12.sp, textAlign = TextAlign.Center),
                        modifier = Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 4.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun MenuSeparator() {
    Box(Modifier.padding(vertical = 4.dp).fillMaxWidth().height(1.dp).background(Theme.colors.border))
}

@Composable
private fun MenuScope.MenuItem(icon: ImageVector, text: String, danger: Boolean = false, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    val color = if (danger) colors.danger else colors.text
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 36.dp)
            .clip(RoundedCornerShape(6.dp))
            .background(if (!pressed) Color.Transparent else if (danger) colors.dangerSoft else colors.surfaceRaisedHover)
            .pressable(role = Role.Button, label = text, interactionSource = interactions) {
                close()
                onClick()
            }
            .padding(horizontal = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, if (danger) colors.danger else colors.textMuted, 16.dp)
        BasicText(text, style = TextStyle(color = color, fontFamily = Fonts.sans, fontSize = 13.sp))
    }
}

/** Opens a menu upwards from its anchor, lined up with its start, as the web app's menu opens from the sidebar footer. */
private class AboveAnchor(private val gap: Int) : PopupPositionProvider {
    override fun calculatePosition(anchorBounds: IntRect, windowSize: IntSize, layoutDirection: LayoutDirection, popupContentSize: IntSize) =
        IntOffset(anchorBounds.left, maxOf(0, anchorBounds.top - popupContentSize.height - gap))
}

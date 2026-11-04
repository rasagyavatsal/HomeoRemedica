package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Ease
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

val Pill = RoundedCornerShape(percent = 50)

/** The web app's `--shadow-sm`. */
fun Modifier.shadowSmall(shape: Shape, color: Color) = shadow(1.dp, shape, clip = false, ambientColor = color, spotColor = color)

/** The web app's `--shadow-md`. */
fun Modifier.shadowMedium(shape: Shape, color: Color) = shadow(6.dp, shape, clip = false, ambientColor = color, spotColor = color)

/** The web app's `--shadow-lg`, for drawers, menus and dialogs. */
fun Modifier.shadowLarge(shape: Shape, color: Color) = shadow(16.dp, shape, clip = false, ambientColor = color, spotColor = color)

/**
 * A click target without the platform ripple. Touch has no hover, so the pressed state stands in for the
 * web app's hover styles: [pressed] reports it for the caller to restyle.
 */
@Composable
fun Modifier.pressable(
    enabled: Boolean = true,
    role: Role = Role.Button,
    label: String? = null,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    onClick: () -> Unit,
): Modifier = clickable(interactionSource, indication = null, enabled = enabled, onClickLabel = label, role = role, onClick = onClick)

@Composable
fun MutableInteractionSource.pressed(): State<Boolean> = collectIsPressedAsState()

/** Keys that have already played their entrance, so items scrolled back into view do not replay it. */
class Entrances {
    private val seen = mutableSetOf<Any>()
    fun first(key: Any): Boolean = seen.add(key)
}

val LocalEntrances = compositionLocalOf { Entrances() }

/** The web app's `rise` entrance: fade in while moving up 6dp, after [delayMillis]. */
@Composable
fun Modifier.rise(key: Any, durationMillis: Int = 320, delayMillis: Int = 0): Modifier {
    val entrances = LocalEntrances.current
    val progress = remember(key) { Animatable(if (entrances.first(key)) 0f else 1f) }
    LaunchedEffect(key) { progress.animateTo(1f, tween(durationMillis, delayMillis, easing = Ease)) }
    return graphicsLayer {
        alpha = progress.value
        translationY = (1 - progress.value) * 6.dp.toPx()
    }
}

/** The web app's `pulse`: breathe between 55% and full opacity. */
@Composable
fun Modifier.pulse(): Modifier {
    val alpha by rememberInfiniteTransition("pulse").animateFloat(
        initialValue = 0.55f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(800), RepeatMode.Reverse),
        label = "pulse",
    )
    return graphicsLayer { this.alpha = alpha }
}

/** The potency drop and the name, as in the web app's `.brand`. */
@Composable
fun Brand(modifier: Modifier = Modifier) {
    val colors = Theme.colors
    Row(
        modifier.semantics(mergeDescendants = true) { heading() },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Drop, colors.accent, 28.dp)
        BasicText(
            buildAnnotatedString {
                withStyle(SpanStyle(color = colors.accentText)) { append("Homeo") }
                append("Remedica")
            },
            style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
        )
    }
}

enum class ButtonStyle { Primary, Outline, Quiet, Danger }

/** The web app's `.button`, in its primary, outline, quiet and danger variants. */
@Composable
fun Button(
    text: String,
    style: ButtonStyle,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    small: Boolean = false,
    icon: ImageVector? = null,
    raised: Boolean = false,
    color: Color? = null,
) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    val active = pressed && enabled
    val shape = RoundedCornerShape(10.dp)
    val background = when (style) {
        ButtonStyle.Primary -> if (active) colors.accentHover else colors.accent
        ButtonStyle.Outline -> if (active) colors.surfaceRaisedHover else colors.surfaceRaised
        // Quiet buttons on a raised surface, such as a dialog, darken to its hover colour.
        ButtonStyle.Quiet -> if (!active) Color.Transparent else if (raised) colors.surfaceRaisedHover else colors.surfaceHover
        ButtonStyle.Danger -> if (active) colors.dangerHover else colors.danger
    }
    val content = color ?: when (style) {
        ButtonStyle.Primary, ButtonStyle.Danger -> colors.textOnAccent
        ButtonStyle.Outline, ButtonStyle.Quiet -> colors.text
    }
    Row(
        modifier
            .scale(if (active) 0.96f else 1f)
            .alpha(if (enabled) 1f else 0.55f)
            .defaultMinSize(minHeight = if (small) 28.dp else 36.dp)
            .clip(shape)
            .background(background)
            .border(1.dp, if (style == ButtonStyle.Outline) colors.borderStrong else Color.Transparent, shape)
            .pressable(enabled, label = text, interactionSource = interactions, onClick = onClick)
            .padding(horizontal = if (small) 8.dp else 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, content, 16.dp)
        BasicText(
            text,
            style = TextStyle(
                color = content,
                fontSize = if (small) 12.sp else 13.sp,
                lineHeight = 18.sp,
                fontWeight = FontWeight.Medium,
                fontFamily = Fonts.sans,
            ),
        )
    }
}

/** The web app's `.icon-button`: a 36dp square that darkens when pressed. */
@Composable
fun IconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 36.dp,
    iconSize: Dp = 20.dp,
    color: Color? = null,
    pressedColor: Color? = null,
    raised: Boolean = false,
    content: (@Composable () -> Unit)? = null,
) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Box(
        modifier
            .scale(if (pressed) 0.96f else 1f)
            .size(size)
            .clip(RoundedCornerShape(10.dp))
            .background(if (!pressed) Color.Transparent else if (raised) colors.surfaceRaisedHover else colors.surfaceHover)
            .pressable(label = label, interactionSource = interactions, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        if (content != null) content()
        else Icon(icon, if (pressed) pressedColor ?: colors.text else color ?: colors.textMuted, iconSize)
    }
}

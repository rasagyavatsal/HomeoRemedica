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
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
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

/** The mark in a tinted rounded square, as in the wordmark, avatars and empty state. */
@Composable
fun MarkBadge(size: Dp, corner: Dp, markSize: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier.size(size).clip(RoundedCornerShape(corner)).background(Theme.colors.accentSoft),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Mark, Theme.colors.accent, markSize)
    }
}

enum class ButtonStyle { Quiet, Primary }

/** The web app's `.button`, in its quiet and primary variants. */
@Composable
fun PillButton(
    text: String?,
    style: ButtonStyle,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    contentDescription: String? = text,
) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    val background = when (style) {
        ButtonStyle.Quiet -> if (pressed) colors.surfaceHover else Color.Transparent
        ButtonStyle.Primary -> if (pressed) colors.accentHover else colors.accent
    }
    val content = when (style) {
        ButtonStyle.Quiet -> if (pressed) colors.ink else colors.muted
        ButtonStyle.Primary -> colors.accentInk
    }
    Row(
        modifier
            .alpha(if (enabled) 1f else 0.45f)
            .then(if (style == ButtonStyle.Primary) Modifier.shadowSmall(Pill, colors.shadow) else Modifier)
            .clip(Pill)
            .background(background)
            .then(if (style == ButtonStyle.Primary) Modifier.border(1.dp, background, Pill) else Modifier)
            .pressable(enabled, label = contentDescription, interactionSource = interactions, onClick = onClick)
            .padding(horizontal = if (text == null) 8.dp else 11.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) Icon(icon, content, 16.dp, contentDescription = if (text == null) contentDescription else null)
        if (text != null) {
            BasicText(text, style = TextStyle(color = content, fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium, fontFamily = Fonts.sans))
        }
    }
}

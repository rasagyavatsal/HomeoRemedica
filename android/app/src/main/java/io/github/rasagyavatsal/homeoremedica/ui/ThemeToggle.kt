package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Ease
import io.github.rasagyavatsal.homeoremedica.ui.theme.LocalThemeControl
import io.github.rasagyavatsal.homeoremedica.ui.theme.ThemeChoice
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme


/** One button that steps through the system, light and dark themes, as the web app's (src/web/ThemeToggle.tsx). */
@Composable
fun ThemeToggle(modifier: Modifier = Modifier) {
    val control = LocalThemeControl.current
    val choice = control.choice
    val icon = choice.icon
    // Each new icon turns in, as the web app's `turn-in`; the first one shows at once.
    val first = remember { mutableStateOf(true) }
    SideEffect { first.value = false }
    IconButton(icon, choice.label, control.cycle, modifier) {
        key(choice) {
            val turn = remember { Animatable(if (first.value) 1f else 0f) }
            LaunchedEffect(Unit) { turn.animateTo(1f, tween(320, easing = Ease)) }
            Icon(
                icon,
                Theme.colors.textMuted,
                20.dp,
                Modifier.graphicsLayer {
                    alpha = turn.value
                    rotationZ = -90f * (1 - turn.value)
                    val scale = 0.6f + 0.4f * turn.value
                    scaleX = scale
                    scaleY = scale
                },
            )
        }
    }
}

/** The system, light and dark themes side by side, the chosen one marked, as phones show settings. */
@Composable
fun ThemePicker(modifier: Modifier = Modifier) {
    val colors = Theme.colors
    val control = LocalThemeControl.current
    val haptics = LocalHapticFeedback.current
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier
            .fillMaxWidth()
            .background(colors.surfaceSunken, shape)
            .padding(4.dp)
            .selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (choice in ThemeChoice.entries) {
            val chosen = choice == control.choice
            val inner = RoundedCornerShape(9.dp)
            Row(
                Modifier
                    .weight(1f)
                    .heightIn(min = 44.dp)
                    .clip(inner)
                    .background(if (chosen) colors.surfaceRaised else Color.Transparent)
                    .border(1.dp, if (chosen) colors.border else Color.Transparent, inner)
                    .selectable(chosen, role = Role.RadioButton, interactionSource = null, indication = null) {
                        if (!chosen) haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                        control.choose(choice)
                    }
                    .semantics { contentDescription = choice.label },
                horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val color = if (chosen) colors.text else colors.textMuted
                Icon(choice.icon, color, 16.dp)
                BasicText(choice.name, style = TextStyle(color = color, fontFamily = Fonts.sans, fontSize = 13.sp, fontWeight = FontWeight.Medium))
            }
        }
    }
}

private val ThemeChoice.icon get() = when (this) {
    ThemeChoice.System -> Icons.Monitor
    ThemeChoice.Light -> Icons.Sun
    ThemeChoice.Dark -> Icons.Moon
}

package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
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

// Ports the web app's theme toggle (src/web/ThemeToggle.tsx).

/** One button that steps through the system, light and dark themes. */
@Composable
fun ThemeToggle(modifier: Modifier = Modifier) {
    val control = LocalThemeControl.current
    val choice = control.choice
    val icon = when (choice) {
        ThemeChoice.System -> Icons.Monitor
        ThemeChoice.Light -> Icons.Sun
        ThemeChoice.Dark -> Icons.Moon
    }
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

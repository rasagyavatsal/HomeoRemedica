package io.github.rasagyavatsal.homeoremedica.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily

// The web app's design tokens (src/web/tokens.css): primitives, then the semantic roles that the
// light and dark themes remap. Components read only the roles.

/** The primitives: raw colour ramps that only the palettes below use. */
private object Primitives {
    // Paper: warm neutrals, light to dark.
    val paper0 = Color(0xFFFFFFFF)
    val paper50 = Color(0xFFFBFAF6)
    val paper100 = Color(0xFFF7F5F0)
    val paper150 = Color(0xFFF0EDE5)
    val paper200 = Color(0xFFE7E3D8)
    val paper300 = Color(0xFFD6D1C3)
    val paper400 = Color(0xFFAAA496)
    val paper500 = Color(0xFF8A8577)
    val paper600 = Color(0xFF66625A)
    val paper700 = Color(0xFF46433D)
    val paper800 = Color(0xFF2C2A26)
    val paper850 = Color(0xFF22211E)
    val paper900 = Color(0xFF1A1A17)
    val paper950 = Color(0xFF141412)

    // Herb: the brand green.
    val herb50 = Color(0xFFEEF4EF)
    val herb100 = Color(0xFFDDE9DF)
    val herb200 = Color(0xFFBCD4C1)
    val herb300 = Color(0xFF92B99C)
    val herb600 = Color(0xFF3D6B4F)
    val herb700 = Color(0xFF30553F)
    val herb800 = Color(0xFF243F2F)
    val herb900 = Color(0xFF1A2D22)

    // Rust: errors and destructive actions.
    val rust100 = Color(0xFFF6E2DD)
    val rust300 = Color(0xFFE6A194)
    val rust500 = Color(0xFFB4493A)
    val rust600 = Color(0xFF9B3A2D)
    val rust900 = Color(0xFF3A1D18)
}

@Immutable
data class Palette(
    val canvas: Color,
    val surface: Color,
    val surfaceRaised: Color,
    val surfaceSunken: Color,
    val surfaceHover: Color,
    val surfaceRaisedHover: Color,
    val surfaceSelected: Color,
    val text: Color,
    val textMuted: Color,
    val textSubtle: Color,
    val textOnAccent: Color,
    val border: Color,
    val borderStrong: Color,
    val accent: Color,
    val accentHover: Color,
    val accentText: Color,
    val accentSoft: Color,
    val accentSoftHover: Color,
    val accentBorder: Color,
    val glow: Color,
    val glowWarm: Color,
    val danger: Color,
    val dangerHover: Color,
    val dangerSoft: Color,
    val scrim: Color,
    val shadow: Color,
    val dark: Boolean,
)

val LightPalette = with(Primitives) {
    Palette(
        canvas = paper100,
        surface = paper50,
        surfaceRaised = paper0,
        surfaceSunken = paper150,
        surfaceHover = paper150,
        surfaceRaisedHover = paper150,
        surfaceSelected = paper200,
        text = paper900,
        textMuted = paper600,
        textSubtle = paper500,
        textOnAccent = paper0,
        border = paper200,
        borderStrong = paper300,
        accent = herb600,
        accentHover = herb700,
        accentText = herb700,
        accentSoft = herb50,
        accentSoftHover = herb100,
        accentBorder = herb200,
        glow = Color(146, 185, 156).copy(alpha = 0.4f),
        glowWarm = Color(224, 192, 122).copy(alpha = 0.25f),
        danger = rust600,
        dangerHover = rust500,
        dangerSoft = rust100,
        scrim = Color(20, 20, 18).copy(alpha = 0.32f),
        shadow = Color(30, 28, 24).copy(alpha = 0.18f),
        dark = false,
    )
}

val DarkPalette = with(Primitives) {
    Palette(
        canvas = paper950,
        surface = paper900,
        surfaceRaised = paper850,
        surfaceSunken = paper950,
        surfaceHover = paper850,
        surfaceRaisedHover = paper800,
        surfaceSelected = paper800,
        text = paper100,
        textMuted = paper400,
        textSubtle = paper500,
        textOnAccent = paper950,
        border = paper800,
        borderStrong = paper700,
        accent = herb300,
        accentHover = herb200,
        accentText = herb300,
        accentSoft = herb900,
        accentSoftHover = herb800,
        accentBorder = herb800,
        glow = Color(77, 127, 92).copy(alpha = 0.28f),
        glowWarm = Color(138, 101, 20).copy(alpha = 0.18f),
        danger = rust300,
        dangerHover = rust100,
        dangerSoft = rust900,
        scrim = Color.Black.copy(alpha = 0.55f),
        shadow = Color.Black.copy(alpha = 0.55f),
        dark = true,
    )
}

/** The web app's font stacks resolve to these system faces on Android; answers read in the sans face too. */
object Fonts {
    val sans: FontFamily = FontFamily.SansSerif
    val mono: FontFamily = FontFamily.Monospace
}

/** The web app's `--ease-standard`. */
val Ease = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** The web app's `--ease-exit`. */
val EaseExit = CubicBezierEasing(0.3f, 0f, 1f, 1f)

private val LocalPalette = staticCompositionLocalOf { LightPalette }

object Theme {
    val colors: Palette
        @Composable get() = LocalPalette.current
}

@Composable
fun HomeoRemedicaTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val palette = if (dark) DarkPalette else LightPalette
    CompositionLocalProvider(
        LocalPalette provides palette,
        LocalTextSelectionColors provides TextSelectionColors(handleColor = palette.accent, backgroundColor = palette.accentSoft),
        content = content,
    )
}

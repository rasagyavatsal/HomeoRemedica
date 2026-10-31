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

// The web app's design tokens (src/web/styles.css), one palette per color scheme.

@Immutable
data class Palette(
    val bg: Color,
    val surface: Color,
    val surfaceSunken: Color,
    val surfaceHover: Color,
    val ink: Color,
    val inkSoft: Color,
    val muted: Color,
    val faint: Color,
    val line: Color,
    val lineStrong: Color,
    val accent: Color,
    val accentInk: Color,
    val accentSoft: Color,
    val accentHover: Color,
    val danger: Color,
    val dangerSoft: Color,
    val shadow: Color,
    val dark: Boolean,
)

val LightPalette = Palette(
    bg = Color(0xFFF7F5F0),
    surface = Color(0xFFFFFEFB),
    surfaceSunken = Color(0xFFEFECE4),
    surfaceHover = Color(0xFFEBE7DD),
    ink = Color(0xFF1F1E1B),
    inkSoft = Color(0xFF46443E),
    muted = Color(0xFF77736A),
    faint = Color(0xFFA29D92),
    line = Color(0xFFE4E0D6),
    lineStrong = Color(0xFFCFC9BC),
    accent = Color(0xFF3D6B4F),
    accentInk = Color(0xFFFFFFFF),
    accentSoft = Color(0xFFE3ECE4),
    accentHover = Color(0xFF335A42),
    danger = Color(0xFFA3402F),
    dangerSoft = Color(0xFFF8E9E4),
    shadow = Color(0x331F1E1B),
    dark = false,
)

val DarkPalette = Palette(
    bg = Color(0xFF141412),
    surface = Color(0xFF1D1C1A),
    surfaceSunken = Color(0xFF191917),
    surfaceHover = Color(0xFF272623),
    ink = Color(0xFFECEBE6),
    inkSoft = Color(0xFFCFCDC5),
    muted = Color(0xFF9A968C),
    faint = Color(0xFF6D6A62),
    line = Color(0xFF2C2B28),
    lineStrong = Color(0xFF3D3B37),
    accent = Color(0xFF8CC09D),
    accentInk = Color(0xFF10180F),
    accentSoft = Color(0xFF1F2C23),
    accentHover = Color(0xFFA3D0B1),
    danger = Color(0xFFE59A88),
    dangerSoft = Color(0xFF2E1D19),
    shadow = Color(0x99000000),
    dark = true,
)

/** The web app's font stacks resolve to these system faces on Android. */
object Fonts {
    val sans: FontFamily = FontFamily.SansSerif
    val serif: FontFamily = FontFamily.Serif
    val mono: FontFamily = FontFamily.Monospace
}

/** The web app's `--ease`. */
val Ease = CubicBezierEasing(0.2f, 0.7f, 0.2f, 1f)

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

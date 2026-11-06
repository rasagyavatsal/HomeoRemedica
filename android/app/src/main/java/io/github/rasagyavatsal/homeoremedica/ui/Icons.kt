package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.isSpecified
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// The web app's icons (src/web/icons.tsx): 24-unit outlines with a 1.75 stroke.

private fun icon(name: String, vararg strokes: String, fills: List<String> = emptyList()): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (path in strokes) {
            addPath(
                pathData = addPathNodes(path),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.75f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        for (path in fills) addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black), pathFillType = PathFillType.EvenOdd)
    }.build()

private const val THUMB_UP = "M7 10v12M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"
private const val THUMB_DOWN = "M17 14V2M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z"

/** An outline filled at 22% of its colour, as the web app fills a chosen thumb. */
private fun filled(name: String, path: String): ImageVector = ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
    addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black), fillAlpha = 0.22f)
    addPath(
        pathData = addPathNodes(path),
        stroke = SolidColor(Color.Black),
        strokeLineWidth = 1.75f,
        strokeLineCap = StrokeCap.Round,
        strokeLineJoin = StrokeJoin.Round,
    )
}.build()

object Icons {
    /** The potency drop: a drop with a ring and centre cut out, after the rings of a dilution. */
    val Drop = icon(
        "Drop",
        fills = listOf(
            "M12 2C12 2 4.5 10.25 4.5 15.25A7.5 7.5 0 0 0 19.5 15.25C19.5 10.25 12 2 12 2ZM7.2 15.25a4.8 4.8 0 1 0 9.6 0a4.8 4.8 0 1 0-9.6 0ZM8.3 15.25a3.7 3.7 0 1 0 7.4 0a3.7 3.7 0 1 0-7.4 0ZM10.7 15.25a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0-2.6 0Z",
        ),
    )
    val ArrowUp = icon("ArrowUp", "M12 19V5m-6 6 6-6 6 6")
    val ArrowLeft = icon("ArrowLeft", "M19 12H5m6-6-6 6 6 6")
    val ArrowRight = icon("ArrowRight", "M5 12h14m-6-6 6 6-6 6")
    val Plus = icon("Plus", "M12 5v14M5 12h14")
    val NewChat = icon("NewChat", "M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5", "M17.5 3.5a2.12 2.12 0 0 1 3 3L13 14l-4 1 1-4 7.5-7.5Z")
    val Menu = icon("Menu", "M4 7h16M4 12h16M4 17h16")
    val Copy = icon(
        "Copy",
        "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z",
        "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
    )
    val Check = icon("Check", "m5 12.5 4.5 4.5L19 7.5")
    val Flag = icon("Flag", "M5 21V4", "M5 4h12l-2.5 4.5L17 13H5")
    val Chevron = icon("Chevron", "m9 6 6 6-6 6")
    val Stop = icon("Stop", fills = listOf("M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7Z"))
    val Close = icon("Close", "M6 6l12 12M18 6 6 18")
    val Retry = icon("Retry", "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4")
    val Alert = icon("Alert", "M12 8v5m0 3.5v.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z")
    val Trash = icon("Trash", "M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3")
    val Search = icon("Search", "m20 20-4.2-4.2M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z")
    val Document = icon("Document", "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5ZM14 3v5h5M9 13h6M9 17h6")
    val Shield = icon("Shield", "M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z")
    val Sun = icon("Sun", "M12 4V2m0 20v-2m8-8h2M2 12h2m13.7-5.7 1.4-1.4M4.9 19.1l1.4-1.4m11.4 0 1.4 1.4M4.9 4.9l1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z")
    val Moon = icon("Moon", "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z")
    val Monitor = icon("Monitor", "M4 5h16v11H4zM9 20h6m-3-4v4")
    val User = icon("User", "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0")
    val SignIn = icon("SignIn", "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4")
    val SignOut = icon("SignOut", "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10")
    val Mail = icon("Mail", "M4 6h16v12H4zM4 7l8 6 8-6")
    val ThumbUp = icon("ThumbUp", THUMB_UP)
    val ThumbUpChosen = filled("ThumbUpChosen", THUMB_UP)
    val ThumbDown = icon("ThumbDown", THUMB_DOWN)
    val ThumbDownChosen = filled("ThumbDownChosen", THUMB_DOWN)

    /** Google's mark in its own colours, which is never tinted. */
    val Google = ImageVector.Builder("Google", 24.dp, 24.dp, 24f, 24f).apply {
        for ((color, path) in listOf(
            0xFF4285F4 to "M22.6 12.2c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2-1.9 3.3-4.7 3.3-8Z",
            0xFF34A853 to "M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.9A11 11 0 0 0 12 23Z",
            0xFFFBBC05 to "M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7H2.1a11 11 0 0 0 0 10l3.7-2.9Z",
            0xFFEA4335 to "M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z",
        )) addPath(pathData = addPathNodes(path), fill = SolidColor(Color(color)))
    }.build()
}

/** An icon in [color], or in its own colours when [color] is unspecified. */
@Composable
fun Icon(icon: ImageVector, color: Color, size: Dp, modifier: Modifier = Modifier, contentDescription: String? = null) {
    Image(
        painter = rememberVectorPainter(icon),
        contentDescription = contentDescription,
        modifier = modifier.size(size),
        colorFilter = if (color.isSpecified) ColorFilter.tint(color) else null,
    )
}

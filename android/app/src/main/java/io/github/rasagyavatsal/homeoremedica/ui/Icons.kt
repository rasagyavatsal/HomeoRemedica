package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
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
}

@Composable
fun Icon(icon: ImageVector, color: Color, size: Dp, modifier: Modifier = Modifier, contentDescription: String? = null) {
    Image(
        painter = rememberVectorPainter(icon),
        contentDescription = contentDescription,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(color),
    )
}

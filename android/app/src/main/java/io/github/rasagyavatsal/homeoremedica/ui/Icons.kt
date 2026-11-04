package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// The web app's icons (src/web/icons.tsx): 24-unit outlines with a 1.6 stroke.

private fun icon(name: String, vararg strokes: String, fills: List<String> = emptyList()): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        for (path in strokes) {
            addPath(
                pathData = addPathNodes(path),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 1.6f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        for (path in fills) addPath(pathData = addPathNodes(path), fill = SolidColor(Color.Black))
    }.build()

object Icons {
    val Mark = icon(
        "Mark",
        "M12 21c0-6 0-10 0-14",
        fills = listOf("M12 12c-4.5 0-7-2.6-7-7 4.4 0 7 2.5 7 7Zm0 3c3.9 0 6-2.2 6-6-3.8 0-6 2.1-6 6Z"),
    )
    val ArrowUp = icon("ArrowUp", "M12 19V5m-6 6 6-6 6 6")
    val Plus = icon("Plus", "M12 5v14M5 12h14")
    val Copy = icon(
        "Copy",
        "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z",
        "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
    )
    val Check = icon("Check", "m5 12.5 4.5 4.5L19 7.5")
    val Flag = icon("Flag", "M5 21V4", "M5 4h12l-2.5 4.5L17 13H5")
    val Chevron = icon("Chevron", "m9 6 6 6-6 6")
    val Stop = icon("Stop", fills = listOf("M8.5 7h7A1.5 1.5 0 0 1 17 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 15.5v-7A1.5 1.5 0 0 1 8.5 7Z"))
    val Retry = icon("Retry", "M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4")
    val Alert = icon("Alert", "M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 7.5v5.5m0 3.2v.1")
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

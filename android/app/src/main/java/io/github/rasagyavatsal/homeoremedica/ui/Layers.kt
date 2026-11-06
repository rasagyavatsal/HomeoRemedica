package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** From this width the app lays out as the web app does, as Material's expanded windows: tablets and the like. */
val ExpandedFrom = 840.dp

/** Whether the window is narrower than [ExpandedFrom], where the app uses a phone's ways of showing things. */
val LocalCompact = compositionLocalOf { true }

/** Content shown over the whole app, wherever it was composed. */
class Layers {
    internal val shown = mutableStateListOf<ShownLayer>()
}

internal class ShownLayer(content: @Composable () -> Unit) {
    var content by mutableStateOf(content)
}

private val LocalLayers = staticCompositionLocalOf<Layers?> { null }

/** The app's frame: it says whether the window is [LocalCompact] and shows [Layer]s over [content]. */
@Composable
fun AppFrame(content: @Composable () -> Unit) {
    val layers = remember { Layers() }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        CompositionLocalProvider(LocalCompact provides (maxWidth < ExpandedFrom), LocalLayers provides layers) {
            content()
            for (layer in layers.shown) key(layer) { layer.content() }
        }
    }
}

/**
 * Shows [content] over the whole app for as long as this is composed, such as a sheet opened from a row of a
 * list, which would otherwise be clipped to the row. Without an [AppFrame], it shows in place.
 */
@Composable
fun Layer(content: @Composable () -> Unit) {
    val layers = LocalLayers.current
    if (layers == null) {
        content()
        return
    }
    val layer = remember { ShownLayer(content) }
    SideEffect { layer.content = content }
    DisposableEffect(layers, layer) {
        layers.shown += layer
        onDispose { layers.shown -= layer }
    }
}

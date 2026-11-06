package io.github.rasagyavatsal.homeoremedica.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Ease
import io.github.rasagyavatsal.homeoremedica.ui.theme.EaseExit
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.roundToInt

/** What a sheet's content can do with the sheet. */
class SheetScope internal constructor(scope: ColumnScope, private val close: () -> Unit) : ColumnScope by scope {
    /** Slide the sheet away, then call its `onDismiss`. */
    fun dismiss() = close()
}

/**
 * A sheet that rises from the bottom of the screen over a scrim, the phone's way to show what the web app
 * shows in a menu, a dialog or a panel. Dragging it down, tapping the scrim, the back gesture and its handle
 * all slide it away and then call [onDismiss]. An [expandable] sheet opens half way and drags up to the top
 * of the screen; content that scrolls drags the sheet once it reaches its top.
 */
@Composable
fun BottomSheet(
    /** What the sheet is, for accessibility services. */
    label: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    title: String? = null,
    /** What closing the sheet does, as its handle and scrim announce it. */
    closeLabel: String = "Close",
    expandable: Boolean = false,
    /** Whether the reader can close the sheet; while not, dragging it down springs it back. */
    dismissible: Boolean = true,
    content: @Composable SheetScope.() -> Unit,
) = Layer {
    val colors = Theme.colors
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val dismissed by rememberUpdatedState(onDismiss)
    val fling = with(density) { 400.dp.toPx() }
    val motion = remember { SheetMotion(scope, fling) { dismissed() } }
    motion.dismissible = dismissible
    BackHandler { if (dismissible) motion.dismiss() }

    BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
        val screen = constraints.maxHeight.toFloat()
        val top = WindowInsets.statusBars.getTop(density) + with(density) { 8.dp.toPx() }
        val tallest = with(density) { (screen - top).coerceAtLeast(0f).toDp() }
        // The share of the screen an expandable sheet opens to.
        if (expandable) motion.half = (screen - top) - screen * 0.6f

        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer { alpha = motion.shown }
                .background(colors.scrim)
                .pressable(enabled = dismissible, label = closeLabel) { motion.dismiss() },
        )
        val shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
        Column(
            modifier
                .align(Alignment.BottomCenter)
                .widthIn(max = 640.dp)
                .fillMaxWidth()
                .then(if (expandable) Modifier.height(tallest) else Modifier.heightIn(max = tallest))
                .onSizeChanged { motion.measured(it.height.toFloat()) }
                .offset { IntOffset(0, motion.position.roundToInt()) }
                .graphicsLayer { alpha = if (motion.ready) 1f else 0f }
                .shadowLarge(shape, colors.shadow)
                .background(colors.surfaceRaised, shape)
                .nestedScroll(motion.connection)
                .draggable(
                    rememberDraggableState(motion::dragBy),
                    Orientation.Vertical,
                    onDragStarted = { motion.stop() },
                    onDragStopped = { velocity -> motion.settle(velocity) },
                )
                .semantics { paneTitle = label }
                .navigationBarsPadding(),
        ) {
            Handle(closeLabel, dismissible, motion::dismiss)
            if (title != null) {
                BasicText(
                    title,
                    style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium),
                    modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 12.dp).semantics { heading() },
                )
            }
            SheetScope(this, motion::dismiss).content()
        }
    }
}

/** The bar at the top of a sheet, which shows it can be dragged and closes it when tapped. */
@Composable
private fun Handle(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(28.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(width = 96.dp, height = 28.dp)
                .pressable(enabled, label = label, onClick = onClick)
                .semantics { contentDescription = label },
            contentAlignment = Alignment.Center,
        ) {
            Box(Modifier.width(36.dp).height(4.dp).background(Theme.colors.borderStrong, Pill))
        }
    }
}

/**
 * Where a sheet sits: [position] is how far it is pushed down from fully open, 0, to [hidden], its height.
 * An expandable sheet also rests at [half].
 */
private class SheetMotion(private val scope: CoroutineScope, private val fling: Float, private val onHidden: () -> Unit) {
    private var offset by mutableFloatStateOf(Float.NaN)
    private var hidden by mutableFloatStateOf(0f)
    var half by mutableFloatStateOf(Float.NaN)
    var dismissible by mutableStateOf(true)
    private var closing by mutableStateOf(false)
    private var job: Job? = null

    /** Whether the sheet has been measured, so it can slide in from below the screen. */
    val ready: Boolean get() = !offset.isNaN()

    val position: Float get() = if (ready) offset else hidden

    private val open: Float get() = if (half.isNaN()) 0f else half.coerceIn(0f, hidden)

    private val anchors: List<Float> get() = listOf(0f, open, hidden).distinct().sorted()

    /** How far the sheet has come in, from 0 while hidden to 1 once it rests open, for the scrim. */
    val shown: Float get() = if (!ready || hidden <= 0f) 0f else ((hidden - offset) / (hidden - open).coerceAtLeast(1f)).coerceIn(0f, 1f)

    fun measured(height: Float) {
        hidden = height
        if (!ready && height > 0f) {
            offset = height
            animateTo(open)
        }
    }

    fun dragBy(delta: Float) {
        if (!ready || closing) return
        offset = (offset + delta).coerceIn(0f, hidden)
    }

    fun stop() {
        if (!closing) job?.cancel()
    }

    /** Come to rest at the anchor the drag was heading for, which closes the sheet if it is the bottom. */
    fun settle(velocity: Float) {
        if (!ready || closing) return
        val target = when {
            velocity > fling -> anchors.firstOrNull { it > offset + 1f } ?: hidden
            velocity < -fling -> anchors.lastOrNull { it < offset - 1f } ?: 0f
            else -> anchors.minBy { abs(it - offset) }
        }
        when {
            target != hidden -> animateTo(target)
            dismissible -> dismiss()
            else -> animateTo(open)
        }
    }

    fun dismiss() {
        if (closing) return
        closing = true
        animateTo(hidden)
    }

    private fun animateTo(target: Float) {
        job?.cancel()
        val exit = closing
        job = scope.launch {
            animate(offset, target, animationSpec = if (exit) tween(200, easing = EaseExit) else tween(320, easing = Ease)) { value, _ ->
                offset = value
            }
            if (exit) onHidden()
        }
    }

    private val resting: Boolean get() = anchors.any { abs(it - offset) < 0.5f }

    /** Lets content that scrolls drag the sheet up until it is open and down once the content is at its top. */
    val connection = object : NestedScrollConnection {
        override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
            if (!ready || closing || source != NestedScrollSource.UserInput || available.y >= 0f || offset <= 0f) return Offset.Zero
            val before = offset
            offset = (offset + available.y).coerceAtLeast(0f)
            return Offset(0f, offset - before)
        }

        override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
            if (!ready || closing || source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
            val before = offset
            offset = (offset + available.y).coerceAtMost(hidden)
            return Offset(0f, offset - before)
        }

        override suspend fun onPreFling(available: Velocity): Velocity {
            if (!ready || closing || resting) return Velocity.Zero
            settle(available.y)
            return available
        }
    }
}

/** One choice in a sheet: a full-width row with an icon, tall enough to tap easily. */
@Composable
fun SheetItem(icon: ImageVector, text: String, danger: Boolean = false, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .background(if (!pressed) Color.Transparent else if (danger) colors.dangerSoft else colors.surfaceRaisedHover)
            .pressable(label = text, interactionSource = interactions, onClick = onClick)
            .padding(horizontal = 24.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, if (danger) colors.danger else colors.textMuted, 20.dp)
        BasicText(text, style = TextStyle(color = if (danger) colors.danger else colors.text, fontFamily = Fonts.sans, fontSize = 15.sp))
    }
}

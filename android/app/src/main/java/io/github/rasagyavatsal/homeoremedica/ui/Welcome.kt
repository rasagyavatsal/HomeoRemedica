package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.InfiniteTransition
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.StartOffset
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.compose.ui.util.lerp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Ease
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme
import kotlinx.coroutines.delay

// Ports the web app's empty chat (src/web/Welcome.tsx).

private const val TAGLINE = "Ask the classical homoeopathic literature."
private val TaglineWords = TAGLINE.split(" ")

// The web app's `--duration-reveal`, `--duration-word-stagger`, `--duration-glow-in` and `--duration-drift`.
const val REVEAL_MILLIS = 480
private const val WORD_STAGGER_MILLIS = 60
private const val GLOW_IN_MILLIS = 1600
private const val DRIFT_MILLIS = 14_000

// CSS's `ease-in-out`, which each drift keyframe eases with.
private val EaseInOut = CubicBezierEasing(0.42f, 0f, 0.58f, 1f)

/** When the tagline's last word has started in, so the composer can follow it. */
val TAGLINE_MILLIS = TaglineWords.size * WORD_STAGGER_MILLIS

/** Questions a phone's empty chat offers to ask, for a first tap. */
private val Examples = listOf(
    "Remedies for irritability in the morning",
    "Compare Bryonia and Rhus tox in rheumatism",
    "What does Kent say about Pulsatilla?",
)

/** The empty chat: what the app is for. On phones it sits by the message box, with [Examples] to ask. */
@Composable
fun Welcome(bottomPadding: Dp, onExample: (String) -> Unit = {}) {
    if (LocalCompact.current) {
        Box(Modifier.fillMaxSize().padding(start = 20.dp, end = 20.dp, bottom = bottomPadding), contentAlignment = Alignment.BottomStart) {
            // Decoration only: soft light drifting behind the tagline.
            Glows(Modifier.fillMaxWidth(0.8f).height(256.dp))
            Column(Modifier.padding(bottom = 12.dp)) {
                FlowRow(
                    Modifier.padding(bottom = 20.dp).semantics(mergeDescendants = true) {
                        heading()
                        contentDescription = TAGLINE
                    },
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    TaglineWords.forEachIndexed { index, word -> TaglineWord(word, index, 34.sp) }
                }
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Examples.forEachIndexed { index, example ->
                        Example(example, Modifier.rise(example, REVEAL_MILLIS, TAGLINE_MILLIS + index * WORD_STAGGER_MILLIS)) { onExample(example) }
                    }
                }
            }
        }
        return
    }
    Box(
        Modifier.fillMaxSize().padding(start = 16.dp, end = 16.dp, bottom = bottomPadding),
        contentAlignment = Alignment.Center,
    ) {
        // Decoration only: soft light drifting behind the tagline.
        Glows(Modifier.fillMaxWidth(0.8f).height(256.dp))
        FlowRow(
            Modifier.padding(vertical = 64.dp).semantics(mergeDescendants = true) {
                heading()
                contentDescription = TAGLINE
            },
            horizontalArrangement = Arrangement.spacedBy(9.dp, Alignment.CenterHorizontally),
        ) {
            TaglineWords.forEachIndexed { index, word -> TaglineWord(word, index) }
        }
    }
}

/** A question to ask with one tap: a filled pill. */
@Composable
private fun Example(text: String, modifier: Modifier, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    BasicText(
        text,
        style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 16.sp, lineHeight = 22.sp),
        modifier = modifier
            .clip(Pill)
            .background(if (pressed) colors.borderStrong else colors.surfaceSelected)
            .pressable(label = "Ask", interactionSource = interactions, onClick = onClick)
            .padding(horizontal = 20.dp, vertical = 14.dp),
    )
}

/** One word of the tagline, rising in after the ones before it. */
@Composable
private fun TaglineWord(word: String, index: Int, size: TextUnit = 32.sp) {
    val progress = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(index * WORD_STAGGER_MILLIS.toLong())
        progress.animateTo(1f, tween(REVEAL_MILLIS, easing = Ease))
    }
    BasicText(
        word,
        style = TextStyle(
            color = Theme.colors.text,
            fontFamily = Fonts.sans,
            fontSize = size,
            lineHeight = 1.25.em,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        ),
        modifier = Modifier.graphicsLayer {
            alpha = progress.value
            translationY = (1 - progress.value) * 8.dp.toPx()
        },
    )
}

/** The web app's `.welcome-glow`s: three soft blobs, two green and one warm, drifting out of step. */
@Composable
private fun Glows(modifier: Modifier) {
    val colors = Theme.colors
    val fade = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        delay(TAGLINE_MILLIS.toLong())
        fade.animateTo(1f, tween(GLOW_IN_MILLIS, easing = Ease))
    }
    val transition = rememberInfiniteTransition("glows")
    val first by transition.drift(DRIFT_MILLIS, RepeatMode.Reverse)
    // `alternate-reverse`: starts from the far end.
    val second by transition.drift((DRIFT_MILLIS * 1.3f).toInt(), RepeatMode.Reverse, reversed = true)
    // A negative delay of half a cycle: starts halfway through.
    val third by transition.drift((DRIFT_MILLIS * 0.8f).toInt(), RepeatMode.Reverse, offsetMillis = (DRIFT_MILLIS * 0.8f / 2).toInt())
    Box(
        modifier
            .graphicsLayer { alpha = fade.value }
            .drawBehind {
                glow(colors.glow, left = 0f, phase = first)
                glow(colors.glowWarm, left = 0.4f, phase = second)
                glow(colors.glow, left = 0.2f, phase = third)
            },
    )
}

@Composable
private fun InfiniteTransition.drift(durationMillis: Int, mode: RepeatMode, reversed: Boolean = false, offsetMillis: Int = 0): State<Float> =
    animateFloat(
        initialValue = if (reversed) 1f else 0f,
        targetValue = if (reversed) 0f else 1f,
        animationSpec = infiniteRepeatable(tween(durationMillis, easing = LinearEasing), mode, StartOffset(offsetMillis)),
        label = "drift",
    )

// The `drift` keyframes at 0%, 50% and 100%: x and y as fractions of the glow's size, then its scale.
private val Drift = listOf(floatArrayOf(-0.12f, -0.10f, 0.85f), floatArrayOf(0.08f, 0.12f, 1.1f), floatArrayOf(0.14f, -0.06f, 0.95f))

/** One glow: an ellipse 60% as wide as the area, fading out from its centre, at [phase] of its drift. */
private fun DrawScope.glow(color: Color, left: Float, phase: Float) {
    val (from, to) = if (phase < 0.5f) Drift[0] to Drift[1] else Drift[1] to Drift[2]
    val t = EaseInOut.transform(if (phase < 0.5f) phase * 2 else (phase - 0.5f) * 2)
    val width = size.width * 0.6f
    val height = size.height
    val scale = lerp(from[2], to[2], t)
    val center = Offset(
        size.width * left + width / 2 + lerp(from[0], to[0], t) * width,
        height / 2 + lerp(from[1], to[1], t) * height,
    )
    // A circle squashed into an ellipse, as `radial-gradient(closest-side, …)` fills the box.
    withTransform({
        scale(scale * width / height, scale, center)
    }) {
        drawCircle(Brush.radialGradient(listOf(color, Color.Transparent), center, height / 2), height / 2, center)
    }
}

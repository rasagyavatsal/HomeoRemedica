package io.github.rasagyavatsal.homeoremedica.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.keyframes
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import kotlinx.coroutines.delay
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.api.AnswerRatings
import io.github.rasagyavatsal.homeoremedica.api.FeedbackReason
import io.github.rasagyavatsal.homeoremedica.api.MAX_FEEDBACK_COMMENT_CHARS
import io.github.rasagyavatsal.homeoremedica.api.Rating
import io.github.rasagyavatsal.homeoremedica.chat.Unrated
import io.github.rasagyavatsal.homeoremedica.ui.theme.Ease
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

// Ports the web app's ratings (src/web/Rating.tsx and src/web/AnswerFeedback.tsx).

private const val SPARKS = 6
private val Overshoot = CubicBezierEasing(0.34f, 1.56f, 0.64f, 1f)

/**
 * Thumbs up and down. Pressing the chosen thumb again takes the rating back, unless [clears] is false;
 * [wave] waves the up thumb once while nothing is rated, as on the newest answer.
 */
@Composable
fun RatingButtons(
    rating: Rating?,
    onRate: (Rating?) -> Unit,
    label: String,
    up: String,
    down: String,
    modifier: Modifier = Modifier,
    clears: Boolean = true,
    wave: Boolean = false,
) {
    // Counts thumbs-ups, so each one plays its burst afresh.
    var bursts by remember { mutableIntStateOf(0) }
    val choose = { choice: Rating ->
        val next = if (rating == choice && clears) null else choice
        if (next == Rating.Up && rating != Rating.Up) bursts++
        onRate(next)
    }
    Row(modifier.semantics { contentDescription = label }, horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        Thumb(Rating.Up, rating, up, if (rating == Rating.Up) bursts else 0, wave && rating == null) { choose(Rating.Up) }
        Thumb(Rating.Down, rating, down, 0, wave = false) { choose(Rating.Down) }
    }
}

@Composable
private fun Thumb(choice: Rating, rating: Rating?, label: String, burst: Int, wave: Boolean, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    val chosen = rating == choice
    val color = when {
        pressed -> colors.text
        chosen && choice == Rating.Up -> colors.accent
        chosen -> colors.text
        else -> colors.textSubtle
    }
    // Once rated, the other thumb steps back.
    val alpha by animateFloatAsState(if (rating != null && !chosen && !pressed) 0.45f else 1f, tween(200, easing = Ease), label = "thumb")
    val motion = remember { Animatable(0f) }
    LaunchedEffect(chosen) {
        if (chosen) motion.animateTo(1f, tween(if (choice == Rating.Up) 440 else 380, easing = if (choice == Rating.Up) Overshoot else Ease))
        motion.snapTo(0f)
    }
    val waving = remember { Animatable(0f) }
    LaunchedEffect(wave) {
        if (!wave) return@LaunchedEffect
        waving.snapTo(0f)
        waving.animateTo(
            1f,
            keyframes {
                durationMillis = 900
                delayMillis = 1800
                0f at 0
                -16f at 180
                10f at 360
                -6f at 540
                2f at 720
                0f at 900
            },
        )
    }
    val compact = LocalCompact.current
    Box(
        Modifier
            .size(if (compact) 44.dp else 28.dp)
            .clip(RoundedCornerShape(if (compact) 10.dp else 6.dp))
            .background(if (pressed) colors.surfaceHover else Color.Transparent)
            .pressable(label = label, interactionSource = interactions, onClick = onClick)
            .semantics {
                contentDescription = label
                selected = chosen
            }
            .graphicsLayer { this.alpha = alpha },
        contentAlignment = Alignment.Center,
    ) {
        if (burst > 0) key(burst) { Burst(colors.accent) }
        val icon: ImageVector = when (choice) {
            Rating.Up -> if (chosen) Icons.ThumbUpChosen else Icons.ThumbUp
            Rating.Down -> if (chosen) Icons.ThumbDownChosen else Icons.ThumbDown
        }
        Icon(
            icon,
            color,
            if (compact) 20.dp else 16.dp,
            Modifier.graphicsLayer {
                // The web app's rating-pop and rating-dip, which peak a third of the way through.
                val peak = (if (motion.value < 0.35f) motion.value / 0.35f else (1 - motion.value) / 0.65f).coerceIn(0f, 1f)
                if (choice == Rating.Up) {
                    scaleX = 1 + 0.32f * peak
                    scaleY = scaleX
                    rotationZ = -14f * peak + waving.value
                    transformOrigin = if (waving.value != 0f) TransformOrigin(0.3f, 0.85f) else TransformOrigin.Center
                } else {
                    scaleX = 1 - 0.12f * peak
                    scaleY = scaleX
                    rotationZ = 8f * peak
                    translationY = 2.dp.toPx() * peak
                }
            },
        )
    }
}

/** A ring and six sparks that fly out from a thumb rated up. */
@Composable
private fun Burst(color: Color) {
    val ring = remember { Animatable(0f) }
    val sparks = remember { Animatable(0f) }
    LaunchedEffect(Unit) { ring.animateTo(1f, tween(520, easing = Ease)) }
    LaunchedEffect(Unit) { sparks.animateTo(1f, tween(560, easing = Ease)) }
    Canvas(Modifier.fillMaxSize()) {
        val radius = size.minDimension / 2
        drawCircle(
            color.copy(alpha = 0.7f * (1 - ring.value)),
            radius * (0.6f + 0.9f * ring.value),
            style = Stroke(1.5.dp.toPx()),
        )
        val distance = (6 + 11 * sparks.value).dp.toPx()
        val sparkRadius = 2.dp.toPx() * (1 - 0.7f * sparks.value)
        for (i in 0 until SPARKS) {
            val angle = i * 2 * PI / SPARKS
            val offset = Offset(center.x + distance * sin(angle).toFloat(), center.y - distance * cos(angle).toFloat())
            drawCircle(color.copy(alpha = 1 - sparks.value), sparkRadius, offset)
        }
    }
}

/**
 * Thumbs for an answer, then [trailing]. Choosing one asks for a comment, with reasons to pick when the
 * answer was rated down: in a sheet on phones, where choosing the rated thumb again takes the rating back,
 * and in a box under the thumbs on wide screens, where it does so while the box is open. [onNote] says
 * whether the note was saved.
 */
@Composable
fun AnswerFeedback(
    ratings: AnswerRatings?,
    onRate: (Rating?) -> Unit,
    onNote: (reasons: List<FeedbackReason>?, comment: String?, onSaved: (Boolean) -> Unit) -> Unit,
    newest: Boolean,
    modifier: Modifier = Modifier,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    val compact = LocalCompact.current
    val (rating, _, reasons, comment) = ratings ?: Unrated
    var open by rememberSaveable { mutableStateOf(false) }
    var draft by rememberSaveable { mutableStateOf("") }
    // Counts comments sent, so each one plays its check afresh.
    var sent by remember { mutableIntStateOf(0) }
    // A rating undone because it could not be saved closes the box too.
    val shown = open && rating != null
    val field = remember { FocusRequester() }
    // A thumb rated up plays its burst before the sheet covers it.
    var asking by remember { mutableStateOf<Rating?>(null) }
    LaunchedEffect(asking) {
        if (asking == Rating.Up) delay(450)
        if (asking != null) {
            open = true
            asking = null
        }
    }

    val choose = { next: Rating? ->
        if (next == null) {
            open = false
            onRate(null)
        } else {
            if (next != rating) onRate(next)
            if (!shown) {
                draft = comment.orEmpty()
                sent = 0
            }
            if (compact) asking = next else open = true
        }
    }
    val changed = draft.trim() != comment.orEmpty()
    val send = {
        if (changed) {
            sent++
            // Reopen with the text still there if it could not be saved.
            onNote(null, draft) { saved -> if (!saved) open = true }
        }
    }
    val submit = {
        open = false
        send()
    }
    BackHandler(enabled = shown && !compact) { open = false }
    LaunchedEffect(shown) { if (shown && !compact) runCatching { field.requestFocus() } }

    val reasonChips = @Composable {
        FlowRow(
            Modifier.semantics { contentDescription = "What went wrong" },
            horizontalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 4.dp),
            verticalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 4.dp),
        ) {
            FeedbackReason.entries.forEachIndexed { index, reason ->
                ReasonChip(reason.label, reason in reasons, Modifier.rise(reason, 200, 50 * index), large = compact) {
                    onNote(if (reason in reasons) reasons - reason else reasons + reason, null) {}
                }
            }
        }
    }

    Column(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Settles in just after the answer finishes, once the reader reaches the end.
            RatingButtons(
                rating,
                choose,
                "Rate this answer",
                "Helpful",
                "Not helpful",
                Modifier.rise("rating", 320, 480),
                clears = shown || compact,
                wave = newest,
            )
            if (sent > 0 && !shown) key(sent) { SentCheck() }
            Spacer(Modifier.weight(1f))
            trailing()
        }
        if (compact) {
            if (shown) {
                BottomSheet(
                    "Feedback",
                    { open = false },
                    title = if (rating == Rating.Down) "What went wrong?" else "What helped?",
                ) {
                    val close = ::dismiss
                    Column(
                        Modifier.padding(start = 24.dp, end = 24.dp, bottom = 16.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        if (rating == Rating.Down) reasonChips()
                        CommentBox(
                            draft,
                            { draft = it.take(MAX_FEEDBACK_COMMENT_CHARS) },
                            "Add a comment",
                            changed,
                            {
                                send()
                                close()
                            },
                            Modifier,
                            large = true,
                        )
                    }
                }
            }
            return@Column
        }
        AnimatedVisibility(
            shown,
            enter = expandVertically(tween(320, easing = Ease)) + fadeIn(tween(200, easing = Ease)),
            exit = shrinkVertically(tween(320, easing = Ease)) + fadeOut(tween(200, easing = Ease)),
        ) {
            Column(Modifier.widthIn(max = 680.dp)) {
                if (rating == Rating.Down) Box(Modifier.padding(top = 8.dp)) { reasonChips() }
                CommentBox(
                    draft,
                    { draft = it.take(MAX_FEEDBACK_COMMENT_CHARS) },
                    if (rating == Rating.Down) "What was missing or wrong?" else "What helped?",
                    changed,
                    submit,
                    Modifier.focusRequester(field),
                )
            }
        }
    }
}

/** A check that shows for a moment after a comment is sent. */
@Composable
private fun SentCheck() {
    val alpha = remember { Animatable(0f) }
    LaunchedEffect(Unit) {
        alpha.animateTo(
            0f,
            keyframes {
                durationMillis = 2400
                0f at 0
                1f at 240
                1f at 1800
                0f at 2400
            },
        )
    }
    Icon(Icons.Check, Theme.colors.accent, 16.dp, Modifier.graphicsLayer { this.alpha = alpha.value })
}

@Composable
private fun ReasonChip(text: String, chosen: Boolean, modifier: Modifier, large: Boolean = false, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    BasicText(
        text,
        style = TextStyle(
            color = if (chosen) colors.accentText else if (pressed) colors.text else colors.textMuted,
            fontFamily = Fonts.sans,
            fontSize = if (large) 14.sp else 12.sp,
            fontWeight = FontWeight.Medium,
        ),
        modifier = modifier
            .clip(Pill)
            .background(if (chosen) colors.accentSoft else colors.surface)
            .border(1.dp, if (chosen) colors.accentBorder else if (pressed) colors.borderStrong else colors.border, Pill)
            .pressable(label = text, interactionSource = interactions, onClick = onClick)
            .semantics { selected = chosen }
            .heightIn(min = if (large) 40.dp else 28.dp)
            .wrapContentHeight(Alignment.CenterVertically)
            .padding(horizontal = if (large) 16.dp else 12.dp, vertical = 6.dp),
    )
}

@Composable
private fun CommentBox(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    canSend: Boolean,
    onSend: () -> Unit,
    fieldModifier: Modifier,
    large: Boolean = false,
) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    val text = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = if (large) 15.sp else 13.sp, lineHeight = 1.4.em)
    Row(
        Modifier
            .padding(top = if (large) 0.dp else 8.dp)
            .fillMaxWidth()
            .background(colors.surfaceRaised, shape)
            .border(1.dp, if (focused) colors.accent else colors.borderStrong, shape)
            .padding(start = 12.dp, top = 4.dp, end = 4.dp, bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        BasicTextField(
            value,
            onValueChange,
            fieldModifier
                .weight(1f)
                .heightIn(min = if (large) 32.dp else 0.dp, max = 128.dp)
                .padding(vertical = if (large) 8.dp else 4.dp)
                .onPreviewKeyEvent { event ->
                    // Enter sends; Shift+Enter adds a line.
                    val enter = event.key == Key.Enter || event.key == Key.NumPadEnter
                    if (enter && !event.isShiftPressed) {
                        if (event.type == KeyEventType.KeyDown) onSend()
                        true
                    } else {
                        false
                    }
                }
                .semantics { contentDescription = "Comment" },
            textStyle = text,
            cursorBrush = SolidColor(colors.accent),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { onSend() }),
            interactionSource = interactions,
            decorationBox = { inner ->
                Box {
                    if (value.isEmpty()) BasicText(placeholder, style = text.copy(color = colors.textSubtle))
                    inner()
                }
            },
        )
        Box(
            Modifier
                .size(if (large) 40.dp else 28.dp)
                .background(if (canSend) colors.accent else colors.surfaceSelected, RoundedCornerShape(if (large) 10.dp else 6.dp))
                .pressable(canSend, label = "Send comment", onClick = onSend)
                .semantics { contentDescription = "Send comment" },
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.ArrowUp, if (canSend) colors.textOnAccent else colors.textSubtle, 16.dp)
        }
    }
}

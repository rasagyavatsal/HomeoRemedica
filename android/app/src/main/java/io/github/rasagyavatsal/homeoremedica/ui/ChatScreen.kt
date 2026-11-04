package io.github.rasagyavatsal.homeoremedica.ui

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.isShiftPressed
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.rasagyavatsal.homeoremedica.api.Role
import io.github.rasagyavatsal.homeoremedica.chat.COUNTER_FROM
import io.github.rasagyavatsal.homeoremedica.chat.ChatState
import io.github.rasagyavatsal.homeoremedica.chat.ChatViewModel
import io.github.rasagyavatsal.homeoremedica.chat.MAX_QUESTION_CHARS
import io.github.rasagyavatsal.homeoremedica.chat.Message
import io.github.rasagyavatsal.homeoremedica.chat.MessageStatus
import io.github.rasagyavatsal.homeoremedica.ui.theme.Ease
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme
import java.text.NumberFormat

// Ports the web app's chat page (src/web/App.tsx).

private val ColumnWidth = 760.dp

/** The reference open in the sources panel: an answer and one of its sources. */
private data class OpenSource(val messageId: Long, val number: Int)

private val OpenSourceSaver = listSaver<OpenSource?, Long>(
    save = { open -> open?.let { listOf(it.messageId, it.number.toLong()) }.orEmpty() },
    restore = { saved -> OpenSource(saved[0], saved[1].toInt()) },
)

@Composable
fun ChatScreen(viewModel: ChatViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    ChatScreen(
        state = state,
        onDraftChange = viewModel::updateDraft,
        onSubmit = viewModel::submit,
        onStop = viewModel::stop,
        onRetry = viewModel::retry,
        onClear = viewModel::clearConversation,
    )
}

@Composable
fun ChatScreen(
    state: ChatState,
    onDraftChange: (String) -> Unit,
    onSubmit: (String) -> Unit,
    onStop: () -> Unit,
    onRetry: () -> Unit,
    onClear: () -> Unit,
) {
    val colors = Theme.colors
    val keyboard = LocalSoftwareKeyboardController.current
    val submit = { text: String ->
        keyboard?.hide()
        onSubmit(text)
    }
    var openSource by rememberSaveable(stateSaver = OpenSourceSaver) { mutableStateOf(null) }
    val open = openSource
    val source = open?.let { state.messages.find { message -> message.id == it.messageId }?.sources?.getOrNull(it.number - 1) }
    // Tapping the open reference again closes the panel.
    val showSource = { messageId: Long, number: Int ->
        val next = OpenSource(messageId, number)
        openSource = if (openSource == next) null else next
    }
    val closeSource = { openSource = null }
    BackHandler(enabled = source != null, onBack = closeSource)

    CompositionLocalProvider(LocalEntrances provides remember { Entrances() }) {
        BoxWithConstraints(Modifier.fillMaxSize().background(colors.canvas).imePadding()) {
            val wide = maxWidth >= 640.dp
            val panelWidth = if (wide) (maxWidth * 0.32f).coerceIn(288.dp, 400.dp) else minOf(400.dp, maxWidth)
            Row(Modifier.fillMaxSize()) {
                Column(Modifier.weight(1f).fillMaxHeight()) {
                    Header(wide, enabled = state.canClear) {
                        openSource = null
                        onClear()
                    }
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        var composerHeight by remember { mutableIntStateOf(0) }
                        val bottomPadding = with(LocalDensity.current) { composerHeight.toDp() }
                        if (state.messages.isEmpty()) {
                            Welcome(bottomPadding)
                        } else {
                            Conversation(state, wide, bottomPadding, open, showSource, onRetry)
                        }
                        ComposerArea(
                            state = state,
                            wide = wide,
                            onDraftChange = onDraftChange,
                            onSubmit = { submit(state.draft) },
                            onStop = onStop,
                            onHeightChange = { composerHeight = it },
                            modifier = Modifier.align(Alignment.BottomCenter),
                        )
                    }
                }
                // Beside the chat on wide screens, as the web app's `.sources` column.
                if (source != null && open != null && wide) {
                    key(source.id) {
                        SourcesPanel(
                            source,
                            open.number,
                            closeSource,
                            Modifier
                                .width(panelWidth)
                                .fillMaxHeight()
                                .drawBehind { drawLine(colors.border, Offset.Zero, Offset(0f, size.height), 1.dp.toPx()) },
                        )
                    }
                }
            }
            // Over the chat on narrow screens.
            if (source != null && open != null && !wide) {
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(colors.scrim)
                        .pressable(label = "Close source", onClick = closeSource),
                )
                key(source.id) {
                    SourcesPanel(
                        source,
                        open.number,
                        closeSource,
                        Modifier
                            .align(Alignment.CenterEnd)
                            .width(panelWidth)
                            .fillMaxHeight()
                            .shadowLarge(RectangleShape, colors.shadow),
                    )
                }
            }
        }
    }
}

@Composable
private fun Header(wide: Boolean, enabled: Boolean, onClear: () -> Unit) {
    val colors = Theme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .background(colors.canvas)
            .drawBehind { drawLine(colors.border, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .statusBarsPadding()
            .padding(horizontal = if (wide) 20.dp else 16.dp, vertical = if (wide) 14.dp else 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Brand()
        if (wide) {
            Button("New chat", ButtonStyle.Quiet, onClear, enabled = enabled, icon = Icons.Plus, color = Theme.colors.textMuted)
        } else if (enabled) {
            IconButton(Icons.Plus, "New chat", onClear)
        }
    }
}

@Composable
private fun Conversation(
    state: ChatState,
    wide: Boolean,
    bottomPadding: Dp,
    openSource: OpenSource?,
    onSource: (messageId: Long, number: Int) -> Unit,
    onRetry: () -> Unit,
) {
    val listState = rememberLazyListState()
    val latestQuestion = state.messages.indexOfLast { it.role == Role.User }

    // Bring each new exchange to the top of the view so long answers read from their start.
    LaunchedEffect(state.messages.size) {
        if (latestQuestion >= 0) listState.animateScrollToItem(latestQuestion)
    }

    val itemModifier = Modifier
        .widthIn(max = ColumnWidth)
        .fillMaxWidth()
        .padding(horizontal = if (wide) 24.dp else 16.dp)
        .padding(bottom = if (wide) 36.dp else 30.dp)
    LazyColumn(
        Modifier.fillMaxSize().semantics { contentDescription = "Conversation" },
        state = listState,
        contentPadding = PaddingValues(top = if (wide) 40.dp else 28.dp, bottom = bottomPadding + 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        itemsIndexed(state.messages, key = { _, message -> message.id }) { index, message ->
            if (message.role == Role.User) {
                UserMessage(message.content, wide, itemModifier.rise(message.id))
            } else {
                val question = state.messages.getOrNull(index - 1)?.takeIf { it.role == Role.User }?.content.orEmpty()
                Reply(
                    question,
                    message,
                    activeSource = openSource?.takeIf { it.messageId == message.id }?.number,
                    onSource = { number -> onSource(message.id, number) },
                    onRetry = onRetry.takeIf { index == state.messages.lastIndex },
                    compacting = state.compacting && index == state.messages.lastIndex,
                    modifier = itemModifier.rise(message.id),
                )
            }
        }
    }
}

@Composable
private fun UserMessage(content: String, wide: Boolean, modifier: Modifier) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(16.dp)
    BoxWithConstraints(modifier, contentAlignment = Alignment.CenterEnd) {
        val maxBubble = maxWidth * 0.85f
        SelectionContainer {
            BasicText(
                content,
                style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 15.sp, lineHeight = 1.4.em),
                modifier = Modifier
                    .widthIn(max = maxBubble)
                    .background(colors.surfaceRaised, shape)
                    .border(1.dp, colors.border, shape)
                    .padding(horizontal = 16.dp, vertical = 12.dp)
                    .semantics { contentDescription = "You: $content" },
            )
        }
    }
}

@Composable
private fun Reply(
    question: String,
    message: Message,
    activeSource: Int?,
    onSource: (Int) -> Unit,
    onRetry: (() -> Unit)?,
    compacting: Boolean,
    modifier: Modifier,
) {
    val colors = Theme.colors
    val streaming = message.status == MessageStatus.Streaming
    when {
        message.status == MessageStatus.Error -> ReplyError(message.error.orEmpty(), onRetry, modifier)
        streaming && message.content.isEmpty() -> Progress(
            when {
                compacting -> "Summarizing earlier messages…"
                message.sources != null -> "Reading the passages…"
                else -> "Searching the books…"
            },
            modifier,
        )
        else -> Column(modifier) {
            val note = @Composable {
                if (message.status == MessageStatus.Stopped) {
                    BasicText(
                        if (message.content.isNotEmpty()) "Stopped before the answer finished." else "Stopped.",
                        style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 13.sp, fontStyle = FontStyle.Italic),
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
            if (message.content.isNotEmpty()) {
                Answer(question, message.content, message.sources.orEmpty(), streaming, activeSource, onSource, note = note)
            } else {
                note()
            }
        }
    }
}

/** What the answer is waiting on: the web app's `.reply-progress`. */
@Composable
private fun Progress(label: String, modifier: Modifier) {
    val colors = Theme.colors
    val beat by rememberInfiniteTransition("progress").animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(600, easing = Ease), RepeatMode.Reverse),
        label = "progress pulse",
    )
    Row(
        modifier.semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier
                .size(8.dp)
                .graphicsLayer {
                    alpha = 1 - 0.75f * beat
                    scaleX = 1 - 0.3f * beat
                    scaleY = scaleX
                }
                .background(colors.accent, Pill),
        )
        BasicText(label, style = TextStyle(color = colors.textMuted, fontFamily = Fonts.sans, fontSize = 13.sp))
    }
}

@Composable
private fun ComposerArea(
    state: ChatState,
    wide: Boolean,
    onDraftChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onStop: () -> Unit,
    onHeightChange: (Int) -> Unit,
    modifier: Modifier,
) {
    val colors = Theme.colors
    // On an empty chat the question box follows the tagline in.
    val welcome = remember(state.messages.isEmpty()) { Any() }
    Column(
        modifier
            .fillMaxWidth()
            // Content fades out under the composer, as in the web app.
            .drawBehind { drawRect(Brush.verticalGradient(listOf(Color.Transparent, colors.canvas), startY = 0f, endY = 26.dp.toPx())) }
            .padding(horizontal = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Column(Modifier.widthIn(max = ColumnWidth - 48.dp).fillMaxWidth()) {
            Column(
                Modifier
                    .onSizeChanged { onHeightChange(it.height) }
                    .navigationBarsPadding()
                    .padding(top = if (wide) 18.dp else 14.dp, bottom = if (wide) 16.dp else 10.dp),
            ) {
                Box(if (state.messages.isEmpty()) Modifier.rise(welcome, REVEAL_MILLIS, TAGLINE_MILLIS) else Modifier) {
                    Composer(state, wide, onDraftChange, onSubmit, onStop)
                }
            }
        }
    }
}

@Composable
private fun Composer(state: ChatState, wide: Boolean, onDraftChange: (String) -> Unit, onSubmit: () -> Unit, onStop: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val radius = 16.dp
    val shape = RoundedCornerShape(radius)
    val canSend = !state.busy && state.draft.isNotBlank()
    Row(
        Modifier
            .fillMaxWidth()
            .drawBehind {
                if (focused) {
                    val ring = 3.dp.toPx()
                    drawRoundRect(
                        colors.accentSoft,
                        topLeft = Offset(-ring, -ring),
                        size = Size(size.width + ring * 2, size.height + ring * 2),
                        cornerRadius = CornerRadius(radius.toPx() + ring),
                    )
                }
            }
            .shadowMedium(shape, colors.shadow)
            .background(colors.surfaceRaised, shape)
            .border(1.dp, if (focused) colors.accent else colors.borderStrong, shape)
            .padding(start = 16.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        BasicTextField(
            value = state.draft,
            onValueChange = onDraftChange,
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 36.dp, max = 192.dp)
                .onPreviewKeyEvent { event ->
                    // Enter sends; Shift+Enter adds a line.
                    val enter = event.key == Key.Enter || event.key == Key.NumPadEnter
                    if (enter && !event.isShiftPressed) {
                        if (event.type == KeyEventType.KeyDown) onSubmit()
                        true
                    } else {
                        false
                    }
                }
                .semantics { contentDescription = "Message" },
            textStyle = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 15.sp, lineHeight = 21.sp),
            cursorBrush = SolidColor(colors.accent),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { onSubmit() }),
            interactionSource = interactions,
            decorationBox = { field ->
                Box(Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.CenterStart) {
                    if (state.draft.isEmpty()) {
                        BasicText(
                            "Ask about a remedy, symptom or principle…",
                            style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 15.sp, lineHeight = 21.sp),
                        )
                    }
                    field()
                }
            },
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (state.draft.length >= COUNTER_FROM) {
                val count = NumberFormat.getIntegerInstance()
                BasicText(
                    "${count.format(state.draft.length)} / ${count.format(MAX_QUESTION_CHARS)}",
                    style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 12.sp, fontFeatureSettings = "tnum"),
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
            if (state.busy) SendButton(Icons.Stop, "Stop answering", enabled = true, onStop)
            else SendButton(Icons.ArrowUp, "Send message", canSend, onSubmit)
        }
    }
}

@Composable
private fun SendButton(icon: ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Box(
        Modifier
            .scale(if (pressed && enabled) 0.96f else 1f)
            .size(36.dp)
            .background(
                when {
                    !enabled -> colors.surfaceSelected
                    pressed -> colors.accentHover
                    else -> colors.accent
                },
                RoundedCornerShape(10.dp),
            )
            .pressable(enabled, label = label, interactionSource = interactions, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, if (enabled) colors.textOnAccent else colors.textSubtle, 18.dp)
    }
}


/** A failed answer, with a way to ask again when it is the last one. */
@Composable
private fun ReplyError(message: String, onRetry: (() -> Unit)?, modifier: Modifier) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(10.dp)
    Row(
        modifier
            .background(colors.dangerSoft, shape)
            .padding(horizontal = 16.dp, vertical = 12.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Assertive },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Alert, colors.danger, 16.dp)
        BasicText(
            message,
            style = TextStyle(color = colors.danger, fontFamily = Fonts.sans, fontSize = 13.sp, lineHeight = 1.4.em),
            modifier = Modifier.weight(1f),
        )
        if (onRetry != null) Button("Try again", ButtonStyle.Quiet, onRetry, icon = Icons.Retry)
    }
}

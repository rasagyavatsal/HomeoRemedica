package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
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
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import io.github.rasagyavatsal.homeoremedica.api.Book
import io.github.rasagyavatsal.homeoremedica.api.Role
import io.github.rasagyavatsal.homeoremedica.chat.ChatState
import io.github.rasagyavatsal.homeoremedica.chat.ChatViewModel
import io.github.rasagyavatsal.homeoremedica.chat.Message
import io.github.rasagyavatsal.homeoremedica.chat.MessageStatus
import io.github.rasagyavatsal.homeoremedica.chat.SUGGESTIONS
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Ports the web app's chat page (src/web/App.tsx).

private val ColumnWidth = 760.dp

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
    CompositionLocalProvider(LocalEntrances provides remember { Entrances() }) {
        BoxWithConstraints(Modifier.fillMaxSize().background(colors.bg).imePadding()) {
            val wide = maxWidth >= 640.dp
            Column(Modifier.fillMaxSize()) {
                Header(wide, enabled = state.canClear, onClear = onClear)
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    var composerHeight by remember { mutableIntStateOf(0) }
                    val bottomPadding = with(LocalDensity.current) { composerHeight.toDp() }
                    if (state.messages.isEmpty()) {
                        EmptyState(state.books, wide, bottomPadding, onAsk = submit)
                    } else {
                        Conversation(state, wide, bottomPadding, onRetry)
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
        }
    }
}

@Composable
private fun Header(wide: Boolean, enabled: Boolean, onClear: () -> Unit) {
    val colors = Theme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .background(colors.bg)
            .drawBehind { drawLine(colors.line, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .statusBarsPadding()
            .padding(horizontal = if (wide) 20.dp else 16.dp, vertical = if (wide) 14.dp else 10.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            Modifier.semantics(mergeDescendants = true) { heading() },
            horizontalArrangement = Arrangement.spacedBy(9.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            MarkBadge(size = if (wide) 30.dp else 28.dp, corner = 9.dp, markSize = 20.dp)
            BasicText(
                buildAnnotatedString {
                    append("Homeo")
                    withStyle(SpanStyle(color = colors.accent)) { append("Remedica") }
                },
                style = TextStyle(
                    color = colors.ink,
                    fontFamily = Fonts.serif,
                    fontSize = if (wide) 20.sp else 18.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = (-0.2).sp,
                ),
            )
        }
        PillButton(
            text = if (wide) "New chat" else null,
            style = ButtonStyle.Quiet,
            onClick = onClear,
            enabled = enabled,
            icon = Icons.Plus,
            contentDescription = "New chat",
        )
    }
}

@Composable
private fun EmptyState(books: List<Book>, wide: Boolean, bottomPadding: Dp, onAsk: (String) -> Unit) {
    val colors = Theme.colors
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val viewport = maxHeight
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
            Column(
                Modifier
                    .widthIn(max = ColumnWidth)
                    .fillMaxWidth()
                    .heightIn(min = viewport)
                    .padding(start = 16.dp, end = 16.dp, top = 36.dp, bottom = bottomPadding + 40.dp)
                    .rise(remember { Any() }, 420),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                MarkBadge(size = 56.dp, corner = 18.dp, markSize = 28.dp)
                Spacer(Modifier.height(22.dp))
                BasicText(
                    "Ask the classical materia medica.",
                    style = TextStyle(
                        color = colors.ink,
                        fontFamily = Fonts.serif,
                        fontSize = if (wide) 38.sp else 30.sp,
                        lineHeight = 1.12.em,
                        fontWeight = FontWeight.Medium,
                        letterSpacing = (-0.6).sp,
                        textAlign = TextAlign.Center,
                    ),
                    modifier = Modifier.semantics { heading() },
                )
                Spacer(Modifier.height(14.dp))
                BasicText(
                    "Answers are drawn from ${if (books.isNotEmpty()) "${books.size} historical texts" else "historical texts"} and cite the passages they rely on.",
                    style = TextStyle(color = colors.muted, fontFamily = Fonts.sans, fontSize = 15.sp, lineHeight = 1.6.em, textAlign = TextAlign.Center),
                    modifier = Modifier.widthIn(max = 440.dp),
                )
                Spacer(Modifier.height(if (wide) 34.dp else 26.dp))
                Column(Modifier.widthIn(max = 620.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    for (row in SUGGESTIONS.chunked(if (wide) 2 else 1)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            for (suggestion in row) Suggestion(suggestion, wide, Modifier.weight(1f)) { onAsk(suggestion) }
                        }
                    }
                }
                if (books.isNotEmpty()) {
                    Spacer(Modifier.height(30.dp))
                    FlowRow(
                        Modifier.semantics { contentDescription = "Books in the corpus" },
                        horizontalArrangement = Arrangement.spacedBy(22.dp, Alignment.CenterHorizontally),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        for (book in books) {
                            BasicText(
                                book.author ?: book.title,
                                style = TextStyle(color = colors.faint, fontFamily = Fonts.serif, fontStyle = FontStyle.Italic, fontSize = 14.sp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Suggestion(text: String, wide: Boolean, modifier: Modifier, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    val shape = RoundedCornerShape(12.dp)
    BasicText(
        text,
        style = TextStyle(color = if (pressed) colors.ink else colors.inkSoft, fontFamily = Fonts.sans, fontSize = 14.sp, lineHeight = 1.45.em),
        modifier = modifier
            .then(if (pressed) Modifier.shadowMedium(shape, colors.shadow) else Modifier.shadowSmall(shape, colors.shadow))
            .background(colors.surface, shape)
            .border(1.dp, if (pressed) colors.lineStrong else colors.line, shape)
            .pressable(interactionSource = interactions, onClick = onClick)
            .padding(horizontal = if (wide) 16.dp else 14.dp, vertical = if (wide) 14.dp else 12.dp),
    )
}

@Composable
private fun Conversation(state: ChatState, wide: Boolean, bottomPadding: Dp, onRetry: () -> Unit) {
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
                    wide,
                    onRetry = onRetry.takeIf { index == state.messages.lastIndex },
                    modifier = itemModifier.rise(message.id),
                )
            }
        }
    }
}

@Composable
private fun UserMessage(content: String, wide: Boolean, modifier: Modifier) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(topStart = 18.dp, topEnd = 18.dp, bottomEnd = 5.dp, bottomStart = 18.dp)
    BoxWithConstraints(modifier, contentAlignment = Alignment.CenterEnd) {
        val maxBubble = if (wide) minOf(maxWidth * 0.85f, 560.dp) else maxWidth * 0.92f
        SelectionContainer {
            BasicText(
                content,
                style = TextStyle(color = colors.ink, fontFamily = Fonts.sans, fontSize = 15.sp, lineHeight = 1.55.em),
                modifier = Modifier
                    .widthIn(max = maxBubble)
                    .background(colors.surfaceSunken, shape)
                    .border(1.dp, colors.line, shape)
                    .padding(horizontal = 17.dp, vertical = 12.dp)
                    .semantics { contentDescription = "You: $content" },
            )
        }
    }
}

@Composable
private fun AssistantLabel(text: String, pending: Boolean, color: Color, weight: FontWeight) {
    Row(
        Modifier.padding(bottom = 12.dp),
        horizontalArrangement = Arrangement.spacedBy(9.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MarkBadge(size = 24.dp, corner = 7.dp, markSize = 14.dp, modifier = if (pending) Modifier.pulse() else Modifier)
        BasicText(text, style = TextStyle(color = color, fontFamily = Fonts.sans, fontSize = 13.sp, fontWeight = weight))
    }
}

@Composable
private fun Reply(question: String, message: Message, wide: Boolean, onRetry: (() -> Unit)?, modifier: Modifier) {
    val colors = Theme.colors
    val streaming = message.status == MessageStatus.Streaming
    when {
        message.status == MessageStatus.Error -> ReplyError(message.error.orEmpty(), onRetry, modifier)
        streaming && message.content.isEmpty() -> Progress(modifier)
        else -> Column(modifier) {
            AssistantLabel("HomeoRemedica", streaming, colors.inkSoft, FontWeight.SemiBold)
            if (message.content.isNotEmpty()) Answer(question, message.content, message.sources, wide)
            if (message.status == MessageStatus.Stopped) {
                BasicText(
                    if (message.content.isNotEmpty()) "Stopped before the answer finished." else "Stopped.",
                    style = TextStyle(color = colors.faint, fontFamily = Fonts.sans, fontSize = 13.sp, fontStyle = FontStyle.Italic),
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
        }
    }
}

@Composable
private fun Progress(modifier: Modifier) {
    val colors = Theme.colors
    Column(modifier.semantics { liveRegion = LiveRegionMode.Polite }) {
        AssistantLabel("Preparing an answer…", pending = true, colors.muted, FontWeight.Medium)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            for (fraction in listOf(1f, 0.88f, 0.62f)) {
                Box(
                    Modifier
                        .fillMaxWidth(fraction)
                        .height(12.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .shimmer(colors.surfaceHover, colors.lineStrong),
                )
            }
        }
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
    Column(
        modifier
            .fillMaxWidth()
            // Content fades out under the composer, as in the web app.
            .drawBehind { drawRect(Brush.verticalGradient(listOf(Color.Transparent, colors.bg), startY = 0f, endY = 26.dp.toPx())) }
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
                Composer(state, wide, onDraftChange, onSubmit, onStop)
            }
        }
    }
}

@Composable
private fun Composer(state: ChatState, wide: Boolean, onDraftChange: (String) -> Unit, onSubmit: () -> Unit, onStop: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val radius = if (wide) 20.dp else 18.dp
    val shape = RoundedCornerShape(radius)
    val canSend = !state.busy && state.draft.isNotBlank()
    Row(
        Modifier
            .fillMaxWidth()
            .drawBehind {
                if (focused) {
                    val ring = 4.dp.toPx()
                    drawRoundRect(
                        colors.accent.copy(alpha = 0.12f),
                        topLeft = Offset(-ring, -ring),
                        size = Size(size.width + ring * 2, size.height + ring * 2),
                        cornerRadius = CornerRadius(radius.toPx() + ring),
                    )
                }
            }
            .shadowMedium(shape, colors.shadow)
            .background(colors.surface, shape)
            .border(1.dp, if (focused) lerp(colors.lineStrong, colors.accent, 0.55f) else colors.lineStrong, shape)
            .padding(start = if (wide) 18.dp else 14.dp, top = 8.dp, end = 8.dp, bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        BasicTextField(
            value = state.draft,
            onValueChange = onDraftChange,
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 36.dp, max = 200.dp)
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
            textStyle = TextStyle(color = colors.ink, fontFamily = Fonts.sans, fontSize = 16.sp, lineHeight = 20.sp),
            cursorBrush = SolidColor(colors.accent),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { onSubmit() }),
            interactionSource = interactions,
            decorationBox = { field ->
                Box(Modifier.padding(vertical = 8.dp), contentAlignment = Alignment.CenterStart) {
                    if (state.draft.isEmpty()) {
                        BasicText(
                            if (state.messages.isNotEmpty()) "Ask a follow-up…" else "Ask about a remedy or symptom…",
                            style = TextStyle(color = colors.faint, fontFamily = Fonts.sans, fontSize = 16.sp, lineHeight = 20.sp),
                        )
                    }
                    field()
                }
            },
        )
        if (state.busy) SendButton(Icons.Stop, "Stop answering", enabled = true, onStop)
        else SendButton(Icons.ArrowUp, "Send message", canSend, onSubmit)
    }
}

@Composable
private fun SendButton(icon: ImageVector, label: String, enabled: Boolean, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Box(
        Modifier
            .scale(if (pressed && enabled) 0.94f else 1f)
            .size(36.dp)
            .background(
                when {
                    !enabled -> colors.surfaceSunken
                    pressed -> colors.accentHover
                    else -> colors.accent
                },
                RoundedCornerShape(12.dp),
            )
            .pressable(enabled, label = label, interactionSource = interactions, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, if (enabled) colors.accentInk else colors.faint, 18.dp)
    }
}


/** A failed answer, with a way to ask again when it is the last one. */
@Composable
private fun ReplyError(message: String, onRetry: (() -> Unit)?, modifier: Modifier) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(12.dp)
    Row(
        modifier
            .background(colors.dangerSoft, shape)
            .border(1.dp, colors.danger.copy(alpha = 0.3f), shape)
            .padding(horizontal = 14.dp, vertical = 11.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Assertive },
        horizontalArrangement = Arrangement.spacedBy(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Alert, colors.danger, 16.dp)
        BasicText(
            message,
            style = TextStyle(color = colors.danger, fontFamily = Fonts.sans, fontSize = 13.5.sp, lineHeight = 1.5.em),
            modifier = Modifier.weight(1f),
        )
        if (onRetry != null) PillButton("Try again", ButtonStyle.Quiet, onRetry, icon = Icons.Retry)
    }
}

package io.github.rasagyavatsal.homeoremedica.ui

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.net.toUri
import io.github.rasagyavatsal.homeoremedica.BuildConfig
import io.github.rasagyavatsal.homeoremedica.answer.citedNumbers
import io.github.rasagyavatsal.homeoremedica.answer.label
import io.github.rasagyavatsal.homeoremedica.answer.parseAnswer
import io.github.rasagyavatsal.homeoremedica.answer.sourceOrder
import io.github.rasagyavatsal.homeoremedica.api.Citation
import io.github.rasagyavatsal.homeoremedica.ui.theme.Ease
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Ports the web app's answer view (src/web/Answer.tsx).

@Composable
fun Answer(question: String, content: String, sources: List<Citation>, wide: Boolean, modifier: Modifier = Modifier) {
    var sourcesOpen by rememberSaveable { mutableStateOf(false) }
    var openItems by rememberSaveable { mutableStateOf(intArrayOf()) }
    var highlighted by remember { mutableIntStateOf(0) }
    var highlightRequest by remember { mutableIntStateOf(0) }
    val requesters = remember(sources.size) { List(sources.size) { BringIntoViewRequester() } }
    val blocks = remember(content, sources.size) { parseAnswer(content, sources.size) }
    val cited = remember(content, sources.size) { citedNumbers(content, sources.size) }

    fun setItemOpen(number: Int, open: Boolean) {
        openItems = if (open) (openItems.toSet() + number).toIntArray() else openItems.filter { it != number }.toIntArray()
    }

    // Each citation tap restarts the highlight and brings its source into view once it has opened.
    LaunchedEffect(highlightRequest) {
        if (highlightRequest == 0) return@LaunchedEffect
        delay(32)
        requesters.getOrNull(highlighted - 1)?.bringIntoView()
        delay(1800)
        highlighted = 0
    }

    Column(modifier) {
        SelectionContainer {
            MarkdownText(
                blocks,
                onCitation = { number ->
                    sourcesOpen = true
                    setItemOpen(number, true)
                    highlighted = number
                    highlightRequest++
                },
                citationLabel = { number ->
                    sources.getOrNull(number - 1)?.let { "Source $number: ${it.label}, ${it.bookTitle}" } ?: "Source $number"
                },
            )
        }
        Spacer(Modifier.height(18.dp))
        Row(verticalAlignment = Alignment.Top) {
            if (sources.isNotEmpty()) SourcesToggle(sources.size, sourcesOpen) { sourcesOpen = !sourcesOpen }
            Spacer(Modifier.weight(1f))
            ReportButton(question, content)
            CopyButton(content)
        }
        if (sources.isNotEmpty() && sourcesOpen) {
            SourceList(
                sources = sources,
                cited = cited,
                openItems = openItems.toSet(),
                onItemChange = ::setItemOpen,
                highlighted = highlighted,
                requesters = requesters,
                wide = wide,
            )
        }
    }
}

@Composable
private fun SourcesToggle(count: Int, open: Boolean, onToggle: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    val rotation by animateFloatAsState(if (open) 90f else 0f, tween(200, easing = Ease), label = "sources chevron")
    Row(
        Modifier
            .clip(Pill)
            .background(if (pressed) colors.surfaceHover else Color.Transparent)
            .border(1.dp, if (pressed) colors.lineStrong else colors.line, Pill)
            .pressable(label = if (open) "Hide sources" else "Show sources", interactionSource = interactions, onClick = onToggle)
            .padding(start = 8.dp, end = 11.dp, top = 5.dp, bottom = 5.dp),
        horizontalArrangement = Arrangement.spacedBy(7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Chevron, colors.faint, 14.dp, Modifier.rotate(rotation))
        BasicText("Sources", style = TextStyle(color = colors.inkSoft, fontFamily = Fonts.sans, fontSize = 13.sp, fontWeight = FontWeight.Medium))
        Box(
            Modifier.defaultMinSize(minWidth = 20.dp).clip(Pill).background(colors.surfaceSunken).padding(horizontal = 6.dp, vertical = 1.dp),
            contentAlignment = Alignment.Center,
        ) {
            BasicText(
                count.toString(),
                style = TextStyle(color = colors.muted, fontFamily = Fonts.sans, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, fontFeatureSettings = "tnum"),
            )
        }
    }
}

@Composable
private fun SourceList(
    sources: List<Citation>,
    cited: Set<Int>,
    openItems: Set<Int>,
    onItemChange: (Int, Boolean) -> Unit,
    highlighted: Int,
    requesters: List<BringIntoViewRequester>,
    wide: Boolean,
) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(14.dp)
    Column(
        Modifier
            .padding(top = 12.dp)
            .rise(sources, 220)
            .fillMaxWidth()
            .shadowSmall(shape, colors.shadow)
            .clip(shape)
            .background(colors.surface)
            .border(1.dp, colors.line, shape),
    ) {
        sourceOrder(sources.size, cited).forEachIndexed { index, number ->
            if (index > 0) Spacer(Modifier.fillMaxWidth().height(1.dp).background(colors.line))
            SourceItem(
                number = number,
                source = sources[number - 1],
                uncited = cited.isNotEmpty() && number !in cited,
                open = number in openItems,
                onOpenChange = { onItemChange(number, it) },
                highlighted = highlighted == number,
                requester = requesters[number - 1],
                wide = wide,
            )
        }
    }
}

@Composable
private fun SourceItem(
    number: Int,
    source: Citation,
    uncited: Boolean,
    open: Boolean,
    onOpenChange: (Boolean) -> Unit,
    highlighted: Boolean,
    requester: BringIntoViewRequester,
    wide: Boolean,
) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    val background by animateColorAsState(
        when {
            highlighted -> colors.accentSoft
            pressed -> colors.surfaceHover
            else -> colors.surface
        },
        if (highlighted) snap() else tween(600),
        label = "source highlight",
    )
    val rotation by animateFloatAsState(if (open) 90f else 0f, tween(200, easing = Ease), label = "source chevron")

    Column(Modifier.bringIntoViewRequester(requester).background(background)) {
        Row(
            Modifier
                .fillMaxWidth()
                .pressable(role = Role.Button, label = if (open) "Hide passage" else "Show passage", interactionSource = interactions) { onOpenChange(!open) }
                .padding(horizontal = 14.dp, vertical = 13.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.defaultMinSize(minWidth = 22.dp).height(22.dp).clip(RoundedCornerShape(7.dp))
                    .background(if (uncited) colors.surfaceSunken else colors.accentSoft),
                contentAlignment = Alignment.Center,
            ) {
                BasicText(
                    number.toString(),
                    style = TextStyle(color = if (uncited) colors.muted else colors.accent, fontFamily = Fonts.sans, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, fontFeatureSettings = "tnum"),
                )
            }
            Column(Modifier.weight(1f).alpha(if (uncited) 0.7f else 1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                BasicText(
                    buildAnnotatedString {
                        append(source.label)
                        if (source.remedyName != null && source.sectionTitle.isNotEmpty()) {
                            withStyle(SpanStyle(fontWeight = FontWeight.Normal, color = colors.muted)) { append(" · ${source.sectionTitle}") }
                        }
                    },
                    style = TextStyle(color = colors.ink, fontFamily = Fonts.sans, fontSize = 14.sp, lineHeight = 1.4.em, fontWeight = FontWeight.SemiBold),
                )
                BasicText(
                    buildAnnotatedString {
                        append(source.bookTitle)
                        source.author?.let { author ->
                            withStyle(SpanStyle(fontStyle = FontStyle.Normal, color = colors.faint)) { append(" — $author") }
                        }
                    },
                    style = TextStyle(color = colors.muted, fontFamily = Fonts.serif, fontStyle = FontStyle.Italic, fontSize = 12.5.sp),
                )
            }
            if (uncited) {
                BasicText(
                    "Not cited",
                    style = TextStyle(color = colors.muted, fontFamily = Fonts.sans, fontSize = 11.sp),
                    modifier = Modifier.padding(top = 2.dp).clip(Pill).background(colors.surfaceSunken).padding(horizontal = 7.dp, vertical = 1.dp),
                    softWrap = false,
                )
            }
            Icon(Icons.Chevron, colors.faint, 14.dp, Modifier.padding(top = 2.dp).rotate(rotation))
        }
        if (open) {
            Column(Modifier.padding(start = if (wide) 48.dp else 16.dp, end = 16.dp, bottom = 16.dp)) {
                SelectionContainer {
                    BasicText(
                        source.text,
                        style = TextStyle(color = colors.inkSoft, fontFamily = Fonts.serif, fontSize = 15.sp, lineHeight = 1.65.em),
                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(colors.surfaceSunken)
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                    )
                }
                Spacer(Modifier.height(12.dp))
                BasicText(source.id, style = TextStyle(color = colors.faint, fontFamily = Fonts.mono, fontSize = 10.5.sp))
            }
        }
    }
}

private const val REPORT_EMAIL = "rasagyavatsal@outlook.com"

/** Play requires a way to report AI answers: this drafts an email with the exchange, or shares it without an email app. */
@Composable
private fun ReportButton(question: String, answer: String) {
    val colors = Theme.colors
    val context = LocalContext.current
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Box(
        Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (pressed) colors.surfaceHover else Color.Transparent)
            .pressable(label = "Report answer", interactionSource = interactions) {
                val subject = "Report: HomeoRemedica answer"
                val body = "What is wrong with this answer?\n\n\n" +
                    "---\nQuestion:\n$question\n\nAnswer:\n$answer\n\nApp version ${BuildConfig.VERSION_NAME}"
                val email = Intent(Intent.ACTION_SENDTO, "mailto:".toUri())
                    .putExtra(Intent.EXTRA_EMAIL, arrayOf(REPORT_EMAIL))
                    .putExtra(Intent.EXTRA_SUBJECT, subject)
                    .putExtra(Intent.EXTRA_TEXT, body)
                try {
                    context.startActivity(email)
                } catch (_: ActivityNotFoundException) {
                    val share = Intent(Intent.ACTION_SEND)
                        .setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, subject)
                        .putExtra(Intent.EXTRA_TEXT, "To: $REPORT_EMAIL\n\n$body")
                    context.startActivity(Intent.createChooser(share, "Report answer"))
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Flag, if (pressed) colors.ink else colors.muted, 15.dp, contentDescription = "Report answer")
    }
}

@Composable
private fun CopyButton(text: String) {
    val colors = Theme.colors
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    var copied by remember { mutableStateOf(false) }
    LaunchedEffect(copied) {
        if (copied) {
            delay(1600)
            copied = false
        }
    }
    Box(
        Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(if (pressed) colors.surfaceHover else Color.Transparent)
            .pressable(label = "Copy answer", interactionSource = interactions) {
                scope.launch {
                    clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("HomeoRemedica answer", text)))
                    copied = true
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            if (copied) Icons.Check else Icons.Copy,
            if (pressed) colors.ink else colors.muted,
            15.dp,
            contentDescription = if (copied) "Copied" else "Copy answer",
        )
    }
}

package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.toUpperCase
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.answer.Block
import io.github.rasagyavatsal.homeoremedica.answer.Inline
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Palette
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Renders a parsed answer with the web app's `.answer` styles, or a passage with its `.source-text` ones.

private const val CITATION_PREFIX = "cite-"

/** Describes a citation chip for screen readers, such as "Source 1: Pulsatilla, Kent, Lectures". */
typealias CitationLabel = (Int) -> String

@Composable
fun MarkdownText(
    blocks: List<Block>,
    onCitation: (Int) -> Unit,
    citationLabel: CitationLabel,
    modifier: Modifier = Modifier,
) {
    val colors = Theme.colors
    val body = TextStyle(color = colors.ink, fontFamily = Fonts.serif, fontSize = 17.sp, lineHeight = 1.68.em)
    Column(modifier) {
        Blocks(blocks, body, colors, onCitation, citationLabel, passage = false)
    }
}

/** A passage from the books: links are plain text and headings are small labels. */
@Composable
fun PassageText(blocks: List<Block>, modifier: Modifier = Modifier) {
    val colors = Theme.colors
    val body = TextStyle(color = colors.ink, fontFamily = Fonts.serif, fontSize = 15.sp, lineHeight = 1.65.em)
    Column(modifier) {
        Blocks(blocks, body, colors, onCitation = {}, label = { "" }, passage = true)
    }
}

@Composable
private fun Blocks(
    blocks: List<Block>,
    style: TextStyle,
    colors: Palette,
    onCitation: (Int) -> Unit,
    label: CitationLabel,
    passage: Boolean,
) {
    blocks.forEachIndexed { index, block ->
        if (index > 0) {
            val previous = blocks[index - 1]
            Spacer(
                Modifier.height(
                    when {
                        block is Block.Heading -> if (passage) 16.dp else 28.dp
                        previous is Block.Heading -> 10.dp
                        block is Block.Rule || previous is Block.Rule -> 26.dp
                        block is Block.Quote || previous is Block.Quote -> 20.dp
                        else -> 16.dp
                    },
                ),
            )
        }
        BlockView(block, style, colors, onCitation, label, passage)
    }
}

@Composable
private fun BlockView(
    block: Block,
    style: TextStyle,
    colors: Palette,
    onCitation: (Int) -> Unit,
    label: CitationLabel,
    passage: Boolean,
) {
    when (block) {
        is Block.Paragraph -> InlineText(block.inlines, style, colors, onCitation, label, links = !passage)
        is Block.Heading -> InlineText(
            block.inlines,
            if (passage) {
                style.copy(
                    color = colors.muted,
                    fontFamily = Fonts.sans,
                    fontSize = 12.sp,
                    lineHeight = 1.4.em,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 0.06.em,
                )
            } else {
                style.copy(fontSize = if (block.level == 1) 22.sp else 19.sp, lineHeight = 1.4.em, fontWeight = FontWeight.SemiBold)
            },
            colors,
            onCitation,
            label,
            links = !passage,
            uppercase = passage,
        )
        is Block.ListBlock -> Column {
            block.items.forEachIndexed { index, item ->
                if (index > 0) Spacer(Modifier.height(6.dp))
                Row {
                    BasicText(
                        if (block.ordered) "${block.start + index}." else "•",
                        style = style.copy(color = colors.faint, textAlign = TextAlign.End),
                        modifier = Modifier.width(20.dp).alignByBaseline(),
                    )
                    Column(Modifier.padding(start = 8.dp).alignByBaseline()) {
                        Blocks(item, style, colors, onCitation, label, passage)
                    }
                }
            }
        }
        is Block.Quote -> {
            val line = colors.lineStrong
            Column(
                Modifier
                    .drawBehind { drawRect(line, size = size.copy(width = 3.dp.toPx())) }
                    .padding(start = 18.dp, top = 2.dp, bottom = 2.dp),
            ) {
                Blocks(block.blocks, style.copy(color = colors.inkSoft, fontStyle = FontStyle.Italic), colors, onCitation, label, passage)
            }
        }
        is Block.CodeBlock -> Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(10.dp))
                .background(colors.surfaceSunken)
                .border(1.dp, colors.line, RoundedCornerShape(10.dp))
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 16.dp, vertical = 14.dp),
        ) {
            BasicText(block.code, style = style.copy(fontFamily = Fonts.mono, fontSize = 13.6.sp, lineHeight = 1.5.em), softWrap = false)
        }
        Block.Rule -> {
            val line = colors.line
            Spacer(Modifier.fillMaxWidth().height(1.dp).drawBehind { drawLine(line, Offset.Zero, Offset(size.width, 0f), 1.dp.toPx()) })
        }
    }
}

@Composable
private fun InlineText(
    inlines: List<Inline>,
    style: TextStyle,
    colors: Palette,
    onCitation: (Int) -> Unit,
    label: CitationLabel,
    links: Boolean,
    uppercase: Boolean = false,
) {
    val text = remember(inlines, colors, links, uppercase) {
        annotate(inlines, colors, links).let { if (uppercase) it.toUpperCase() else it }
    }
    val numbers = remember(inlines) { citations(inlines) }
    val chips = numbers.associate { number ->
        val digits = number.toString().length
        "$CITATION_PREFIX$number" to InlineTextContent(
            // A 19px chip wide enough for its digits, with the web app's 2px and 1px side margins.
            Placeholder(width = (maxOf(19f, 10f + digits * 6.5f) + 3f).sp, height = 19.sp, PlaceholderVerticalAlign.TextCenter),
        ) { CitationChip(number, onCitation, label(number)) }
    }
    BasicText(text, style = style, inlineContent = chips)
}

@Composable
private fun CitationChip(number: Int, onCitation: (Int) -> Unit, description: String) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Box(
        Modifier
            .padding(start = 2.dp, end = 1.dp)
            .fillMaxSize()
            .clip(RoundedCornerShape(6.dp))
            .background(if (pressed) colors.accent else colors.accentSoft)
            .pressable(interactionSource = interactions) { onCitation(number) }
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        BasicText(
            number.toString(),
            style = TextStyle(
                color = if (pressed) colors.accentInk else colors.accent,
                fontFamily = Fonts.sans,
                fontSize = 11.sp,
                lineHeight = 11.sp,
                fontWeight = FontWeight.SemiBold,
                fontFeatureSettings = "tnum",
            ),
        )
    }
}

private fun citations(inlines: List<Inline>): Set<Int> = buildSet {
    for (inline in inlines) {
        when (inline) {
            is Inline.Citation -> add(inline.number)
            is Inline.Emphasis -> addAll(citations(inline.children))
            is Inline.Strong -> addAll(citations(inline.children))
            is Inline.Link -> addAll(citations(inline.children))
            else -> Unit
        }
    }
}

private fun annotate(inlines: List<Inline>, colors: Palette, links: Boolean): AnnotatedString = buildAnnotatedString {
    fun append(inlines: List<Inline>) {
        for (inline in inlines) {
            when (inline) {
                is Inline.Text -> append(inline.text)
                is Inline.Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(inline.children) }
                is Inline.Strong -> withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(inline.children) }
                is Inline.Code -> withStyle(SpanStyle(fontFamily = Fonts.mono, fontSize = 0.8.em, background = colors.surfaceSunken)) {
                    append(inline.code)
                }
                is Inline.Link -> if (!links) append(inline.children) else withLink(
                    LinkAnnotation.Url(
                        inline.destination,
                        TextLinkStyles(SpanStyle(color = colors.accent, textDecoration = TextDecoration.Underline)),
                    ),
                ) { append(inline.children) }
                is Inline.Citation -> appendInlineContent("$CITATION_PREFIX${inline.number}", "[${inline.number}]")
                Inline.LineBreak -> append("\n")
            }
        }
    }
    append(inlines)
}

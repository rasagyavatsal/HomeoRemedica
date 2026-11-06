package io.github.rasagyavatsal.homeoremedica.ui

import kotlinx.coroutines.flow.drop
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding

import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.answer.label
import io.github.rasagyavatsal.homeoremedica.answer.parsePassage
import io.github.rasagyavatsal.homeoremedica.api.Citation
import io.github.rasagyavatsal.homeoremedica.api.Rating
import io.github.rasagyavatsal.homeoremedica.ui.theme.Ease
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

/**
 * The passage behind one reference in an answer, beside the chat as the web app's sources panel
 * (src/web/SourcesPanel.tsx); [number] is its place in the answer, from 1. Phones show [SourceSheet] instead.
 */
@Composable
fun SourcesPanel(
    source: Citation,
    number: Int,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
    rating: Rating? = null,
    /** Rates the passage; it cannot be rated without this. */
    onRate: ((Rating?) -> Unit)? = null,
) {
    val colors = Theme.colors
    Column(modifier.background(colors.surface).statusBarsPadding()) {
        SourceHeader(source, number, rating, onRate, Modifier.rise(source.id, 200).padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp)) {
            CloseButton(onClose)
        }
        Spacer(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
        Passage(
            source,
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .rise(source.id, 200)
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        )
    }
}

/**
 * An answer's passages in a sheet over the chat, open at the one numbered [number]; swiping sideways moves
 * between the [numbers] the answer lists, and [onSelect] follows. Sources are numbered from 1.
 */
@Composable
fun SourceSheet(
    sources: List<Citation>,
    numbers: List<Int>,
    number: Int,
    onSelect: (Int) -> Unit,
    onClose: () -> Unit,
    rating: (Int) -> Rating?,
    /** Rates a passage; they cannot be rated without this. */
    onRate: ((Int, Rating?) -> Unit)?,
) {
    val colors = Theme.colors
    // A number the answer does not list, from a chip in its text, pages through all of them instead.
    val pages = remember(numbers, number) { if (number in numbers) numbers else sources.indices.map { it + 1 } }
    val pager = rememberPagerState(pages.indexOf(number).coerceAtLeast(0)) { pages.size }
    val select by rememberUpdatedState(onSelect)
    val haptics = LocalHapticFeedback.current
    LaunchedEffect(pager, pages) {
        snapshotFlow { pager.settledPage }.collect { page -> pages.getOrNull(page)?.let(select) }
    }
    // A tick as each passage settles under the finger.
    LaunchedEffect(pager) {
        snapshotFlow { pager.currentPage }.drop(1).collect { haptics.performHapticFeedback(HapticFeedbackType.SegmentFrequentTick) }
    }
    BottomSheet("Source", onClose, closeLabel = "Close source", expandable = true) {
        if (pages.size > 1) Dots(pages.size, pager.currentPage)
        HorizontalPager(pager, Modifier.weight(1f).fillMaxWidth(), key = { pages[it] }) { page ->
            val shown = pages[page]
            val source = sources[shown - 1]
            Column(Modifier.fillMaxSize()) {
                SourceHeader(
                    source,
                    shown,
                    rating(shown),
                    onRate?.let { rate -> { choice: Rating? -> rate(shown, choice) } },
                    Modifier.padding(start = 20.dp, end = 12.dp, top = 4.dp, bottom = 12.dp),
                )
                Spacer(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
                Passage(
                    source,
                    Modifier
                        .weight(1f)
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                        .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 24.dp),
                )
            }
        }
    }
}

/** Which of [count] pages shows, as a row of dots. */
@Composable
private fun Dots(count: Int, current: Int) {
    val colors = Theme.colors
    Row(
        Modifier.fillMaxWidth().padding(bottom = 8.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        repeat(count) { index ->
            val chosen = index == current
            val width by animateDpAsState(if (chosen) 16.dp else 6.dp, tween(200, easing = Ease), label = "dot")
            val color by animateColorAsState(if (chosen) colors.accent else colors.borderStrong, tween(200, easing = Ease), label = "dot colour")
            Box(Modifier.size(width = width, height = 6.dp).background(color, Pill))
        }
    }
}

/** The passage's number, remedy or section, and book, then its rating and [trailing]. */
@Composable
private fun SourceHeader(
    source: Citation,
    number: Int,
    rating: Rating?,
    onRate: ((Rating?) -> Unit)?,
    modifier: Modifier,
    trailing: @Composable () -> Unit = {},
) {
    val colors = Theme.colors
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Box(
            Modifier.padding(top = 4.dp).size(28.dp).clip(RoundedCornerShape(6.dp)).background(colors.accent),
            contentAlignment = Alignment.Center,
        ) {
            BasicText(
                number.toString(),
                style = TextStyle(color = colors.textOnAccent, fontFamily = Fonts.sans, fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
            )
        }
        Column(Modifier.weight(1f).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            BasicText(
                source.label,
                style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 15.sp, lineHeight = 1.25.em, fontWeight = FontWeight.SemiBold),
                modifier = Modifier.semantics { heading() },
            )
            BasicText(
                if (source.remedyName != null && source.sectionTitle.isNotEmpty()) "${source.bookTitle} · ${source.sectionTitle}" else source.bookTitle,
                style = TextStyle(color = colors.textMuted, fontFamily = Fonts.sans, fontSize = 12.sp, lineHeight = 1.4.em),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (onRate != null) RatingButtons(rating, onRate, "Rate this passage", "Relevant", "Not relevant")
            trailing()
        }
    }
}

@Composable
private fun Passage(source: Citation, modifier: Modifier) {
    val passage = remember(source.text) { parsePassage(source.text) }
    Box(modifier) {
        SelectionContainer { PassageText(passage) }
    }
}

@Composable
private fun CloseButton(onClose: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Box(
        Modifier
            .size(36.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (pressed) colors.surfaceHover else Color.Transparent)
            .pressable(label = "Close source", interactionSource = interactions, onClick = onClose),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Close, if (pressed) colors.text else colors.textMuted, 18.dp, contentDescription = "Close source")
    }
}

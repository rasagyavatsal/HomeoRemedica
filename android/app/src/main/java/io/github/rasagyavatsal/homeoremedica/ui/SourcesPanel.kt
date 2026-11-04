package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
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
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Ports the web app's sources panel (src/web/SourcesPanel.tsx).

/** The passage behind one reference in an answer; [number] is its place in the answer, from 1. */
@Composable
fun SourcesPanel(source: Citation, number: Int, onClose: () -> Unit, modifier: Modifier = Modifier) {
    val colors = Theme.colors
    val passage = remember(source.text) { parsePassage(source.text) }
    Column(modifier.background(colors.surface).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().rise(source.id, 200).padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.padding(top = 4.dp).size(28.dp).clip(RoundedCornerShape(6.dp)).background(colors.accent),
                contentAlignment = Alignment.Center,
            ) {
                BasicText(
                    number.toString(),
                    style = TextStyle(color = colors.accentInk, fontFamily = Fonts.sans, fontSize = 12.sp, fontWeight = FontWeight.SemiBold),
                )
            }
            Column(Modifier.weight(1f).padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                BasicText(
                    source.label,
                    style = TextStyle(color = colors.ink, fontFamily = Fonts.serif, fontSize = 16.sp, lineHeight = 1.25.em, fontWeight = FontWeight.SemiBold),
                    modifier = Modifier.semantics { heading() },
                )
                BasicText(
                    if (source.remedyName != null && source.sectionTitle.isNotEmpty()) "${source.bookTitle} · ${source.sectionTitle}" else source.bookTitle,
                    style = TextStyle(color = colors.muted, fontFamily = Fonts.sans, fontSize = 12.sp, lineHeight = 1.4.em),
                )
            }
            CloseButton(onClose)
        }
        Spacer(Modifier.fillMaxWidth().height(1.dp).background(colors.line))
        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .navigationBarsPadding()
                .rise(source.id, 200)
                .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 24.dp),
        ) {
            SelectionContainer { PassageText(passage) }
        }
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
        Icon(Icons.Close, if (pressed) colors.ink else colors.muted, 18.dp, contentDescription = "Close source")
    }
}

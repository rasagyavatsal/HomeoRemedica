package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Ports the web app's case review (src/web/CaseReview.tsx).

// The server's limits on a case's symptoms and diseases.
private const val MAX_SYMPTOMS = 15
private const val MAX_SYMPTOM_CHARS = 200
private const val MAX_DISEASES = 15
private const val MAX_DISEASE_CHARS = 200

private data class Term(val key: Int, val text: String)

/** A list's rows, with a key each so removing one keeps the others' text and focus. */
@Stable
private class TermRows(read: List<String>) {
    private var nextKey = 0
    val rows = mutableStateListOf<Term>().apply { read.forEach { add(Term(nextKey++, it)) } }

    /** The row just added, which takes the focus; the ones read from the case do not. */
    var added by mutableStateOf<Int?>(null)

    fun add() {
        val key = nextKey++
        rows += Term(key, "")
        added = key
    }

    fun remove(key: Int) {
        rows.removeAll { it.key == key }
    }

    fun change(key: Int, text: String) {
        val index = rows.indexOfFirst { it.key == key }
        if (index >= 0) rows[index] = Term(key, text)
    }

    /** The rows as the user left them, without the blank ones. */
    fun texts() = rows.map { it.text.trim() }.filter { it.isNotEmpty() }

    companion object {
        /** Keeps the rows while the review is scrolled out of view or the screen turns. */
        val Saver = listSaver<TermRows, String>(save = { terms -> terms.rows.map { it.text } }, restore = { TermRows(it) })
    }
}

/**
 * The symptoms and diseases a case will be searched by, for the user to correct before it is answered.
 * [diseases] is null when they could not be read, and they are then not reviewed. [onConfirm] receives
 * both as the user left them.
 */
@Composable
fun CaseReview(
    symptoms: List<String>,
    diseases: List<String>?,
    onConfirm: (symptoms: List<String>, diseases: List<String>?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val symptomRows = rememberSaveable(saver = TermRows.Saver) { TermRows(symptoms) }
    val diseaseRows = rememberSaveable(saver = TermRows.Saver) { TermRows(diseases.orEmpty()) }
    val keyboard = LocalSoftwareKeyboardController.current
    val haptics = LocalHapticFeedback.current
    val proceed = @Composable {
        Button("Continue", ButtonStyle.Primary, {
            keyboard?.hide()
            haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
            onConfirm(symptomRows.texts(), diseases?.let { diseaseRows.texts() })
        })
    }
    Column(modifier.semantics { contentDescription = "Case" }, verticalArrangement = Arrangement.spacedBy(24.dp)) {
        TermList("Symptoms", "symptom", symptomRows, MAX_SYMPTOMS, MAX_SYMPTOM_CHARS) { if (diseases == null) proceed() }
        if (diseases != null) TermList("Diseases", "disease", diseaseRows, MAX_DISEASES, MAX_DISEASE_CHARS) { proceed() }
    }
}

/**
 * One card holding a list of the case's symptoms or diseases and its actions. [one] is what a row holds, as
 * its controls name it; [actions] sit beside the one that adds a row.
 */
@Composable
private fun TermList(label: String, one: String, list: TermRows, max: Int, maxChars: Int, actions: @Composable () -> Unit) {
    val colors = Theme.colors
    val shape = RoundedCornerShape(16.dp)
    val name = one.replaceFirstChar(Char::uppercase)
    Column {
        BasicText(
            label.uppercase(),
            style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.06.em),
            modifier = Modifier.padding(bottom = 8.dp),
        )
        Column(Modifier.fillMaxWidth().clip(shape).background(colors.surface).border(1.dp, colors.border, shape)) {
            list.rows.forEachIndexed { index, row ->
                key(row.key) {
                    TermRow(
                        row.text,
                        label = "$name ${index + 1}",
                        removeLabel = "Remove $one ${index + 1}",
                        focus = list.added == row.key,
                        onFocused = { list.added = null },
                        onChange = { list.change(row.key, it.take(maxChars)) },
                        onRemove = { list.remove(row.key) },
                    )
                }
            }
            Row(
                Modifier.fillMaxWidth().padding(8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Button("Add $one", ButtonStyle.Quiet, list::add, enabled = list.rows.size < max, icon = Icons.Plus)
                actions()
            }
        }
    }
}

/** One symptom or disease, edited in place; the row being edited is marked along its leading edge. */
@Composable
private fun TermRow(
    text: String,
    label: String,
    removeLabel: String,
    focus: Boolean,
    onFocused: () -> Unit,
    onChange: (String) -> Unit,
    onRemove: () -> Unit,
) {
    val colors = Theme.colors
    val compact = LocalCompact.current
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val requester = remember { FocusRequester() }
    if (focus) {
        LaunchedEffect(Unit) {
            requester.requestFocus()
            onFocused()
        }
    }
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (focused) colors.surfaceHover else colors.surface)
            .drawBehind {
                drawLine(colors.border, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx())
                if (focused) drawRect(colors.accent, size = Size(2.dp.toPx(), size.height))
            }
            .padding(end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicTextField(
            value = text,
            onValueChange = onChange,
            singleLine = true,
            textStyle = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 15.sp),
            cursorBrush = SolidColor(colors.accent),
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Done),
            interactionSource = interactions,
            modifier = Modifier
                .weight(1f)
                .focusRequester(requester)
                .semantics { contentDescription = label },
            decorationBox = { field ->
                Box(
                    Modifier.heightIn(min = if (compact) 48.dp else 44.dp).padding(start = 16.dp, end = 8.dp),
                    contentAlignment = Alignment.CenterStart,
                ) { field() }
            },
        )
        IconButton(Icons.Close, removeLabel, onRemove, size = if (compact) 44.dp else 28.dp, iconSize = 16.dp, color = colors.textSubtle)
    }
}

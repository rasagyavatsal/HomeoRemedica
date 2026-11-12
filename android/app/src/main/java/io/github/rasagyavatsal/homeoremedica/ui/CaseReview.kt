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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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

    /** What a phone's reader is typing into the row that adds one. */
    var draft by mutableStateOf("")

    /** Makes a row of the [draft], if there is one. */
    fun commit() {
        val text = draft.trim()
        if (text.isNotEmpty()) rows += Term(nextKey++, text)
        draft = ""
    }

    /** The rows as the user left them, without the blank ones, then anything still being added. */
    fun texts() = (rows.map { it.text } + draft).map { it.trim() }.filter { it.isNotEmpty() }

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
    val confirm = {
        keyboard?.hide()
        haptics.performHapticFeedback(HapticFeedbackType.ContextClick)
        onConfirm(symptomRows.texts(), diseases?.let { diseaseRows.texts() })
    }
    if (LocalCompact.current) {
        // A sheet over the chat, open from the start; closing it leaves a way back in the conversation.
        var open by rememberSaveable { mutableStateOf(true) }
        Box(modifier) { Button("Review case", ButtonStyle.Outline, { open = true }) }
        if (open) {
            BottomSheet("Case", { open = false }) {
                Column(
                    Modifier
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState())
                        .semantics { contentDescription = "Case" }
                        .padding(bottom = 8.dp),
                    verticalArrangement = Arrangement.spacedBy(20.dp),
                ) {
                    SheetTerms("Symptoms", "symptom", symptomRows, MAX_SYMPTOMS, MAX_SYMPTOM_CHARS)
                    if (diseases != null) SheetTerms("Diseases", "disease", diseaseRows, MAX_DISEASES, MAX_DISEASE_CHARS)
                }
                Button(
                    "Continue",
                    ButtonStyle.Primary,
                    confirm,
                    Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 8.dp, bottom = 16.dp),
                    minHeight = 52.dp,
                )
            }
        }
        return
    }
    val proceed = @Composable { Button("Continue", ButtonStyle.Primary, confirm) }
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

/** A phone's list of the case's symptoms or diseases: plain rows, then one that adds another as it is typed. */
@Composable
private fun SheetTerms(label: String, one: String, list: TermRows, max: Int, maxChars: Int) {
    val colors = Theme.colors
    val name = one.replaceFirstChar(Char::uppercase)
    Column {
        BasicText(
            label,
            style = TextStyle(color = colors.textMuted, fontFamily = Fonts.sans, fontSize = 13.sp, fontWeight = FontWeight.Medium),
            modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 4.dp),
        )
        list.rows.forEachIndexed { index, row ->
            key(row.key) {
                SheetField(
                    row.text,
                    label = "$name ${index + 1}",
                    onChange = { list.change(row.key, it.take(maxChars)) },
                    trailing = { IconButton(Icons.Close, "Remove $one ${index + 1}", { list.remove(row.key) }, size = 48.dp, iconSize = 18.dp, color = colors.textSubtle, raised = true) },
                )
            }
        }
        if (list.rows.size < max) {
            SheetField(
                list.draft,
                label = "Add $one",
                placeholder = "Add $one",
                onChange = { list.draft = it.take(maxChars) },
                onDone = list::commit,
                leading = { Icon(Icons.Plus, colors.textSubtle, 18.dp) },
            )
        }
    }
}

/** One row of a phone's case review: a field across the sheet, with a rule under it. */
@Composable
private fun SheetField(
    text: String,
    label: String,
    onChange: (String) -> Unit,
    placeholder: String? = null,
    /** What the keyboard's action does; without it, the action closes the keyboard. */
    onDone: (() -> Unit)? = null,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    val colors = Theme.colors
    val style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 16.sp)
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .drawBehind { drawLine(colors.border, Offset(24.dp.toPx(), size.height), Offset(size.width, size.height), 1.dp.toPx()) }
            .padding(start = 24.dp, end = if (trailing != null) 12.dp else 24.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        leading?.invoke()
        BasicTextField(
            value = text,
            onValueChange = onChange,
            singleLine = true,
            textStyle = style,
            cursorBrush = SolidColor(colors.accent),
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Sentences,
                imeAction = if (onDone != null) ImeAction.Next else ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onNext = { onDone?.invoke() }),
            modifier = Modifier.weight(1f).semantics { contentDescription = label },
            decorationBox = { field ->
                Box(Modifier.heightIn(min = 52.dp), contentAlignment = Alignment.CenterStart) {
                    if (text.isEmpty() && placeholder != null) BasicText(placeholder, style = style.copy(color = colors.textSubtle))
                    field()
                }
            },
        )
        trailing?.invoke()
    }
}

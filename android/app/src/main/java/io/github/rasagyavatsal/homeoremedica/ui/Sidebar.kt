package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.chat.ChatSummary
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme
import java.time.LocalDate
import java.time.ZoneId

// Ports the web app's chat list (src/web/Sidebar.tsx).

/** The web app's `--layout-sidebar-width`. */
val SidebarWidth = 272.dp

/** The list offers a search once it has this many chats. */
private const val SEARCH_FROM = 6

/** Saved chats, the web app's sidebar: a new chat, a search, the chats by age, and [footer]. */
@Composable
fun Sidebar(
    /** Saved chats, newest first; null while they load. */
    chats: List<ChatSummary>?,
    activeId: String,
    onNew: () -> Unit,
    onOpen: (String) -> Unit,
    onDelete: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** Closes the list where it is a drawer over the chat. */
    onClose: (() -> Unit)? = null,
    footer: (@Composable () -> Unit)? = null,
) {
    val colors = Theme.colors
    val compact = LocalCompact.current
    var query by rememberSaveable { mutableStateOf("") }
    var confirming by rememberSaveable { mutableStateOf<String?>(null) }
    val search = query.trim()
    val filtered = chats.orEmpty().filter { it.title.contains(search, ignoreCase = true) }

    Column(
        modifier
            .background(colors.surface)
            // The drawer's shadow sets it off on phones.
            .drawBehind { if (!compact) drawLine(colors.border, Offset(size.width, 0f), Offset(size.width, size.height), 1.dp.toPx()) }
            .statusBarsPadding()
            .navigationBarsPadding()
            .semantics { contentDescription = "Chats" },
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 44.dp).padding(start = 16.dp, end = if (onClose != null) 4.dp else 8.dp, top = 8.dp, bottom = 8.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Brand()
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
                // Phones choose the theme in the account sheet.
                if (!compact) ThemeToggle()
                if (onClose != null) IconButton(Icons.Close, "Close chats", onClose, size = 48.dp, iconSize = 22.dp, color = colors.text)
            }
        }

        Column(
            Modifier.padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (compact) Button("New chat", ButtonStyle.Primary, onNew, Modifier.fillMaxWidth(), icon = Icons.Plus, minHeight = 52.dp)
            else Button("New chat", ButtonStyle.Outline, onNew, Modifier.fillMaxWidth(), icon = Icons.Plus, start = true)
            if (chats != null && chats.size >= SEARCH_FROM) SearchField(query) { query = it }
        }

        val empty = when {
            chats == null -> "Loading chats…"
            chats.isEmpty() -> "Your chats will appear here."
            filtered.isEmpty() -> "No chats match “$search”."
            else -> null
        }
        if (empty != null) {
            BasicText(
                empty,
                style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = if (compact) 14.sp else 13.sp),
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 20.dp, vertical = 12.dp)
                    .semantics { liveRegion = LiveRegionMode.Polite },
            )
        } else {
            LazyColumn(Modifier.weight(1f), contentPadding = PaddingValues(start = 8.dp, end = 8.dp, bottom = 16.dp)) {
                groupByAge(filtered).forEachIndexed { index, group ->
                    item(key = group.label) {
                        BasicText(
                            if (compact) group.label else group.label.uppercase(),
                            style = TextStyle(
                                color = colors.textSubtle,
                                fontFamily = Fonts.sans,
                                fontSize = if (compact) 13.sp else 12.sp,
                                fontWeight = if (compact) FontWeight.Medium else FontWeight.SemiBold,
                                letterSpacing = if (compact) 0.em else 0.06.em,
                            ),
                            modifier = Modifier
                                .padding(start = 12.dp, end = 12.dp, top = if (index > 0) 24.dp else 8.dp, bottom = 4.dp)
                                .semantics { heading() },
                        )
                    }
                    items(group.chats, key = { it.id }) { chat ->
                        if (compact) {
                            ChatRow(chat, chat.id == activeId, onOpen = { onOpen(chat.id) }, onDelete = { onDelete(chat.id) })
                        } else if (confirming == chat.id) {
                            ConfirmDelete(
                                onDelete = {
                                    confirming = null
                                    onDelete(chat.id)
                                },
                                onCancel = { confirming = null },
                            )
                        } else {
                            ChatItem(chat, chat.id == activeId, onOpen = { onOpen(chat.id) }, onDelete = { confirming = chat.id })
                        }
                    }
                }
            }
        }

        if (footer != null) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .drawBehind { if (!compact) drawLine(colors.border, Offset.Zero, Offset(size.width, 0f), 1.dp.toPx()) }
                    .padding(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp),
            ) {
                footer()
            }
        }
    }
}

@Composable
private fun SearchField(query: String, onChange: (String) -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val compact = LocalCompact.current
    val shape = if (compact) Pill else RoundedCornerShape(10.dp)
    Row(
        Modifier
            .fillMaxWidth()
            .height(if (compact) 48.dp else 36.dp)
            .background(if (compact) colors.surfaceSelected else colors.surfaceRaised, shape)
            .border(1.dp, if (compact) Color.Transparent else if (focused) colors.accent else colors.border, shape)
            .padding(horizontal = if (compact) 16.dp else 12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Search, colors.textSubtle, 16.dp)
        BasicTextField(
            value = query,
            onValueChange = onChange,
            singleLine = true,
            modifier = Modifier.weight(1f).semantics { contentDescription = "Search chats" },
            textStyle = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 13.sp),
            cursorBrush = SolidColor(colors.accent),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            interactionSource = interactions,
            decorationBox = { field ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (query.isEmpty()) {
                        BasicText("Search chats", style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 13.sp))
                    }
                    field()
                }
            },
        )
    }
}

@Composable
private fun ChatItem(chat: ChatSummary, active: Boolean, onOpen: () -> Unit, onDelete: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(
                when {
                    active -> colors.surfaceSelected
                    pressed -> colors.surfaceHover
                    else -> Color.Transparent
                },
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicText(
            chat.title,
            style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 13.sp, lineHeight = 18.sp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .pressable(label = "Open chat", interactionSource = interactions, onClick = onOpen)
                .semantics { selected = active }
                .padding(horizontal = 12.dp, vertical = 9.dp),
        )
        IconButton(
            Icons.Trash,
            "Delete “${chat.title}”",
            onDelete,
            Modifier.padding(end = 4.dp),
            size = 28.dp,
            iconSize = 16.dp,
            pressedColor = colors.danger,
        )
    }
}

/**
 * A chat on phones: tapping opens it, and a long press offers to delete it, which the notice that follows
 * can undo. Swiping is left to the drawer, which a swipe closes.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ChatRow(chat: ChatSummary, active: Boolean, onOpen: () -> Unit, onDelete: () -> Unit) {
    val colors = Theme.colors
    val haptics = LocalHapticFeedback.current
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    var actions by rememberSaveable { mutableStateOf(false) }
    BasicText(
        chat.title,
        style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 16.sp, lineHeight = 22.sp),
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier
            .fillMaxWidth()
            .clip(Pill)
            .background(
                when {
                    active -> colors.surfaceSelected
                    pressed || actions -> colors.surfaceHover
                    else -> Color.Transparent
                },
            )
            .combinedClickable(
                interactionSource = interactions,
                indication = null,
                onClickLabel = "Open chat",
                onLongClickLabel = "Show actions",
                onLongClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.LongPress)
                    actions = true
                },
                onClick = onOpen,
            )
            .semantics {
                selected = active
                customActions = listOf(CustomAccessibilityAction("Delete") { onDelete(); true })
            }
            .heightIn(min = 52.dp)
            .wrapContentHeight(Alignment.CenterVertically)
            .padding(horizontal = 18.dp),
    )
    if (actions) {
        BottomSheet("Chat actions", { actions = false }, title = chat.title) {
            SheetItem(Icons.Trash, "Delete chat", danger = true) {
                dismiss()
                onDelete()
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

/** Takes a chat row's place, at the same height, until the reader confirms or cancels. */
@Composable
private fun ConfirmDelete(onDelete: () -> Unit, onCancel: () -> Unit) {
    val colors = Theme.colors
    Row(
        Modifier
            .fillMaxWidth()
            .heightIn(min = 36.dp)
            .background(colors.dangerSoft, RoundedCornerShape(10.dp))
            .padding(start = 12.dp, end = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        BasicText(
            "Delete this chat?",
            style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 13.sp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Button("Delete", ButtonStyle.Danger, onDelete, small = true, minHeight = 24.dp)
        Button("Cancel", ButtonStyle.Quiet, onCancel, small = true, minHeight = 24.dp)
    }
}

/** A run of chats of about the same age, under its label. */
data class ChatGroup(val label: String, val chats: List<ChatSummary>)

/** Split chats, newest first, into Today, Yesterday, Previous 7 days and Older. */
fun groupByAge(chats: List<ChatSummary>, today: LocalDate = LocalDate.now(), zone: ZoneId = ZoneId.systemDefault()): List<ChatGroup> {
    fun start(daysAgo: Long) = today.minusDays(daysAgo).atStartOfDay(zone).toInstant().toEpochMilli()
    val bounds = listOf("Today" to start(0), "Yesterday" to start(1), "Previous 7 days" to start(7))
    val groups = mutableListOf<ChatGroup>()
    for (chat in chats) {
        val label = bounds.firstOrNull { (_, from) -> chat.updatedAt >= from }?.first ?: "Older"
        val last = groups.lastOrNull()
        if (last?.label == label) groups[groups.lastIndex] = last.copy(chats = last.chats + chat)
        else groups += ChatGroup(label, listOf(chat))
    }
    return groups
}

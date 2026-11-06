package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// The web app's form controls (`.field`, `.form-error`, `.text-button` and `.dialog-divider` in src/web/styles.css).

/** A labelled one-line field; [password] hides what is typed. */
@Composable
fun TextField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    contentType: ContentType,
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    imeAction: ImeAction = ImeAction.Next,
    onAction: () -> Unit = {},
) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val focused by interactions.collectIsFocusedAsState()
    val shape = RoundedCornerShape(10.dp)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        BasicText(label, style = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 13.sp, fontWeight = FontWeight.Medium))
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            singleLine = true,
            textStyle = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 15.sp),
            cursorBrush = SolidColor(colors.accent),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction, autoCorrectEnabled = false),
            keyboardActions = KeyboardActions(onAny = { onAction() }),
            interactionSource = interactions,
            modifier = Modifier
                .fillMaxWidth()
                .semantics {
                    this.contentType = contentType
                    contentDescription = label
                },
            decorationBox = { field ->
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(if (LocalCompact.current) 48.dp else 44.dp)
                        .background(colors.surface, shape)
                        .border(1.dp, if (focused) colors.accent else colors.borderStrong, shape)
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.CenterStart,
                ) { field() }
            },
        )
    }
}

/** A form's error, or its success when [success] is set. */
@Composable
fun FormMessage(text: String, success: Boolean = false) {
    val colors = Theme.colors
    BasicText(
        text,
        style = TextStyle(
            color = if (success) colors.accentText else colors.danger,
            fontFamily = Fonts.sans,
            fontSize = 13.sp,
            lineHeight = 18.sp,
        ),
        modifier = Modifier
            .fillMaxWidth()
            .background(if (success) colors.accentSoft else colors.dangerSoft, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .semantics { liveRegion = if (success) LiveRegionMode.Polite else LiveRegionMode.Assertive },
    )
}

/** A link-like button in the accent colour. */
@Composable
fun TextButton(text: String, onClick: () -> Unit) {
    val colors = Theme.colors
    val interactions = remember { MutableInteractionSource() }
    val pressed by interactions.pressed()
    BasicText(
        text,
        style = TextStyle(
            color = colors.accentText,
            fontFamily = Fonts.sans,
            fontSize = 13.sp,
            fontWeight = FontWeight.Medium,
            textDecoration = if (pressed) TextDecoration.Underline else null,
        ),
        modifier = Modifier
            .pressable(label = text, interactionSource = interactions, onClick = onClick)
            .heightIn(min = if (LocalCompact.current) 44.dp else 0.dp)
            .wrapContentHeight(Alignment.CenterVertically)
            .padding(vertical = 4.dp),
    )
}

/** A rule either side of [text], as between Google and email sign-in. */
@Composable
fun Divider(text: String) {
    val colors = Theme.colors
    val rule = Modifier.height(1.dp).drawBehind { drawLine(colors.border, Offset(0f, 0f), Offset(size.width, 0f), 1.dp.toPx()) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(rule.weight(1f))
        BasicText(text, style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 12.sp))
        Box(rule.weight(1f))
    }
}

package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Ports the web app's practitioner notice (src/web/PractitionerNotice.tsx).

/** Who the app is for, shown until the device has acknowledged it; any way of closing it acknowledges it. */
@Composable
fun PractitionerNotice(onAcknowledge: () -> Unit) {
    val colors = Theme.colors
    val openLegal = LocalOpenLegal.current
    val text = dialogText()
    val link = TextLinkStyles(SpanStyle(color = colors.accentText, textDecoration = TextDecoration.Underline))
    Dialog("For homeopathy practitioners", onAcknowledge) {
        BasicText(
            "HomeoRemedica is a reference tool for qualified homeopathy doctors. It is not intended for patients or self-treatment.",
            style = text,
        )
        BasicText(
            "Do not enter patients’ personal details, such as names, contact details, ID numbers or anything else that " +
                "identifies them. Describe symptoms and cases in general terms.",
            style = text,
        )
        BasicText(
            buildAnnotatedString {
                append("By using HomeoRemedica, you agree to the ")
                for ((index, page) in listOf(LegalPageName.Terms, LegalPageName.Privacy).withIndex()) {
                    if (index > 0) append(" and ")
                    withLink(LinkAnnotation.Clickable(page.name, link) { openLegal(page) }) { append(page.title) }
                }
                append(".")
            },
            style = text,
        )
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            Button("I understand", ButtonStyle.Primary, onAcknowledge)
        }
    }
}

package io.github.rasagyavatsal.homeoremedica.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Palette
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme

// Ports the web app's legal pages (src/web/Legal.tsx).

enum class LegalPageName(val title: String) {
    Privacy("Privacy Policy"),
    Terms("Terms of Use"),
}

/** Opens a legal page over the app, from the practitioner notice or the account menu. */
val LocalOpenLegal = compositionLocalOf<(LegalPageName) -> Unit> { {} }

private const val EFFECTIVE = "4 November 2026"
private const val CONTACT = "rasagyavatsal16@gmail.com"

/** One block of a legal page. */
private sealed interface Section {
    data class Heading(val text: String) : Section
    data class Paragraph(val text: Text) : Section
    data class Bullets(val items: List<Text>) : Section
}

/** A run of text that may hold bold leads, the contact address and links to the other page. */
private class Text(val build: AnnotatedString.Builder.(Links) -> Unit)

private class Links(val colors: Palette, val open: (LegalPageName) -> Unit)

private fun AnnotatedString.Builder.bold(text: String) = withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(text) }

private fun AnnotatedString.Builder.mail(links: Links) = withLink(
    LinkAnnotation.Url("mailto:$CONTACT", TextLinkStyles(SpanStyle(color = links.colors.accentText, textDecoration = TextDecoration.Underline))),
) { append(CONTACT) }

private fun AnnotatedString.Builder.page(links: Links, page: LegalPageName) = withLink(
    LinkAnnotation.Clickable(
        page.name,
        TextLinkStyles(SpanStyle(color = links.colors.accentText, textDecoration = TextDecoration.Underline)),
    ) { links.open(page) },
) { append(page.title) }

private fun p(text: String) = Section.Paragraph(Text { append(text) })

private fun p(build: AnnotatedString.Builder.(Links) -> Unit) = Section.Paragraph(Text(build))

private fun h(text: String) = Section.Heading(text)

private fun ul(vararg items: AnnotatedString.Builder.(Links) -> Unit) = Section.Bullets(items.map(::Text))

/** A bullet that starts with a bold lead. */
private fun lead(lead: String, rest: String): AnnotatedString.Builder.(Links) -> Unit = {
    bold(lead)
    append(" $rest")
}

private fun plain(text: String): AnnotatedString.Builder.(Links) -> Unit = { append(text) }

private val Privacy = listOf(
    h("Who we are"),
    p {
        append("HomeoRemedica is operated by Rasagya Vatsal, Mandi, Himachal Pradesh, India. Write to ")
        mail(it)
        append(" about this policy or your data. The same address reaches our grievance officer.")
    },
    h("What we collect"),
    ul(
        lead(
            "Account.",
            "Your email address and how you sign in: a password, or the name and email Google shares when you continue with " +
                "Google. Firebase Authentication holds these; we never see your password.",
        ),
        lead(
            "Chats.",
            "Signed in with a verified email, your questions and the answers are saved to your account. Signed out, chats stay " +
                "on your device and are not stored by us.",
        ),
        lead(
            "Ratings.",
            "When you rate an answer, we keep the question, the answer, your rating, the reasons you chose and any comment.",
        ),
        lead("Technical.", "Your IP address, held briefly in memory to enforce rate limits and never saved."),
    ),
    p(
        "The app also stores on your device your theme, that you have seen the practitioner notice, the open chat and your " +
            "sign-in session. We use no advertising, analytics or tracking cookies, and we do not sell data.",
    ),
    h("How we use it"),
    p(
        "To answer your questions, keep your chats on every device you sign in on, prevent abuse, and improve answers using " +
            "your ratings.",
    ),
    h("Who processes it"),
    ul(
        lead(
            "Google Cloud and Firebase",
            "host the service, sign you in and store accounts, chats and ratings in India (asia-south1).",
        ),
        lead("OpenRouter", "receives each question to search the books."),
        lead("Z.AI", "receives each question, the recent conversation and the passages found, to write the answer."),
    ),
    p("These providers may process data outside India under their own terms."),
    h("Patient information"),
    p(
        "Do not enter anything that identifies a patient, such as names, contact details or ID numbers. If you do, you are " +
            "responsible for having a lawful basis to share it.",
    ),
    h("How long we keep it"),
    p(
        "Until you delete it. Deleting a chat removes it. Deleting all chats removes your chats and ratings. Deleting your " +
            "account removes your chats, your ratings and your sign-in.",
    ),
    h("Your rights"),
    p {
        append("You can ask to see, correct or erase your data, withdraw consent, or raise a grievance by writing to ")
        mail(it)
        append(". We respond within 30 days. You may also complain to the Data Protection Board of India.")
    },
    h("Changes"),
    p("We will update the effective date above and tell you in the app about significant changes."),
)

private val Terms = listOf(
    p {
        append("HomeoRemedica is operated by Rasagya Vatsal, Mandi, Himachal Pradesh, India. By using it you agree to these terms and to the ")
        page(it, LegalPageName.Privacy)
        append(".")
    },
    h("Who may use it"),
    p(
        "HomeoRemedica is a reference tool for qualified homeopathy practitioners aged 18 or over. It is not for patients or " +
            "self-treatment.",
    ),
    h("Not medical advice"),
    p(
        "Answers are generated by AI from historical texts by Allen, Boericke, Clarke, Hahnemann and Kent. They can be " +
            "incomplete or wrong, and the texts reflect the knowledge of their time. Every clinical decision remains your " +
            "professional responsibility.",
    ),
    h("Your account"),
    p("Keep your sign-in secure. You are responsible for what happens on your account."),
    h("Acceptable use"),
    ul(
        plain("Do not enter anything that identifies a patient."),
        plain("Do not use the service for anything unlawful."),
        plain("Do not scrape it, query it in bulk by automated means, or try to get around its rate limits."),
        plain("Do not try to disrupt, probe or gain unauthorised access to it."),
    ),
    h("Content"),
    p(
        "The source texts are in the public domain. The app, its code and how it arranges the texts belong to Rasagya " +
            "Vatsal. You may use the answers in your practice.",
    ),
    h("Availability"),
    p(
        "The service is free and provided as is, without any guarantee that it will be available, accurate or fit for a " +
            "particular purpose. We may change, limit or end it at any time.",
    ),
    h("Suspension"),
    p("We may suspend or delete accounts that break these terms."),
    h("Liability"),
    p(
        "To the fullest extent the law allows, HomeoRemedica and its operator are not liable for any loss or damage arising " +
            "from your use of the service, including decisions made on the basis of its answers.",
    ),
    h("Governing law"),
    p("These terms are governed by the laws of India. Courts in Mandi, Himachal Pradesh have exclusive jurisdiction."),
    h("Changes"),
    p(
        "We will update the effective date above when these terms change. Using the service after a change means you accept " +
            "the new terms.",
    ),
    h("Contact"),
    p { mail(it) },
)

/** A legal page over the app; [onOpen] shows the other one and [onClose] returns to the app. */
@Composable
fun LegalPage(page: LegalPageName, onOpen: (LegalPageName) -> Unit, onClose: () -> Unit) {
    val colors = Theme.colors
    val other = if (page == LegalPageName.Privacy) LegalPageName.Terms else LegalPageName.Privacy
    val links = Links(colors, onOpen)
    val scroll = key(page) { rememberScrollState() }
    LaunchedEffect(page) { scroll.scrollTo(0) }
    BackHandler(onBack = onClose)

    Column(Modifier.fillMaxSize().background(colors.canvas)) {
        Row(
            Modifier
                .fillMaxWidth()
                .drawBehind { drawLine(colors.border, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
                .statusBarsPadding()
                .heightIn(min = 44.dp)
                .padding(horizontal = 16.dp, vertical = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Brand(Modifier.pressable(label = "Back to HomeoRemedica", onClick = onClose))
            ThemeToggle()
        }
        Box(Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll), contentAlignment = Alignment.TopCenter) {
            Column(
                Modifier
                    .widthIn(max = 736.dp)
                    .fillMaxWidth()
                    .navigationBarsPadding()
                    .padding(horizontal = 16.dp),
            ) {
                val body = TextStyle(color = colors.text, fontFamily = Fonts.sans, fontSize = 17.sp, lineHeight = 1.65.em)
                SelectionContainer {
                    Column(Modifier.padding(vertical = 32.dp)) {
                        BasicText(
                            page.title,
                            style = body.copy(fontSize = 32.sp, lineHeight = 1.25.em),
                            modifier = Modifier.semantics { heading() },
                        )
                        BasicText(
                            "Effective $EFFECTIVE",
                            style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 13.sp),
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        for (section in if (page == LegalPageName.Privacy) Privacy else Terms) {
                            when (section) {
                                is Section.Heading -> BasicText(
                                    section.text,
                                    style = body.copy(fontWeight = FontWeight.SemiBold, lineHeight = 1.25.em),
                                    modifier = Modifier.padding(top = 32.dp).semantics { heading() },
                                )
                                is Section.Paragraph -> BasicText(
                                    buildAnnotatedString { section.text.build(this, links) },
                                    style = body,
                                    modifier = Modifier.padding(top = 12.dp),
                                )
                                is Section.Bullets -> Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    for (item in section.items) {
                                        Row {
                                            BasicText("•", style = body, modifier = Modifier.padding(start = 8.dp).widthIn(min = 16.dp))
                                            BasicText(buildAnnotatedString { item.build(this, links) }, style = body)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Spacer(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
                FlowRow(
                    Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 48.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Button("Back to HomeoRemedica", ButtonStyle.Outline, onClose, icon = Icons.ArrowLeft)
                    Button(other.title, ButtonStyle.Quiet, { onOpen(other) }, trailingIcon = Icons.ArrowRight, color = colors.textMuted)
                }
            }
        }
    }
}

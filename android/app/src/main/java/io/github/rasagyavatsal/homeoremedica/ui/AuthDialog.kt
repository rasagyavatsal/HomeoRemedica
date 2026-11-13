package io.github.rasagyavatsal.homeoremedica.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import io.github.rasagyavatsal.homeoremedica.account.AuthClient
import io.github.rasagyavatsal.homeoremedica.account.AuthException
import io.github.rasagyavatsal.homeoremedica.account.authFormError
import io.github.rasagyavatsal.homeoremedica.ui.theme.Fonts
import io.github.rasagyavatsal.homeoremedica.ui.theme.Theme
import kotlinx.coroutines.launch

// The web app's sign-in dialog (src/web/AuthDialog.tsx), a page of its own on phones.

private enum class Mode(val title: String) {
    SignIn("Sign in"),
    SignUp("Create an account"),
    Reset("Reset your password"),
}

@Composable
fun AuthDialog(auth: AuthClient, onClose: () -> Unit) {
    val context = LocalContext.current
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()
    var mode by rememberSaveable { mutableStateOf(Mode.SignIn) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    var sent by rememberSaveable { mutableStateOf(false) }
    var working by rememberSaveable { mutableStateOf(false) }

    fun attempt(action: suspend () -> Unit, after: () -> Unit = onClose) {
        if (working) return
        working = true
        error = null
        scope.launch {
            try {
                action()
                after()
            } catch (failure: AuthException) {
                error = failure.message
            } finally {
                working = false
            }
        }
    }

    fun submit() {
        val address = email.trim()
        val invalid = authFormError(address, password.takeUnless { mode == Mode.Reset }, signingUp = mode == Mode.SignUp)
        if (invalid != null) {
            error = invalid
            return
        }
        focus.clearFocus()
        when (mode) {
            Mode.Reset -> attempt({ auth.resetPassword(address) }) { sent = true }
            Mode.SignUp -> attempt({ auth.signUp(address, password) })
            Mode.SignIn -> attempt({ auth.signIn(address, password) })
        }
    }

    fun switchTo(next: Mode) {
        mode = next
        error = null
        sent = false
    }

    TaskPage(mode.title, onClose) {
        if (mode != Mode.Reset && auth.google) {
            Button(
                "Continue with Google",
                ButtonStyle.Outline,
                { attempt({ auth.signInWithGoogle(context) }) },
                Modifier.fillMaxWidth(),
                enabled = !working,
                mark = Icons.Google,
                minHeight = if (LocalCompact.current) 52.dp else 36.dp,
            )
            Divider("or with email")
        }

        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TextField(
                "Email",
                email,
                { email = it },
                ContentType.EmailAddress,
                keyboardType = KeyboardType.Email,
                imeAction = if (mode == Mode.Reset) ImeAction.Send else ImeAction.Next,
                onAction = { if (mode == Mode.Reset) submit() else focus.moveFocus(FocusDirection.Down) },
            )
            if (mode != Mode.Reset) {
                TextField(
                    "Password",
                    password,
                    { password = it },
                    if (mode == Mode.SignUp) ContentType.NewPassword else ContentType.Password,
                    keyboardType = KeyboardType.Password,
                    password = true,
                    imeAction = ImeAction.Done,
                    onAction = ::submit,
                )
            }
            error?.let { FormMessage(it) }
            if (sent) FormMessage("If an account uses ${email.trim()}, a reset link is on its way.", success = true)
            Button(
                if (mode == Mode.Reset) "Send reset link" else mode.title,
                ButtonStyle.Primary,
                ::submit,
                Modifier.fillMaxWidth(),
                enabled = !working,
                minHeight = if (LocalCompact.current) 52.dp else 44.dp,
            )
        }

        AuthLinks(mode, ::switchTo)

        if (mode != Mode.Reset) LegalNote()
    }
}

/** The web app's `.dialog-links`: the other ways through the dialog. */
@Composable
private fun AuthLinks(mode: Mode, switchTo: (Mode) -> Unit) {
    val muted = TextStyle(color = Theme.colors.textMuted, fontFamily = Fonts.sans, fontSize = if (LocalCompact.current) 14.sp else 13.sp)
    if (LocalCompact.current) {
        // One under another on phones, where a row would squeeze them.
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            when (mode) {
                Mode.SignIn -> {
                    TextButton("Create an account") { switchTo(Mode.SignUp) }
                    TextButton("Forgot password?") { switchTo(Mode.Reset) }
                }
                Mode.SignUp -> Row(verticalAlignment = Alignment.CenterVertically) {
                    BasicText("Already have an account? ", style = muted)
                    TextButton("Sign in") { switchTo(Mode.SignIn) }
                }
                Mode.Reset -> TextButton("Back to sign in") { switchTo(Mode.SignIn) }
            }
        }
        return
    }
    FlowRow(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        when (mode) {
            Mode.SignIn -> {
                TextButton("Forgot password?") { switchTo(Mode.Reset) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BasicText("New here? ", style = muted)
                    TextButton("Create an account") { switchTo(Mode.SignUp) }
                }
            }
            Mode.SignUp -> Row(verticalAlignment = Alignment.CenterVertically) {
                BasicText("Already have an account? ", style = muted)
                TextButton("Sign in") { switchTo(Mode.SignIn) }
            }
            Mode.Reset -> TextButton("Back to sign in") { switchTo(Mode.SignIn) }
        }
    }
}

/** The web app's `.legal-links`: what signing in agrees to. */
@Composable
private fun LegalNote() {
    val colors = Theme.colors
    val openLegal = LocalOpenLegal.current
    val link = TextLinkStyles(SpanStyle(color = colors.accentText))
    BasicText(
        buildAnnotatedString {
            append("By continuing, you agree to the ")
            for ((index, page) in listOf(LegalPageName.Terms, LegalPageName.Privacy).withIndex()) {
                if (index > 0) append(" and ")
                withLink(LinkAnnotation.Clickable(page.name, link) { openLegal(page) }) { append(page.title) }
            }
            append(".")
        },
        style = TextStyle(color = colors.textSubtle, fontFamily = Fonts.sans, fontSize = 12.sp, lineHeight = 17.sp),
    )
}

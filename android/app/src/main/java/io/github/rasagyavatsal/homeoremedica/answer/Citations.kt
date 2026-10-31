package io.github.rasagyavatsal.homeoremedica.answer

import io.github.rasagyavatsal.homeoremedica.api.Citation

// Ports the web app's citation handling (src/web/Answer.tsx).

const val CITATION_HREF = "#cite-"
private val CODE_SPAN = Regex("```[\\s\\S]*?```|`[^`\\n]*`")
// A label followed by `(`, `:` or `[` is Markdown link syntax, unless the `[` opens another label, as in `[1][2]`.
private val CITATION = Regex("""\[(\d+(?:\s*,\s*\d+)*)](?![(:]|\[(?!\d+(?:\s*,\s*\d+)*]))""")

/** Replace each `[1]` or `[1, 2]` label outside code whose numbers all name a source. */
private fun replaceCitations(markdown: String, sourceCount: Int, replace: (List<Int>) -> String): String {
    val result = StringBuilder()
    var start = 0
    fun prose(end: Int) = markdown.substring(start, end).replace(CITATION) { match ->
        val numbers = match.groupValues[1].split(',').map { it.trim().toIntOrNull() ?: 0 }
        if (numbers.all { it in 1..sourceCount }) replace(numbers) else match.value
    }
    for (code in CODE_SPAN.findAll(markdown)) {
        result.append(prose(code.range.first)).append(code.value)
        start = code.range.last + 1
    }
    return result.append(prose(markdown.length)).toString()
}

/** Turn `[1]` and `[1, 2]` labels into citation links, leaving code and unknown numbers untouched. */
fun linkCitations(markdown: String, sourceCount: Int): String =
    replaceCitations(markdown, sourceCount) { numbers -> numbers.joinToString("") { "[$it]($CITATION_HREF$it)" } }

fun citedNumbers(markdown: String, sourceCount: Int): Set<Int> {
    val cited = mutableSetOf<Int>()
    replaceCitations(markdown, sourceCount) { numbers ->
        cited += numbers
        ""
    }
    return cited
}

/** Source numbers in display order: those the answer cites first; the rest were retrieved but not used. */
fun sourceOrder(sourceCount: Int, cited: Set<Int>): List<Int> =
    (1..sourceCount).sortedWith(compareBy({ it !in cited }, { it }))

/** The remedy, or the section for passages about principles rather than a remedy. */
val Citation.label: String get() = remedyName ?: sectionTitle

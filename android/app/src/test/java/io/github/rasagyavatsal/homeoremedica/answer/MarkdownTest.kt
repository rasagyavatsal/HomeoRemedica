package io.github.rasagyavatsal.homeoremedica.answer

import io.github.rasagyavatsal.homeoremedica.answer.Block.ListBlock
import io.github.rasagyavatsal.homeoremedica.answer.Block.Paragraph
import io.github.rasagyavatsal.homeoremedica.answer.Inline.Citation
import io.github.rasagyavatsal.homeoremedica.answer.Inline.Strong
import io.github.rasagyavatsal.homeoremedica.answer.Inline.Text
import org.junit.Assert.assertEquals
import org.junit.Test

class MarkdownTest {
    @Test
    fun turnsKnownLabelsIntoCitations() {
        assertEquals(
            listOf(Paragraph(listOf(Text("Supported claim "), Citation(1), Text(". Unsupported claim [9]."))))
                .toString(),
            parseAnswer("Supported claim [1]. Unsupported claim [9].", 1).joined().toString(),
        )
    }

    @Test
    fun turnsAdjacentLabelsIntoCitations() {
        assertEquals(
            listOf(Paragraph(listOf(Text("Open air "), Citation(1), Citation(2), Citation(3), Text(".")))).toString(),
            parseAnswer("Open air [1][2][3].", 3).joined().toString(),
        )
    }

    @Test
    fun dropsRawHtml() {
        assertEquals(
            listOf(Paragraph(listOf(Strong(listOf(Text("Bold"))), Text(" and safe")))).toString(),
            parseAnswer("<script>alert(1)</script>\n\n**Bold** and <b>safe</b>", 0).joined().toString(),
        )
    }

    @Test
    fun keepsListStructureAndNumbering() {
        val list = parseAnswer("3. First\n4. Second [1]", 1).single() as ListBlock
        assertEquals(true, list.ordered)
        assertEquals(3, list.start)
        assertEquals(2, list.items.size)
        assertEquals(listOf(Text("Second "), Citation(1)), (list.items[1].single() as Paragraph).inlines)
    }

    @Test
    fun keepsHeadingsCodeQuotesAndRules() {
        val blocks = parseAnswer("## Mind\n\n> Weeps easily\n\n```\n[1]\n```\n\n---", 1)
        assertEquals(Block.Heading(2, listOf(Text("Mind"))), blocks[0])
        assertEquals(Block.Quote(listOf(Paragraph(listOf(Text("Weeps easily"))))), blocks[1])
        assertEquals(Block.CodeBlock("[1]"), blocks[2])
        assertEquals(Block.Rule, blocks[3])
    }

    /** Merge adjacent text pieces, which CommonMark may split around punctuation. */
    private fun List<Block>.joined(): List<Block> = map { block ->
        if (block !is Paragraph) return@map block
        val merged = mutableListOf<Inline>()
        for (inline in block.inlines) {
            val last = merged.lastOrNull()
            if (inline is Text && last is Text) merged[merged.lastIndex] = Text(last.text + inline.text) else merged += inline
        }
        Paragraph(merged)
    }
}

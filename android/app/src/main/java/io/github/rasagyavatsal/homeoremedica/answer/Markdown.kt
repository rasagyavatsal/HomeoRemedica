package io.github.rasagyavatsal.homeoremedica.answer

import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.Image
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.Text
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser

/** A CommonMark document reduced to what answers use; raw HTML is dropped, as the web app's `skipHtml` does. */
sealed interface Block {
    data class Paragraph(val inlines: List<Inline>) : Block
    data class Heading(val level: Int, val inlines: List<Inline>) : Block
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<List<Block>>) : Block
    data class Quote(val blocks: List<Block>) : Block
    data class CodeBlock(val code: String) : Block
    data object Rule : Block
}

sealed interface Inline {
    data class Text(val text: String) : Inline
    data class Emphasis(val children: List<Inline>) : Inline
    data class Strong(val children: List<Inline>) : Inline
    data class Code(val code: String) : Inline
    data class Link(val destination: String, val children: List<Inline>) : Inline
    data class Citation(val number: Int) : Inline
    data object LineBreak : Inline
}

private val parser: Parser = Parser.builder().build()

/** Parse an answer, turning its known `[n]` labels into [Inline.Citation]s. */
fun parseAnswer(markdown: String, sourceCount: Int): List<Block> =
    blocks(parser.parse(linkCitations(markdown, sourceCount)))

/** Parse a passage from the books, which cites nothing. */
fun parsePassage(markdown: String): List<Block> = blocks(parser.parse(markdown))

private fun Node.children(): Sequence<Node> = generateSequence(firstChild) { it.next }

private fun blocks(parent: Node): List<Block> = parent.children().mapNotNull(::block).toList()

private fun block(node: Node): Block? = when (node) {
    is Paragraph -> Block.Paragraph(inlines(node))
    is Heading -> Block.Heading(node.level, inlines(node))
    is BulletList -> Block.ListBlock(ordered = false, start = 1, items = items(node))
    is OrderedList -> Block.ListBlock(ordered = true, start = node.markerStartNumber ?: 1, items = items(node))
    is BlockQuote -> Block.Quote(blocks(node))
    is FencedCodeBlock -> Block.CodeBlock(node.literal.removeSuffix("\n"))
    is IndentedCodeBlock -> Block.CodeBlock(node.literal.removeSuffix("\n"))
    is ThematicBreak -> Block.Rule
    else -> null
}

private fun items(list: Node): List<List<Block>> = list.children().filterIsInstance<ListItem>().map(::blocks).toList()

private fun inlines(parent: Node): List<Inline> = parent.children().mapNotNull(::inline).toList()

private fun inline(node: Node): Inline? = when (node) {
    is Text -> Inline.Text(node.literal)
    is Emphasis -> Inline.Emphasis(inlines(node))
    is StrongEmphasis -> Inline.Strong(inlines(node))
    is Code -> Inline.Code(node.literal)
    is SoftLineBreak -> Inline.Text(" ")
    is HardLineBreak -> Inline.LineBreak
    is Link -> node.destination.removePrefix(CITATION_HREF).toIntOrNull()
        ?.takeIf { node.destination.startsWith(CITATION_HREF) }
        ?.let(Inline::Citation)
        ?: Inline.Link(node.destination, inlines(node))
    // Images are not loaded; their description stands in for them.
    is Image -> Inline.Emphasis(inlines(node))
    else -> null
}

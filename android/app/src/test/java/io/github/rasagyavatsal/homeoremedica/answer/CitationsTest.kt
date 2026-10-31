package io.github.rasagyavatsal.homeoremedica.answer

import io.github.rasagyavatsal.homeoremedica.api.Citation
import org.junit.Assert.assertEquals
import org.junit.Test

class CitationsTest {
    @Test
    fun linksKnownCitationsAndLeavesUnknownNumbersAsText() {
        assertEquals(
            "Supported claim [1](#cite-1). Unsupported claim [9].",
            linkCitations("Supported claim [1]. Unsupported claim [9].", 1),
        )
    }

    @Test
    fun splitsCitationListsIntoOneLinkEach() {
        assertEquals("Claim [1](#cite-1)[3](#cite-3).", linkCitations("Claim [1, 3].", 3))
    }

    @Test
    fun linksAdjacentLabels() {
        assertEquals("Open air [1](#cite-1)[2](#cite-2)[5](#cite-5).", linkCitations("Open air [1][2][5].", 5))
        assertEquals(setOf(1, 2, 5), citedNumbers("Open air [1][2][5].", 5))
        assertEquals("Claim [1](#cite-1)[9].", linkCitations("Claim [1][9].", 5))
    }

    @Test
    fun leavesAListWithAnyUnknownNumberUntouched() {
        assertEquals("Claim [1, 4].", linkCitations("Claim [1, 4].", 3))
        assertEquals("Claim [0].", linkCitations("Claim [0].", 3))
    }

    @Test
    fun leavesCodeLinksAndReferencesUntouched() {
        val markdown = "Use `[1]` or\n```\n[2]\n```\na [1](https://example.com) link, [1]: ref, [1][x], then [2]."
        assertEquals(
            "Use `[1]` or\n```\n[2]\n```\na [1](https://example.com) link, [1]: ref, [1][x], then [2](#cite-2).",
            linkCitations(markdown, 2),
        )
    }

    @Test
    fun collectsTheNumbersAnAnswerCites() {
        assertEquals(setOf(1, 3), citedNumbers("Claim [3]. Another claim [1, 3]. Code `[2]`. Unknown [7].", 3))
    }

    @Test
    fun ordersCitedSourcesFirst() {
        assertEquals(listOf(1, 3, 2), sourceOrder(3, setOf(3, 1)))
        assertEquals(listOf(1, 2, 3), sourceOrder(3, emptySet()))
    }

    @Test
    fun namesSourcesWithoutARemedyBySection() {
        val source = Citation(id = "c", bookId = "b", bookTitle = "Organon", remedyName = null, sectionTitle = "Aphorism 1", text = "t")
        assertEquals("Aphorism 1", source.label)
        assertEquals("Pulsatilla", source.copy(remedyName = "Pulsatilla").label)
    }
}

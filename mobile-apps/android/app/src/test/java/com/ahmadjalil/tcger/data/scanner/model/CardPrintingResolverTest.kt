package com.ahmadjalil.tcger.data.scanner.model

import com.ahmadjalil.tcger.data.scanner.ScannerPrintingMode
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CardPrintingResolverTest {
    @Test
    fun quickScanUsesNewestPrintingInMatchedFamily() {
        val older = match("old", "2020-01-01")
        val newer = match("new", "2024-02-02")

        val decision = CardPrintingResolver.resolve(
            older,
            listOf(newer),
            ScannerPrintingMode.QUICK_LATEST,
        )

        assertEquals("new", decision.selected?.card?.cardId)
        assertEquals(PrintingResolutionProvenance.LATEST_FALLBACK, decision.provenance)
    }

    @Test
    fun exactModeRequiresChoiceForIdenticalArtworkPrintings() {
        val decision = CardPrintingResolver.resolve(
            match("old", "2020-01-01"),
            listOf(match("new", "2024-02-02")),
            ScannerPrintingMode.EXACT_PRINTING,
        )

        assertNull(decision.selected)
        assertTrue(decision.requiresSelection)
    }

    @Test
    fun verifiedEvidenceOverridesNewestFallback() {
        val decision = CardPrintingResolver.resolve(
            match("new", "2024-02-02"),
            listOf(match("old", "2020-01-01")),
            ScannerPrintingMode.QUICK_LATEST,
            verifiedExactPrintingId = "old",
        )

        assertEquals("old", decision.selected?.card?.cardId)
        assertEquals(PrintingResolutionProvenance.VERIFIED, decision.provenance)
    }

    @Test
    fun compactFamilyRowExpandsPrintingsOnlyAfterRetrieval() {
        val family = match("new", "2025-01-01").let { match ->
            match.copy(card = match.card.copy(printings = listOf(
                CardEmbeddingPrinting("new", "new", releaseDate = "2025-01-01"),
                CardEmbeddingPrinting("old", "old", releaseDate = "2020-01-01"),
            )))
        }

        val quick = CardPrintingResolver.resolve(
            family, emptyList(), ScannerPrintingMode.QUICK_LATEST,
        )
        assertEquals("new", quick.selected?.card?.exactPrintingId)

        val exact = CardPrintingResolver.resolve(
            family, emptyList(), ScannerPrintingMode.EXACT_PRINTING,
        )
        assertEquals(listOf("new", "old"), exact.candidates.map { it.card.exactPrintingId })
        assertTrue(exact.requiresSelection)
    }

    private fun match(id: String, releaseDate: String) = CardEmbeddingMatch(
        index = if (id == "old") 0 else 1,
        similarity = 0.9,
        card = CardEmbeddingMetadata(
            annIndex = if (id == "old") 0 else 1,
            cardId = id,
            exactPrintingId = id,
            recognitionFamilyId = "art:pikachu-1",
            name = "Pikachu",
            game = "pokemon",
            releaseDate = releaseDate,
        ),
    )
}

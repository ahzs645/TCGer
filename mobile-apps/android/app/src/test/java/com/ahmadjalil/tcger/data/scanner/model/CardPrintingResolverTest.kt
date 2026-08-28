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

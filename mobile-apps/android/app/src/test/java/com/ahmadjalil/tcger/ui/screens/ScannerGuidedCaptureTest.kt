package com.ahmadjalil.tcger.ui.screens

import com.ahmadjalil.tcger.data.scanner.binder.NormalizedPoint
import com.ahmadjalil.tcger.data.scanner.binder.ScannerCropQuad
import com.ahmadjalil.tcger.domain.CardScanCandidate
import com.ahmadjalil.tcger.domain.CatalogCard
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScannerGuidedCaptureTest {
    @Test
    fun pocketSelectionPreservesReadingOrderAndAllowsCorrectionOrSkip() {
        val first = CatalogCard("first", "Pikachu", "pokemon")
        val alternate = CatalogCard("alternate", "Raichu", "pokemon")
        val last = CatalogCard("last", "Mew", "pokemon")
        val pockets = listOf(
            BinderPocketReview(8, listOf(CardScanCandidate(last, confidence = 0.9))),
            BinderPocketReview(0, listOf(CardScanCandidate(first), CardScanCandidate(alternate)), "alternate"),
            BinderPocketReview(1, listOf(CardScanCandidate(first)), selectedCardId = null),
        )

        assertEquals(listOf("alternate", "last"), selectedBinderCards(pockets).map(CatalogCard::id))
        assertNull(pockets.last().selectedCard)
    }

    @Test
    fun binderCandidatesRequireStrongConfidenceBeforeAutoSelection() {
        val card = CatalogCard("candidate", "Candidate", "magic")

        assertNull(
            BinderPocketReview(0, listOf(CardScanCandidate(card, confidence = 0.81))).selectedCard,
        )
        assertEquals(
            "candidate",
            BinderPocketReview(0, listOf(CardScanCandidate(card, confidence = 0.82))).selectedCard?.id,
        )
        assertNull(BinderPocketReview(0, listOf(CardScanCandidate(card))).selectedCard)
    }

    @Test
    fun cornerAdjustmentChangesOnlyRequestedCornerAndRetainsValidation() {
        val initial = ScannerCropQuad.fromBounds(0.1f, 0.1f, 0.9f, 0.9f)
        val changed = initial.withCorner(0, NormalizedPoint(0.08f, 0.12f))

        assertEquals(NormalizedPoint(0.08f, 0.12f), changed.topLeft)
        assertEquals(initial.topRight, changed.topRight)
        assertTrue(changed.isValid)
    }
}

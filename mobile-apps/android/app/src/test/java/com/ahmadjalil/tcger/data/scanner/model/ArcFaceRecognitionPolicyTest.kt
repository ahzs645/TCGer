package com.ahmadjalil.tcger.data.scanner.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ArcFaceRecognitionPolicyTest {
    @Test
    fun `accepts calibrated strong unambiguous match`() {
        val decision = ArcFaceRecognitionPolicy.decide(listOf(match("a", 0.72), match("b", 0.61)))

        assertTrue(decision is ArcFaceRecognitionDecision.Accepted)
        assertEquals(0.11, (decision as ArcFaceRecognitionDecision.Accepted).margin!!, 0.000_001)
    }

    @Test
    fun `rejects score below calibrated threshold`() {
        val decision = ArcFaceRecognitionPolicy.decide(listOf(match("a", 0.59), match("b", 0.20)))

        assertEquals(
            ArcFaceRecognitionDecision.Rejected.Reason.BELOW_THRESHOLD,
            (decision as ArcFaceRecognitionDecision.Rejected).reason,
        )
    }

    @Test
    fun `compares margin against the next distinct card`() {
        val decision = ArcFaceRecognitionPolicy.decide(
            listOf(match("a", 0.72), match("a", 0.71), match("b", 0.69)),
        )

        assertEquals(
            ArcFaceRecognitionDecision.Rejected.Reason.AMBIGUOUS,
            (decision as ArcFaceRecognitionDecision.Rejected).reason,
        )
    }

    private fun match(id: String, similarity: Double) = CardEmbeddingMatch(
        index = 0,
        similarity = similarity,
        card = CardEmbeddingMetadata(annIndex = 0, cardId = id, name = id),
    )
}

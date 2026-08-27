package com.ahmadjalil.tcger.data.scanner.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DinoV2RecognitionPolicyTest {
    @Test fun gateUsesStableLogisticScoring() {
        val gate = DinoV2CardFaceGate(1, "m", "dinov2", "q8", 2, 0.0, listOf(2.0, -2.0), 0.45)
        assertEquals(0.5, gate.probability(floatArrayOf(0f, 0f)), 1e-9)
        assertTrue(gate.probability(floatArrayOf(1f, -1f)) > 0.98)
    }

    @Test fun weakGateRejectsBeforeNearestNeighborAcceptance() {
        val gate = DinoV2CardFaceGate(1, "m", "dinov2", "q8", 2, -20.0, listOf(0.0, 0.0), 0.45)
        val card = CardEmbeddingMetadata(0, "a", "A")
        val decision = DinoV2RecognitionPolicy.decide(
            floatArrayOf(1f, 0f),
            listOf(CardEmbeddingMatch(0, 0.99, card)),
            gate,
        )
        assertTrue(decision is DinoV2RecognitionDecision.Rejected)
        assertEquals(
            DinoV2RecognitionDecision.Rejected.Reason.NOT_A_CARD,
            (decision as DinoV2RecognitionDecision.Rejected).reason,
        )
    }
}

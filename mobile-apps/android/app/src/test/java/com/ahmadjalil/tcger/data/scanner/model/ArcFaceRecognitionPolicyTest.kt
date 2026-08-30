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

    @Test
    fun `hub collapse rejects many unrelated high neighbours before any accept`() {
        val policy = ScannerAcceptancePolicy.builtin("magic")
        val collapsed = ArcFaceRecognitionPolicy.decide(
            listOf(named("a", "Radha, Heart of Keld", 0.995), named("b", "Instill Energy", 0.954), named("c", "The Bath Song", 0.934)),
            strongAcceptanceScore = policy.strongAcceptanceScore,
            ambiguityMargin = policy.ambiguityMargin,
            policy = policy,
        )
        assertEquals(
            ArcFaceRecognitionDecision.Rejected.Reason.HUB,
            (collapsed as ArcFaceRecognitionDecision.Rejected).reason,
        )
        val genuine = ArcFaceRecognitionPolicy.decide(
            listOf(named("a", "Crew Captain", 0.936), named("b", "Brokers Charm", 0.61)),
            strongAcceptanceScore = policy.strongAcceptanceScore,
            ambiguityMargin = policy.ambiguityMargin,
            policy = policy,
        )
        assertTrue(genuine is ArcFaceRecognitionDecision.Accepted)
        val disabled = ArcFaceRecognitionPolicy.decide(
            listOf(named("a", "A", 0.99), named("b", "B", 0.98), named("c", "C", 0.97)),
            strongAcceptanceScore = 0.7,
            ambiguityMargin = 0.05,
            policy = policy.copy(hubDistinctNames = 0),
        )
        assertTrue(disabled is ArcFaceRecognitionDecision.Rejected)
        assertEquals(
            ArcFaceRecognitionDecision.Rejected.Reason.AMBIGUOUS,
            (disabled as ArcFaceRecognitionDecision.Rejected).reason,
        )
    }

    @Test
    fun `gallery exclusions drop non-card Magic rows from eligibility`() {
        val substitute = CardEmbeddingMetadata(0, "x", "Double-Faced Substitute Card", game = "magic", setCode = "sznr")
        val card = CardEmbeddingMetadata(1, "y", "Stone Quarry", game = "magic", setCode = "c19")
        assertTrue(!substitute.isEligibleForGame("magic"))
        assertTrue(card.isEligibleForGame("magic"))
        assertTrue(ScannerGalleryExclusions.excludes("Tom van de Logt Bio (2001)", "magic"))
        assertTrue(!ScannerGalleryExclusions.excludes("Mindful Biomancer", "magic"))
        assertTrue(!ScannerGalleryExclusions.excludes("Double-Faced Substitute Card", "pokemon"))
    }

    private fun named(id: String, name: String, similarity: Double) = CardEmbeddingMatch(
        index = 0,
        similarity = similarity,
        card = CardEmbeddingMetadata(0, id, name, game = "magic"),
    )

    private fun match(id: String, similarity: Double) = CardEmbeddingMatch(
        index = 0,
        similarity = similarity,
        card = CardEmbeddingMetadata(annIndex = 0, cardId = id, name = id),
    )
}

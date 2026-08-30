package com.ahmadjalil.tcger.data.scanner.model

sealed interface ArcFaceRecognitionDecision {
    data class Accepted(val match: CardEmbeddingMatch, val margin: Double?) : ArcFaceRecognitionDecision
    data class Rejected(
        val reason: Reason,
        val bestMatch: CardEmbeddingMatch?,
        val margin: Double?,
    ) : ArcFaceRecognitionDecision {
        enum class Reason { NO_CANDIDATES, BELOW_THRESHOLD, AMBIGUOUS, HUB }
    }
}

object ArcFaceRecognitionPolicy {
    fun decide(
        matches: List<CardEmbeddingMatch>,
        strongAcceptanceScore: Double = ArcFaceModelContract.strongAcceptanceScore,
        ambiguityMargin: Double = ArcFaceModelContract.ambiguityMargin,
        policy: ScannerAcceptancePolicy? = null,
    ): ArcFaceRecognitionDecision {
        val best = matches.firstOrNull()
            ?: return ArcFaceRecognitionDecision.Rejected(
                ArcFaceRecognitionDecision.Rejected.Reason.NO_CANDIDATES,
                null,
                null,
            )
        val rival = matches.firstOrNull { it.card.cardId != best.card.cardId }
        val margin = rival?.let { best.similarity - it.similarity }
        // Hub collapse: a degenerate crop lands near many unrelated rows at
        // once, not near one card. Checked before the threshold so a 0.99
        // hit on a back face never becomes an accept, and never OCR-rescued.
        if (policy?.isHubCollapse(matches.map { it.card.name to it.similarity }) == true) {
            return ArcFaceRecognitionDecision.Rejected(
                ArcFaceRecognitionDecision.Rejected.Reason.HUB,
                best,
                margin,
            )
        }
        if (best.similarity < strongAcceptanceScore) {
            return ArcFaceRecognitionDecision.Rejected(
                ArcFaceRecognitionDecision.Rejected.Reason.BELOW_THRESHOLD,
                best,
                margin,
            )
        }
        if (margin != null && margin < ambiguityMargin) {
            return ArcFaceRecognitionDecision.Rejected(
                ArcFaceRecognitionDecision.Rejected.Reason.AMBIGUOUS,
                best,
                margin,
            )
        }
        return ArcFaceRecognitionDecision.Accepted(best, margin)
    }
}

package com.ahmadjalil.tcger.data.scanner.model

sealed interface ArcFaceRecognitionDecision {
    data class Accepted(val match: CardEmbeddingMatch, val margin: Double?) : ArcFaceRecognitionDecision
    data class Rejected(
        val reason: Reason,
        val bestMatch: CardEmbeddingMatch?,
        val margin: Double?,
    ) : ArcFaceRecognitionDecision {
        enum class Reason { NO_CANDIDATES, BELOW_THRESHOLD, AMBIGUOUS }
    }
}

object ArcFaceRecognitionPolicy {
    fun decide(
        matches: List<CardEmbeddingMatch>,
        strongAcceptanceScore: Double = ArcFaceModelContract.strongAcceptanceScore,
        ambiguityMargin: Double = ArcFaceModelContract.ambiguityMargin,
    ): ArcFaceRecognitionDecision {
        val best = matches.firstOrNull()
            ?: return ArcFaceRecognitionDecision.Rejected(
                ArcFaceRecognitionDecision.Rejected.Reason.NO_CANDIDATES,
                null,
                null,
            )
        val rival = matches.firstOrNull { it.card.cardId != best.card.cardId }
        val margin = rival?.let { best.similarity - it.similarity }
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

package com.ahmadjalil.tcger.data.scanner.model

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.exp

@Serializable
data class DinoV2CardFaceGate(
    val version: Int,
    val model: String,
    val encoder: String,
    val dtype: String,
    val dimension: Int,
    val bias: Double,
    val weights: List<Double>,
    val recommendedThreshold: Double,
) {
    fun probability(embedding: FloatArray): Double {
        require(embedding.size == dimension && weights.size == dimension) { "gate dimension mismatch" }
        val logit = weights.indices.fold(bias) { total, index -> total + weights[index] * embedding[index] }
        return if (logit >= 0) 1.0 / (1.0 + exp(-logit)) else exp(logit) / (1.0 + exp(logit))
    }

    companion object {
        private val json = Json { ignoreUnknownKeys = true }
        fun decode(bytes: ByteArray): DinoV2CardFaceGate =
            json.decodeFromString<DinoV2CardFaceGate>(bytes.decodeToString()).also { gate ->
            require(gate.version == 1 && gate.encoder == "dinov2" && gate.dtype == "q8") { "unsupported DINOv2 gate" }
            require(gate.dimension == DinoV2ModelContract.embeddingDimension && gate.weights.size == gate.dimension)
        }
    }
}

sealed interface DinoV2RecognitionDecision {
    data class Accepted(val match: CardEmbeddingMatch, val margin: Double, val cardProbability: Double) : DinoV2RecognitionDecision
    data class Rejected(
        val reason: Reason,
        val bestMatch: CardEmbeddingMatch?,
        val margin: Double?,
        val cardProbability: Double,
    ) : DinoV2RecognitionDecision {
        enum class Reason { NOT_A_CARD, NO_CANDIDATES, BELOW_THRESHOLD, AMBIGUOUS }
    }
}

object DinoV2RecognitionPolicy {
    fun decide(
        embedding: FloatArray,
        matches: List<CardEmbeddingMatch>,
        gate: DinoV2CardFaceGate,
    ): DinoV2RecognitionDecision {
        val probability = gate.probability(embedding)
        if (probability < gate.recommendedThreshold) {
            return DinoV2RecognitionDecision.Rejected(
                DinoV2RecognitionDecision.Rejected.Reason.NOT_A_CARD,
                matches.firstOrNull(),
                null,
                probability,
            )
        }
        val best = matches.firstOrNull() ?: return DinoV2RecognitionDecision.Rejected(
            DinoV2RecognitionDecision.Rejected.Reason.NO_CANDIDATES, null, null, probability,
        )
        val rival = matches.firstOrNull { it.card.cardId != best.card.cardId }
        val margin = rival?.let { best.similarity - it.similarity } ?: Double.POSITIVE_INFINITY
        if (best.similarity < DinoV2ModelContract.strongAcceptanceScore) {
            return DinoV2RecognitionDecision.Rejected(
                DinoV2RecognitionDecision.Rejected.Reason.BELOW_THRESHOLD, best, margin, probability,
            )
        }
        if (margin < DinoV2ModelContract.ambiguityMargin) {
            return DinoV2RecognitionDecision.Rejected(
                DinoV2RecognitionDecision.Rejected.Reason.AMBIGUOUS, best, margin, probability,
            )
        }
        return DinoV2RecognitionDecision.Accepted(best, margin, probability)
    }
}

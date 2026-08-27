package com.ahmadjalil.tcger.data.scanner

import com.ahmadjalil.tcger.domain.CardScanResult
import kotlinx.serialization.Serializable

@Serializable
enum class ScannerBoundaryDecision {
    ARTWORK_MATCH,
    OCR_MATCH,
    NO_CANDIDATES,
    FAILED,
}

@Serializable
data class ScannerBoundaryCandidateEvidence(
    val cardId: String,
    val name: String,
    val confidence: Double?,
)

/**
 * Diagnostics composed only from the public Android request/result boundary.
 * It deliberately does not infer detector gates, ANN thresholds, crop quality,
 * or internal fallback stages that the production result does not expose.
 */
@Serializable
data class ScannerBoundaryDecisionDiagnostics(
    val decision: ScannerBoundaryDecision,
    val requestedEngine: ScannerRecognitionEngine,
    val reportedEngine: String?,
    val source: String?,
    val elapsedMs: Double?,
    val candidates: List<ScannerBoundaryCandidateEvidence>,
    val topConfidence: Double?,
    val runnerUpConfidence: Double?,
    val observedConfidenceMargin: Double?,
    val recognizedText: String?,
    val recognizedQueries: List<String>,
    val serverDebugCaptureId: String?,
    val serverDebugError: String?,
    val failure: String?,
) {
    val explanation: String get() = when (decision) {
        ScannerBoundaryDecision.ARTWORK_MATCH ->
            "${reportedEngine ?: requestedEngine.displayName} returned ${candidates.size} artwork candidate(s)" + timingSuffix()
        ScannerBoundaryDecision.OCR_MATCH ->
            "On-device OCR produced ${recognizedQueries.size} searchable title candidate(s) and ${candidates.size} catalog candidate(s)" + timingSuffix()
        ScannerBoundaryDecision.NO_CANDIDATES ->
            "The production boundary completed without a card candidate" + timingSuffix()
        ScannerBoundaryDecision.FAILED -> "The production boundary failed: ${failure ?: "unknown error"}"
    }

    private fun timingSuffix() = elapsedMs?.let { " in ${it.toInt()} ms" }.orEmpty()

    companion object {
        fun from(request: AndroidScannerRequest, result: CardScanResult): ScannerBoundaryDecisionDiagnostics {
            val evidence = result.candidates.take(10).map {
                ScannerBoundaryCandidateEvidence(it.card.id, it.card.name, it.confidence)
            }
            val top = evidence.getOrNull(0)?.confidence
            val runnerUp = evidence.getOrNull(1)?.confidence
            val decision = when {
                evidence.isEmpty() -> ScannerBoundaryDecision.NO_CANDIDATES
                result.recognizedText != null || result.source.name == "ON_DEVICE_TEXT" -> ScannerBoundaryDecision.OCR_MATCH
                else -> ScannerBoundaryDecision.ARTWORK_MATCH
            }
            return ScannerBoundaryDecisionDiagnostics(
                decision = decision,
                requestedEngine = request.options.recognitionEngine,
                reportedEngine = result.engine,
                source = result.source.name,
                elapsedMs = result.elapsedMs,
                candidates = evidence,
                topConfidence = top,
                runnerUpConfidence = runnerUp,
                observedConfidenceMargin = if (top != null && runnerUp != null) top - runnerUp else null,
                recognizedText = result.recognizedText,
                recognizedQueries = result.recognizedText?.let(CardTitleExtractor::candidateQueries).orEmpty(),
                serverDebugCaptureId = result.debugCaptureId,
                serverDebugError = result.debugCaptureError,
                failure = null,
            )
        }

        fun failure(request: AndroidScannerRequest, message: String): ScannerBoundaryDecisionDiagnostics =
            ScannerBoundaryDecisionDiagnostics(
                decision = ScannerBoundaryDecision.FAILED,
                requestedEngine = request.options.recognitionEngine,
                reportedEngine = null,
                source = null,
                elapsedMs = null,
                candidates = emptyList(),
                topConfidence = null,
                runnerUpConfidence = null,
                observedConfidenceMargin = null,
                recognizedText = null,
                recognizedQueries = emptyList(),
                serverDebugCaptureId = null,
                serverDebugError = null,
                failure = message.take(500),
            )
    }
}

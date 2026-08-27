package com.ahmadjalil.tcger.data.scanner

import com.ahmadjalil.tcger.domain.CardScanResult
import java.text.Normalizer
import java.time.Instant
import java.util.UUID

sealed interface ScannerReferenceExpectation {
    data class Card(val id: String, val name: String? = null) : ScannerReferenceExpectation
    data class Negative(val reason: ScannerNegativeReferenceReason) : ScannerReferenceExpectation
    data object Unlabeled : ScannerReferenceExpectation
}

enum class ScannerNegativeReferenceReason { CARD_BACK, MULTIPLE_CARDS, FOREIGN_LANGUAGE, OUTSIDE_INDEX }

data class ScannerReferenceItem(
    val id: String,
    val name: String,
    val imageBytes: ByteArray,
    val game: String,
    val expectation: ScannerReferenceExpectation = ScannerReferenceExpectation.Unlabeled,
    val notes: String? = null,
    val baselineCardId: String? = null,
    val baselineConfidence: Double? = null,
)

data class ScannerReferenceSet(
    val id: String,
    val name: String,
    val items: List<ScannerReferenceItem>,
) {
    init { require(id.isNotBlank() && name.isNotBlank()) }

    companion object {
        fun fromRecording(id: String, name: String, recording: ImportedScannerRecording): ScannerReferenceSet =
            ScannerReferenceSet(
                id = id,
                name = name,
                items = recording.recording.frames.mapNotNull { frame ->
                    val bytes = recording.originalBytes(frame) ?: return@mapNotNull null
                    val expectation = when {
                        frame.expectedNoMatch == true -> ScannerReferenceExpectation.Negative(ScannerNegativeReferenceReason.OUTSIDE_INDEX)
                        frame.expectedCardId != null -> ScannerReferenceExpectation.Card(frame.expectedCardId, frame.bestMatchName)
                        else -> ScannerReferenceExpectation.Unlabeled
                    }
                    ScannerReferenceItem(
                        id = frame.capture?.captureId ?: frame.index.toString(),
                        name = frame.imageFile.ifBlank { "Frame ${frame.index}" },
                        imageBytes = bytes,
                        game = frame.mode,
                        expectation = expectation,
                        baselineCardId = frame.bestMatchCardId,
                        baselineConfidence = frame.confidence,
                    )
                },
            )
    }
}

enum class ScannerReferenceVerdict(val isFailure: Boolean) {
    CORRECT(false),
    WRONG_PRINTING(true),
    WRONG_CARD(true),
    MISSED(true),
    DECLINED(false),
    FALSE_POSITIVE(true),
    MATCHED(false),
    NO_MATCH(false),
}

data class ScannerReferenceOutcome(
    val item: ScannerReferenceItem,
    val verdict: ScannerReferenceVerdict,
    val diagnostics: ScannerBoundaryDecisionDiagnostics,
)

data class ScannerReferenceReport(
    val setId: String,
    val totalItems: Int,
    val processedItems: Int,
    val labeledPositiveItems: Int,
    val correctPositiveItems: Int,
    val wrongPrintingItems: Int,
    val wrongCardItems: Int,
    val missedItems: Int,
    val labeledNegativeItems: Int,
    val declinedNegativeItems: Int,
    val falsePositiveItems: Int,
    val unlabeledMatchedItems: Int,
    val unlabeledNoMatchItems: Int,
    val meanLatencyMs: Double,
    val p95LatencyMs: Double,
) {
    val positiveAccuracy: Double get() = if (labeledPositiveItems == 0) 0.0 else correctPositiveItems.toDouble() / labeledPositiveItems
    val negativeDeclineRate: Double get() = if (labeledNegativeItems == 0) 0.0 else declinedNegativeItems.toDouble() / labeledNegativeItems
}

data class ScannerReferenceRunSnapshot(
    val set: ScannerReferenceSet?,
    val isRunning: Boolean,
    val isAwaitingResult: Boolean,
    val currentIndex: Int,
    val outcomes: List<ScannerReferenceOutcome>,
    val report: ScannerReferenceReport?,
) {
    val completedCount: Int get() = outcomes.size
    val totalCount: Int get() = set?.items?.size ?: 0
}

/** Sequentially drives labeled images through the same callback used by live production scans. */
class ScannerReferenceSetRunner(
    private val requestHandler: AndroidScannerRequestHandler,
    private val capabilities: AndroidScannerCapabilities,
    private val now: () -> Instant = Instant::now,
) {
    private var set: ScannerReferenceSet? = null
    private var options = ScannerSessionOptions()
    private var currentIndex = 0
    private var awaiting = false
    private var running = false
    private var currentRequest: AndroidScannerRequest? = null
    private val outcomes = mutableListOf<ScannerReferenceOutcome>()

    @Synchronized
    fun start(referenceSet: ScannerReferenceSet, sessionOptions: ScannerSessionOptions): ScannerReferenceRunSnapshot {
        require(referenceSet.items.isNotEmpty()) { "Reference set has no replayable images" }
        check(!running) { "A reference run is already active" }
        set = referenceSet
        options = sessionOptions
        currentIndex = 0
        outcomes.clear()
        running = true
        submitCurrent()
        return snapshot()
    }

    @Synchronized
    fun accept(result: CardScanResult): ScannerReferenceRunSnapshot {
        check(running && awaiting) { "No reference result is pending" }
        val item = checkNotNull(set).items[currentIndex]
        val request = checkNotNull(currentRequest)
        outcomes += ScannerReferenceOutcome(item, judge(item.expectation, result), ScannerBoundaryDecisionDiagnostics.from(request, result))
        advance()
        return snapshot()
    }

    @Synchronized
    fun acceptFailure(message: String): ScannerReferenceRunSnapshot {
        check(running && awaiting) { "No reference result is pending" }
        val item = checkNotNull(set).items[currentIndex]
        val request = checkNotNull(currentRequest)
        outcomes += ScannerReferenceOutcome(item, judge(item.expectation, null), ScannerBoundaryDecisionDiagnostics.failure(request, message))
        advance()
        return snapshot()
    }

    @Synchronized
    fun cancel(): ScannerReferenceRunSnapshot {
        running = false
        awaiting = false
        currentRequest = null
        return snapshot()
    }

    @Synchronized
    fun snapshot(): ScannerReferenceRunSnapshot = ScannerReferenceRunSnapshot(
        set = set,
        isRunning = running,
        isAwaitingResult = awaiting,
        currentIndex = currentIndex,
        outcomes = outcomes.toList(),
        report = set?.takeIf { !running }?.let { buildReport(it.id, it.items.size, outcomes) },
    )

    private fun advance() {
        awaiting = false
        currentRequest = null
        currentIndex += 1
        if (currentIndex >= checkNotNull(set).items.size) running = false else submitCurrent()
    }

    private fun submitCurrent() {
        val item = checkNotNull(set).items[currentIndex]
        val effective = capabilities.normalize(options, item.game).copy(
            automaticallyShowResults = false,
            saveServerDebugCapture = false,
            recordAttemptImages = false,
        )
        val request = AndroidScannerRequest(
            imageBytes = item.imageBytes,
            game = item.game,
            options = effective,
            debugCapture = ScannerDebugCaptureMetadata(
                captureId = UUID.randomUUID().toString(),
                capturedAt = now().toString(),
                game = item.game,
                captureMode = effective.captureMode,
                triggerMode = effective.triggerMode,
                recognitionEngine = effective.recognitionEngine,
                encoderVariant = effective.encoderVariant,
                language = effective.language,
                imageByteCount = item.imageBytes.size,
                source = "android-reference-set",
                notes = item.notes,
                performance = effective.performance,
            ),
        )
        currentRequest = request
        awaiting = true
        requestHandler.scan(request)
    }

    companion object {
        fun judge(expectation: ScannerReferenceExpectation, result: CardScanResult?): ScannerReferenceVerdict {
            val top = result?.candidates?.firstOrNull()?.card
            return when (expectation) {
                ScannerReferenceExpectation.Unlabeled -> if (top == null) ScannerReferenceVerdict.NO_MATCH else ScannerReferenceVerdict.MATCHED
                is ScannerReferenceExpectation.Negative -> if (top == null) ScannerReferenceVerdict.DECLINED else ScannerReferenceVerdict.FALSE_POSITIVE
                is ScannerReferenceExpectation.Card -> when {
                    top == null -> ScannerReferenceVerdict.MISSED
                    top.id == expectation.id -> ScannerReferenceVerdict.CORRECT
                    expectation.name != null && normalizeName(top.name) == normalizeName(expectation.name) -> ScannerReferenceVerdict.WRONG_PRINTING
                    else -> ScannerReferenceVerdict.WRONG_CARD
                }
            }
        }

        fun buildReport(setId: String, totalItems: Int, outcomes: List<ScannerReferenceOutcome>): ScannerReferenceReport {
            val latencies = outcomes.mapNotNull { it.diagnostics.elapsedMs }.sorted()
            val positives = outcomes.filter { it.item.expectation is ScannerReferenceExpectation.Card }
            val negatives = outcomes.filter { it.item.expectation is ScannerReferenceExpectation.Negative }
            return ScannerReferenceReport(
                setId = setId,
                totalItems = totalItems,
                processedItems = outcomes.size,
                labeledPositiveItems = positives.size,
                correctPositiveItems = outcomes.count { it.verdict == ScannerReferenceVerdict.CORRECT },
                wrongPrintingItems = outcomes.count { it.verdict == ScannerReferenceVerdict.WRONG_PRINTING },
                wrongCardItems = outcomes.count { it.verdict == ScannerReferenceVerdict.WRONG_CARD },
                missedItems = outcomes.count { it.verdict == ScannerReferenceVerdict.MISSED },
                labeledNegativeItems = negatives.size,
                declinedNegativeItems = outcomes.count { it.verdict == ScannerReferenceVerdict.DECLINED },
                falsePositiveItems = outcomes.count { it.verdict == ScannerReferenceVerdict.FALSE_POSITIVE },
                unlabeledMatchedItems = outcomes.count { it.verdict == ScannerReferenceVerdict.MATCHED },
                unlabeledNoMatchItems = outcomes.count { it.verdict == ScannerReferenceVerdict.NO_MATCH },
                meanLatencyMs = if (latencies.isEmpty()) 0.0 else latencies.average(),
                p95LatencyMs = latencies.percentile95Reference(),
            )
        }

        private fun normalizeName(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .lowercase()
            .replace(Regex("[^a-z0-9]+"), "")
    }
}

private fun List<Double>.percentile95Reference(): Double {
    if (isEmpty()) return 0.0
    return this[(kotlin.math.ceil(size * 0.95).toInt() - 1).coerceIn(indices)]
}

package com.ahmadjalil.tcger.data.scanner

import java.time.Instant
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class ScannerDebugCaptureMetadata(
    val captureId: String,
    val capturedAt: String,
    val game: String,
    val captureMode: ScannerCaptureMode,
    val triggerMode: ScannerTriggerMode,
    val recognitionEngine: ScannerRecognitionEngine,
    val encoderVariant: ScannerEncoderVariant,
    val language: String,
    val imageByteCount: Int,
    val source: String,
    val notes: String? = null,
    val automaticallyShowResults: Boolean = false,
    val priceMode: ScannerPriceMode = ScannerPriceMode.OFF,
    val performance: Map<ScannerPerformanceOption, Boolean> = emptyMap(),
    val saveServerDebugCapture: Boolean = false,
    val recordAttemptImages: Boolean = false,
    val cropRescueEnabled: Boolean = false,
)

@Serializable
data class RecordedScannerFrame(
    val index: Int,
    val timestampSeconds: Double,
    val mode: String,
    val pipeline: String,
    val elapsedMs: Double,
    val detectedCount: Int = 0,
    val segmentationConfidence: Double? = null,
    val quad: List<List<Double>>? = null,
    val identified: Boolean,
    val bestMatchName: String? = null,
    val bestMatchCardId: String? = null,
    val bestMatchSetCode: String? = null,
    val bestMatchSetName: String? = null,
    val confidence: Double? = null,
    val strategy: String? = null,
    val alternatives: List<String> = emptyList(),
    val alternativeCardIds: List<String>? = null,
    val expectedCardId: String? = null,
    val expectedNoMatch: Boolean? = null,
    val imageFile: String = "",
    val attemptImages: List<ScannerAttemptImageReference> = emptyList(),
    val capture: ScannerDebugCaptureMetadata? = null,
    val decisionDiagnostics: ScannerBoundaryDecisionDiagnostics? = null,
)

@Serializable
data class ScannerRecordingSummary(
    val capturedAt: String,
    val frameCount: Int,
    val mode: String,
    val pipeline: String,
    val app: String = "TCGer Android Scanner Debug",
)

@Serializable
data class ScannerRecordingBundle(
    val summary: ScannerRecordingSummary,
    val frames: List<RecordedScannerFrame>,
    val formatVersion: Int = 1,
)

data class ScannerReplayReport(
    val totalFrames: Int,
    val processedFrames: Int,
    val stableFrames: Int,
    val topOneCorrectFrames: Int,
    val falsePositiveRegressions: Int,
    val missRegressions: Int,
    val meanLatencyMs: Double,
    val p95LatencyMs: Double,
)

fun interface ScannerReplayRecognizer {
    suspend fun recognize(frame: RecordedScannerFrame): RecordedScannerFrame?
}

object ScannerReplayRunner {
    suspend fun run(bundle: ScannerRecordingBundle, recognizer: ScannerReplayRecognizer): ScannerReplayReport {
        val comparisons = bundle.frames.mapNotNull { baseline ->
            recognizer.recognize(baseline)?.let { baseline to it }
        }
        return summarize(bundle.frames.size, comparisons)
    }

    fun summarize(
        totalFrames: Int,
        comparisons: List<Pair<RecordedScannerFrame, RecordedScannerFrame>>,
    ): ScannerReplayReport {
        val latencies = comparisons.map { it.second.elapsedMs }.sorted()
        return ScannerReplayReport(
            totalFrames = totalFrames,
            processedFrames = comparisons.size,
            stableFrames = comparisons.count { (before, after) -> before.bestMatchCardId == after.bestMatchCardId },
            topOneCorrectFrames = comparisons.count { (before, after) ->
                when {
                    before.expectedNoMatch == true -> after.bestMatchCardId == null
                    before.expectedCardId != null -> before.expectedCardId == after.bestMatchCardId
                    else -> before.bestMatchCardId == after.bestMatchCardId
                }
            },
            falsePositiveRegressions = comparisons.count { (before, after) -> before.expectedNoMatch == true && after.bestMatchCardId != null },
            missRegressions = comparisons.count { (before, after) -> before.expectedCardId != null && after.bestMatchCardId == null },
            meanLatencyMs = if (latencies.isNotEmpty()) latencies.average() else 0.0,
            p95LatencyMs = latencies.percentile95(),
        )
    }
}

class ScannerRollingRecorder(
    private val maxFrames: Int = 400,
    private val now: () -> Instant = Instant::now,
) {
    private val startedAt = now()
    private val frames = ArrayDeque<RecordedScannerFrame>()
    private val pendingCaptures = linkedMapOf<String, ScannerDebugCaptureMetadata>()
    private val pendingAttemptImages = mutableMapOf<String, List<ScannerAttemptImageReference>>()
    var isRecording: Boolean = false
        private set

    val frameCount: Int get() = frames.size

    fun start() { isRecording = true }
    fun pause() { isRecording = false }
    /** Clears recorder state and returns every retained image reference the caller may now delete. */
    fun clear(): List<ScannerAttemptImageReference> {
        val references = (frames.flatMap(RecordedScannerFrame::attemptImages) + pendingAttemptImages.values.flatten())
            .distinctBy(ScannerAttemptImageReference::fileName)
        frames.clear()
        pendingCaptures.clear()
        pendingAttemptImages.clear()
        return references
    }

    fun record(frame: RecordedScannerFrame) {
        if (!isRecording) return
        while (frames.size >= maxFrames) frames.removeFirst()
        frames.addLast(frame.copy(index = (frames.lastOrNull()?.index ?: 0) + 1))
    }

    fun recordCapture(metadata: ScannerDebugCaptureMetadata) {
        if (!isRecording) return
        while (pendingCaptures.size >= maxFrames) {
            val oldestId = pendingCaptures.keys.first()
            pendingCaptures.remove(oldestId)
            pendingAttemptImages.remove(oldestId)
        }
        pendingCaptures[metadata.captureId] = metadata
    }

    /** Returns false when the capture was cleared or evicted before asynchronous retention completed. */
    fun attachAttemptImages(captureId: String, images: List<ScannerAttemptImageReference>): Boolean {
        if (images.isEmpty()) return false
        val existing = frames.indexOfFirst { it.capture?.captureId == captureId }
        if (existing >= 0) {
            val updated = frames.toMutableList()
            updated[existing] = updated[existing].copy(
                imageFile = images.firstOrNull { it.kind == ScannerAttemptImageKind.ORIGINAL }?.fileName.orEmpty(),
                attemptImages = images,
            )
            frames.clear()
            frames.addAll(updated)
            return true
        } else if (pendingCaptures.containsKey(captureId)) {
            pendingAttemptImages[captureId] = images
            return true
        }
        return false
    }

    fun recordResult(frame: RecordedScannerFrame, captureId: String? = null) {
        if (!isRecording) return
        val capture = if (captureId != null) {
            pendingCaptures.remove(captureId)
        } else {
            pendingCaptures.entries.firstOrNull()?.let {
                pendingCaptures.remove(it.key)
                it.value
            }
        }
        val images = capture?.captureId?.let(pendingAttemptImages::remove).orEmpty()
        record(
            frame.copy(
                timestampSeconds = (now().toEpochMilli() - startedAt.toEpochMilli()) / 1_000.0,
                imageFile = images.firstOrNull { it.kind == ScannerAttemptImageKind.ORIGINAL }?.fileName.orEmpty(),
                attemptImages = images,
                capture = capture,
            ),
        )
    }

    fun snapshot(mode: String = "mixed", pipeline: String = "mixed"): ScannerRecordingBundle = ScannerRecordingBundle(
        summary = ScannerRecordingSummary(
            capturedAt = startedAt.toString(),
            frameCount = frames.size,
            mode = mode,
            pipeline = pipeline,
        ),
        frames = frames.toList(),
    )
}

object ScannerRecordingJson {
    val codec = Json {
        prettyPrint = true
        encodeDefaults = true
        ignoreUnknownKeys = true
    }

    fun encode(bundle: ScannerRecordingBundle): String = codec.encodeToString(bundle)
    fun decode(json: String): ScannerRecordingBundle = codec.decodeFromString(json)
}

private fun List<Double>.percentile95(): Double {
    if (isEmpty()) return 0.0
    val index = (kotlin.math.ceil(size * 0.95).toInt() - 1).coerceIn(indices)
    return this[index]
}

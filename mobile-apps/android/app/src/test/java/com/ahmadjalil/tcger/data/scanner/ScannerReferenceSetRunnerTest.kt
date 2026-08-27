package com.ahmadjalil.tcger.data.scanner

import com.ahmadjalil.tcger.domain.CardScanCandidate
import com.ahmadjalil.tcger.domain.CardScanResult
import com.ahmadjalil.tcger.domain.CardScanSource
import com.ahmadjalil.tcger.domain.CatalogCard
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ScannerReferenceSetRunnerTest {
    @Test
    fun referenceRunnerUsesProductionHandlerSequentiallyAndSeparatesDenominators() {
        val requests = mutableListOf<AndroidScannerRequest>()
        val runner = ScannerReferenceSetRunner(
            requestHandler = AndroidScannerRequestHandler { requests += it },
            capabilities = AndroidScannerCapabilities(serverConfigured = true, arcFaceRuntimeAvailable = true),
        )
        val set = ScannerReferenceSet(
            id = "labeled-set",
            name = "Labeled set",
            items = listOf(
                item("positive", ScannerReferenceExpectation.Card("card-a", "Pikachu")),
                item("negative", ScannerReferenceExpectation.Negative(ScannerNegativeReferenceReason.CARD_BACK)),
                item("unlabeled", ScannerReferenceExpectation.Unlabeled),
            ),
        )

        var snapshot = runner.start(set, ScannerSessionOptions())
        assertEquals(1, requests.size)
        assertEquals("android-reference-set", requests.single().debugCapture.source)
        assertTrue(snapshot.isAwaitingResult)

        snapshot = runner.accept(result("card-a", "Pikachu", 0.94, elapsedMs = 10.0))
        assertEquals(2, requests.size)
        assertEquals(ScannerReferenceVerdict.CORRECT, snapshot.outcomes.single().verdict)

        snapshot = runner.accept(result("card-b", "Raichu", 0.7, elapsedMs = 20.0))
        assertEquals(3, requests.size)
        assertEquals(ScannerReferenceVerdict.FALSE_POSITIVE, snapshot.outcomes.last().verdict)

        snapshot = runner.acceptFailure("No readable title")
        val report = requireNotNull(snapshot.report)
        assertFalse(snapshot.isRunning)
        assertEquals(3, report.processedItems)
        assertEquals(1, report.labeledPositiveItems)
        assertEquals(1, report.correctPositiveItems)
        assertEquals(1, report.labeledNegativeItems)
        assertEquals(1, report.falsePositiveItems)
        assertEquals(1, report.unlabeledNoMatchItems)
        assertEquals(15.0, report.meanLatencyMs, 0.001)
    }

    @Test
    fun verdictDistinguishesWrongPrintingFromWrongCard() {
        val expected = ScannerReferenceExpectation.Card("printing-a", "Flabébé")

        val printing = ScannerReferenceSetRunner.judge(expected, result("printing-b", "Flabebe", 0.8))
        val wrongCard = ScannerReferenceSetRunner.judge(expected, result("other", "Pikachu", 0.8))

        assertEquals(ScannerReferenceVerdict.WRONG_PRINTING, printing)
        assertEquals(ScannerReferenceVerdict.WRONG_CARD, wrongCard)
    }

    @Test
    fun boundaryDiagnosticsExposeObservedEvidenceWithoutInventingThresholds() {
        val request = request()
        val result = CardScanResult(
            candidates = listOf(
                candidate("a", "Pikachu", 0.91),
                candidate("b", "Raichu", 0.84),
            ),
            source = CardScanSource.ON_DEVICE_TEXT,
            recognizedText = "BASIC\nPikachu\nHP 60",
            engine = "on_device_ocr",
            elapsedMs = 42.0,
            debugCaptureId = "debug-1",
        )

        val diagnostics = ScannerBoundaryDecisionDiagnostics.from(request, result)

        assertEquals(ScannerBoundaryDecision.OCR_MATCH, diagnostics.decision)
        assertEquals(0.07, diagnostics.observedConfidenceMargin ?: 0.0, 0.0001)
        assertEquals(listOf("Pikachu"), diagnostics.recognizedQueries)
        assertEquals("debug-1", diagnostics.serverDebugCaptureId)
        assertTrue(diagnostics.explanation.contains("42 ms"))
    }

    @Test
    fun recordingReferenceSetUsesOnlyRetainedOriginalsAndHumanExpectations() {
        val reference = ScannerAttemptImageReference("session/original.jpg", ScannerAttemptImageKind.ORIGINAL, 10, 20)
        val frame = RecordedScannerFrame(
            index = 1,
            timestampSeconds = 0.0,
            mode = "pokemon",
            pipeline = "arcface",
            elapsedMs = 10.0,
            identified = true,
            bestMatchCardId = "baseline-only",
            expectedCardId = "human-label",
            imageFile = reference.fileName,
            attemptImages = listOf(reference),
        )
        val recording = ImportedScannerRecording(
            ScannerRecordingBundle(ScannerRecordingSummary("now", 1, "pokemon", "arcface"), listOf(frame)),
            mapOf(reference.fileName to byteArrayOf(1, 2, 3)),
        )

        val set = ScannerReferenceSet.fromRecording("set", "Set", recording)

        val expectation = set.items.single().expectation as ScannerReferenceExpectation.Card
        assertEquals("human-label", expectation.id)
        assertEquals("baseline-only", set.items.single().baselineCardId)
    }

    @Test
    fun warmStartIsSingleFlightAndOnlyCachesSuccessfulProductionPreparation() = runTest {
        var calls = 0
        var fail = true
        var clock = 0L
        val coordinator = ScannerWarmStartCoordinator(
            boundary = ScannerModelWarmStartBoundary {
                calls += 1
                if (fail) error("model unavailable")
            },
            nanoTime = { clock.also { clock += 2_000_000 } },
        )
        val options = ScannerSessionOptions()

        val failed = coordinator.prepare("pokemon", options)
        fail = false
        val prepared = coordinator.prepare("pokemon", options)
        val reused = coordinator.prepare("pokemon", options)

        assertFalse(failed.prepared)
        assertNotNull(failed.error)
        assertTrue(prepared.prepared)
        assertFalse(prepared.reused)
        assertTrue(reused.reused)
        assertEquals(2, calls)
    }

    @Test
    fun capabilitiesOnlyEnableWarmStartWhenSharedProductionBoundaryExists() {
        val absent = AndroidScannerCapabilities(serverConfigured = false)
        val connected = absent.copy(warmStartBoundaryAvailable = true)

        assertFalse(absent.performance(ScannerPerformanceOption.WARM_START).isAvailable)
        assertTrue(connected.performance(ScannerPerformanceOption.WARM_START).isAvailable)
        assertFalse(connected.performance(ScannerPerformanceOption.FOOTER_FIRST_OCR).isAvailable)
        assertTrue(connected.performance(ScannerPerformanceOption.FAST_CAPTURE).isAvailable)
    }

    private fun item(id: String, expectation: ScannerReferenceExpectation) = ScannerReferenceItem(
        id = id,
        name = "$id.jpg",
        imageBytes = byteArrayOf(1, 2, 3),
        game = "pokemon",
        expectation = expectation,
    )

    private fun result(id: String, name: String, confidence: Double, elapsedMs: Double? = null) = CardScanResult(
        candidates = listOf(candidate(id, name, confidence)),
        source = CardScanSource.ON_DEVICE_EMBEDDING,
        engine = "arcface",
        elapsedMs = elapsedMs,
    )

    private fun candidate(id: String, name: String, confidence: Double) = CardScanCandidate(
        CatalogCard(id = id, name = name, tcg = "pokemon"),
        confidence,
    )

    private fun request(): AndroidScannerRequest {
        val options = ScannerSessionOptions(recognitionEngine = ScannerRecognitionEngine.ON_DEVICE_OCR)
        return AndroidScannerRequest(
            imageBytes = byteArrayOf(1),
            game = "pokemon",
            options = options,
            debugCapture = ScannerDebugCaptureMetadata(
                captureId = "capture",
                capturedAt = "2026-08-26T12:00:00Z",
                game = "pokemon",
                captureMode = options.captureMode,
                triggerMode = options.triggerMode,
                recognitionEngine = options.recognitionEngine,
                encoderVariant = options.encoderVariant,
                language = options.language,
                imageByteCount = 1,
                source = "test",
            ),
        )
    }
}

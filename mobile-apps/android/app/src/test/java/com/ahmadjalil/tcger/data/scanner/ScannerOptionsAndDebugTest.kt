package com.ahmadjalil.tcger.data.scanner

import java.time.Instant
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScannerOptionsAndDebugTest {
    @Test
    fun invalidImportedLanguageFallsBackToEnglish() {
        val capabilities = AndroidScannerCapabilities(serverConfigured = false)

        val normalized = capabilities.normalize(
            ScannerSessionOptions(language = "Klingon"),
            "pokemon",
        )

        assertEquals("English", normalized.language)
    }

    @Test
    fun developerModeAlwaysRetainsTrainingInputEvidence() {
        val effective = ScannerSessionOptions(
            devModeRecordingEnabled = true,
            recordAttemptImages = false,
        ).withRequiredTrainingEvidence()

        assertTrue(effective.recordAttemptImages)
        assertFalse(ScannerSessionOptions().withRequiredTrainingEvidence().recordAttemptImages)
    }

    @Test
    fun demoBinderInputHasOneDeterministicLabelPerPocket() {
        assertEquals(9, ScannerDemoInputs.binderLabels().size)
        assertEquals("Pikachu", ScannerDemoInputs.binderLabels().first())
    }

    @Test
    fun optionsJsonRoundTripIncludesEveryPerformanceToggle() {
        val original = ScannerSessionOptions(
            triggerMode = ScannerTriggerMode.AUTOMATIC,
            automaticallyShowResults = true,
            language = "Japanese",
            recognitionEngine = ScannerRecognitionEngine.SERVER_EMBEDDING,
            encoderVariant = ScannerEncoderVariant.DINOV2,
            performance = ScannerPerformanceOption.entries.associateWith { it.ordinal % 2 == 0 },
        )

        val decoded = ScannerOptionsJson.decode(ScannerOptionsJson.encode(original))

        assertEquals(original, decoded)
        assertEquals(ScannerPerformanceOption.entries.size, decoded.performance.size)
    }

    @Test
    fun optionsJsonAcceptsOlderMissingFieldsAndFutureObjectFields() {
        val decoded = ScannerOptionsJson.decode(
            """{"language":"Japanese","automaticallyShowResults":true,"futureOption":{"enabled":true}}""",
        )

        assertEquals("Japanese", decoded.language)
        assertTrue(decoded.automaticallyShowResults)
        assertEquals(ScannerCaptureMode.CARD, decoded.captureMode)
        assertEquals(ScannerRecognitionEngine.AUTOMATIC, decoded.recognitionEngine)
        assertEquals(ScannerPerformanceOption.entries.size, decoded.performance.size)
    }

    @Test
    fun unavailableOptionsNormalizeToExecutableAndroidPaths() {
        val capabilities = AndroidScannerCapabilities.OnDeviceOnly
        val requested = ScannerSessionOptions(
            captureMode = ScannerCaptureMode.BINDER,
            triggerMode = ScannerTriggerMode.AUTOMATIC,
            priceMode = ScannerPriceMode.SESSION_MARKET,
            recognitionEngine = ScannerRecognitionEngine.SERVER_PHASH,
        )

        val normalized = capabilities.normalize(requested, "pokemon")

        assertEquals(ScannerCaptureMode.CARD, normalized.captureMode)
        assertEquals(ScannerTriggerMode.AUTOMATIC, normalized.triggerMode)
        assertEquals(ScannerPriceMode.OFF, normalized.priceMode)
        assertEquals(ScannerRecognitionEngine.AUTOMATIC, normalized.recognitionEngine)
        assertFalse(capabilities.encoder(ScannerEncoderVariant.ARCFACE).isAvailable)
        assertFalse(capabilities.encoder(ScannerEncoderVariant.DINOV2).isAvailable)
    }

    @Test
    fun guidedBinderModeIsExecutableManualOnlyAndDoesNotInventPagePhotoPersistence() {
        val capabilities = AndroidScannerCapabilities(
            serverConfigured = false,
            binderPageDetectorAvailable = true,
        )
        val normalized = capabilities.normalize(
            ScannerSessionOptions(
                captureMode = ScannerCaptureMode.BINDER,
                triggerMode = ScannerTriggerMode.AUTOMATIC,
            ),
            "pokemon",
        )

        assertEquals(ScannerCaptureMode.BINDER, normalized.captureMode)
        assertEquals(ScannerTriggerMode.MANUAL, normalized.triggerMode)
        assertFalse(normalized.savesBinderPageImages)
        assertTrue(capabilities.captureMode(ScannerCaptureMode.BINDER).explanation.contains("Guided"))
    }

    @Test
    fun serverEmbeddingIsCapabilityGatedByGame() {
        val capabilities = AndroidScannerCapabilities(serverConfigured = true)

        assertTrue(capabilities.engine(ScannerRecognitionEngine.SERVER_EMBEDDING, "pokemon").isAvailable)
        assertFalse(capabilities.engine(ScannerRecognitionEngine.SERVER_EMBEDDING, "magic").isAvailable)
        assertTrue(capabilities.engine(ScannerRecognitionEngine.SERVER_PHASH, "magic").isAvailable)
    }

    @Test
    fun installedDinoBundleKeepsPickerSelectionExecutable() {
        val capabilities = AndroidScannerCapabilities(
            serverConfigured = false,
            arcFaceRuntimeAvailable = true,
            dinoV2RuntimeAvailable = true,
        )
        val requested = ScannerSessionOptions(
            recognitionEngine = ScannerRecognitionEngine.ON_DEVICE_OCR,
            encoderVariant = ScannerEncoderVariant.DINOV2,
        )

        assertTrue(capabilities.encoder(ScannerEncoderVariant.DINOV2).isAvailable)
        assertEquals(ScannerEncoderVariant.DINOV2, capabilities.normalize(requested, "pokemon").encoderVariant)
    }

    @Test
    fun automaticConsensusRequiresTwoMatchesAndLocksUntilCardLeaves() {
        val consensus = AutoScanConsensus(requiredMatches = 2)

        val first = consensus.observe("card-a", "Pikachu")
        val confirmed = consensus.observe("card-a", "Pikachu")
        val locked = consensus.observe("card-a", "Pikachu")
        consensus.observe(null, null)
        val afterLeaving = consensus.observe("card-a", "Pikachu")

        assertEquals(1, first.count)
        assertFalse(first.confirmed)
        assertTrue(confirmed.confirmed)
        assertTrue(locked.locked)
        assertFalse(locked.confirmed)
        assertEquals(1, afterLeaving.count)
    }

    @Test
    fun automaticConsensusResetsWhenCandidateChanges() {
        val consensus = AutoScanConsensus(requiredMatches = 2)
        consensus.observe("card-a", "Pikachu")

        val changed = consensus.observe("card-b", "Raichu")

        assertEquals("card-b", changed.candidateId)
        assertEquals(1, changed.count)
        assertFalse(changed.confirmed)
    }

    @Test
    fun serverAutomaticIntervalsAreBoundedToAvoidRequestSpam() {
        val requestedFast = ScannerSessionOptions(
            triggerMode = ScannerTriggerMode.AUTOMATIC,
            recognitionEngine = ScannerRecognitionEngine.SERVER_PHASH,
            analysisIntervalMillis = 500,
        )
        val local = requestedFast.copy(recognitionEngine = ScannerRecognitionEngine.ON_DEVICE_OCR)

        assertEquals(2_500L, requestedFast.boundedAutomaticIntervalMillis(serverConfigured = true))
        assertEquals(750L, local.boundedAutomaticIntervalMillis(serverConfigured = false))
    }

    @Test
    fun persistentSessionRoundTripsSelectionAndCardMetadata() {
        val entry = ScannerSessionEntry(
            id = "scan-1",
            cardId = "card-1",
            name = "Pikachu",
            game = "pokemon",
            setCode = "base1",
            collectorNumber = "58/102",
            confidence = 0.94,
            source = "SERVER_IMAGE_MATCH",
            scannedAt = "2026-08-26T12:00:00Z",
            selected = false,
            price = 12.34,
            currency = "CAD",
            priceSource = "tcgplayer",
        )

        val decoded = ScannerSessionJson.decode(ScannerSessionJson.encode(listOf(entry))).single()

        assertEquals(entry, decoded)
        assertEquals("card-1", decoded.toCatalogCard().id)
        assertFalse(decoded.selected)
        assertEquals(12.34, decoded.price!!, 0.001)
        assertEquals("CAD", decoded.currency)
    }

    @Test
    fun developerToolsUnlockOnlyAfterSevenTaps() {
        val counter = DeveloperUnlockCounter(requiredTaps = 7)

        repeat(6) { assertFalse(counter.tap(alreadyUnlocked = false).unlocked) }
        val unlocked = counter.tap(alreadyUnlocked = false)

        assertTrue(unlocked.unlocked)
        assertEquals(0, unlocked.remaining)
        counter.reset()
        assertEquals(6, counter.tap(alreadyUnlocked = false).remaining)
    }

    @Test
    fun priceParserRejectsInvalidQuotesAndPrefersLiveQuote() {
        val json = """
            [
              {"source":"last-known","price":8.0,"currency":"USD","isFallback":true},
              {"source":"tcgplayer","price":9.5,"currency":"USD"},
              {"source":"broken","price":0,"currency":"USD"}
            ]
        """.trimIndent()

        val quotes = ScannerPriceJson.decodeQuotes(json)
        val preferred = ScannerPriceJson.preferredQuote(json)

        assertEquals(2, quotes.size)
        assertEquals("tcgplayer", preferred?.source)
        assertEquals(9.5, preferred?.price ?: 0.0, 0.001)
    }

    @Test
    fun recordingSessionIdsRejectPathTraversal() {
        assertTrue(ScannerRecordingSessionStore.validId("android-1234-abcd"))
        assertFalse(ScannerRecordingSessionStore.validId("../scanner"))
        assertFalse(ScannerRecordingSessionStore.validId("nested/session"))
    }

    @Test
    fun rollingRecorderDropsOldestFrameAndRoundTrips() {
        val recorder = ScannerRollingRecorder(maxFrames = 2, now = { Instant.parse("2026-08-26T12:00:00Z") })
        recorder.start()
        repeat(3) { index ->
            recorder.record(
                RecordedScannerFrame(
                    index = index,
                    timestampSeconds = index.toDouble(),
                    mode = "pokemon",
                    pipeline = "automatic",
                    elapsedMs = 10.0 + index,
                    identified = true,
                    bestMatchCardId = "card-$index",
                ),
            )
        }

        val bundle = recorder.snapshot("pokemon", "automatic")
        val decoded = ScannerRecordingJson.decode(ScannerRecordingJson.encode(bundle))

        assertEquals(2, decoded.frames.size)
        assertEquals("card-1", decoded.frames.first().bestMatchCardId)
        assertEquals("card-2", decoded.frames.last().bestMatchCardId)
        assertEquals(2, decoded.summary.frameCount)
    }

    @Test
    fun recordingJsonPreservesStructuredDecisionEvidence() {
        val diagnostics = ScannerBoundaryDecisionDiagnostics(
            decision = ScannerBoundaryDecision.ARTWORK_MATCH,
            requestedEngine = ScannerRecognitionEngine.ON_DEVICE_OCR,
            reportedEngine = "arcface",
            source = "ON_DEVICE_EMBEDDING",
            elapsedMs = 17.5,
            candidates = listOf(ScannerBoundaryCandidateEvidence("card-1", "Pikachu", 0.91)),
            topConfidence = 0.91,
            runnerUpConfidence = null,
            observedConfidenceMargin = null,
            recognizedText = null,
            recognizedQueries = emptyList(),
            serverDebugCaptureId = null,
            serverDebugError = null,
            failure = null,
        )
        val bundle = ScannerRecordingBundle(
            ScannerRecordingSummary("2026-08-26T12:00:00Z", 1, "pokemon", "arcface"),
            listOf(frame(1, "card-1", elapsed = 17.5).copy(decisionDiagnostics = diagnostics)),
        )

        val decoded = ScannerRecordingJson.decode(ScannerRecordingJson.encode(bundle))

        assertEquals(ScannerBoundaryDecision.ARTWORK_MATCH, decoded.frames.single().decisionDiagnostics?.decision)
        assertEquals(0.91, decoded.frames.single().decisionDiagnostics?.topConfidence ?: 0.0, 0.0001)
    }

    @Test
    fun captureMetadataIsAttachedToOneResultFrameWithoutDoubleCounting() {
        val recorder = ScannerRollingRecorder(now = { Instant.parse("2026-08-26T12:00:00Z") })
        recorder.start()
        recorder.recordCapture(
            ScannerDebugCaptureMetadata(
                captureId = "capture-1",
                capturedAt = "2026-08-26T12:00:00Z",
                game = "pokemon",
                captureMode = ScannerCaptureMode.CARD,
                triggerMode = ScannerTriggerMode.MANUAL,
                recognitionEngine = ScannerRecognitionEngine.AUTOMATIC,
                encoderVariant = ScannerEncoderVariant.ARCFACE,
                language = "English",
                imageByteCount = 123,
                source = "camera",
            ),
        )
        assertEquals(0, recorder.frameCount)

        recorder.recordResult(frame(0, "card-1", elapsed = 18.0))
        val recorded = recorder.snapshot().frames.single()

        assertEquals(1, recorder.frameCount)
        assertEquals("capture-1", recorded.capture?.captureId)
        assertEquals("", recorded.imageFile)
        assertTrue(recorded.attemptImages.isEmpty())
    }

    @Test
    fun attemptImagesAttachBeforeOrAfterRecognitionWithoutInventingFiles() {
        val recorder = ScannerRollingRecorder(now = { Instant.parse("2026-08-26T12:00:00Z") })
        recorder.start()
        val metadata = capture("capture-1")
        val images = listOf(
            ScannerAttemptImageReference("session/capture-1-original.jpg", ScannerAttemptImageKind.ORIGINAL, 1200, 1600),
            ScannerAttemptImageReference("session/capture-1-card-crop.jpg", ScannerAttemptImageKind.CARD_CROP, 800, 1120),
        )
        recorder.recordCapture(metadata)
        recorder.attachAttemptImages(metadata.captureId, images)
        recorder.recordResult(frame(0, "card-1", elapsed = 18.0))
        assertEquals(images, recorder.snapshot().frames.single().attemptImages)

        recorder.recordCapture(capture("capture-2"))
        recorder.recordResult(frame(0, "card-2", elapsed = 20.0))
        val later = listOf(ScannerAttemptImageReference("session/capture-2-original.jpg", ScannerAttemptImageKind.ORIGINAL, 1200, 1600))
        recorder.attachAttemptImages("capture-2", later)
        assertEquals(later, recorder.snapshot().frames.last().attemptImages)
        assertEquals("session/capture-2-original.jpg", recorder.snapshot().frames.last().imageFile)
    }

    @Test
    fun recordingResultsMatchCaptureIdsInsteadOfCompletionOrder() {
        val recorder = ScannerRollingRecorder(now = { Instant.parse("2026-08-26T12:00:00Z") })
        recorder.start()
        recorder.recordCapture(capture("capture-1"))
        recorder.recordCapture(capture("capture-2"))

        recorder.recordResult(frame(0, "card-2", elapsed = 20.0), "capture-2")
        recorder.recordResult(frame(0, "card-1", elapsed = 10.0), "capture-1")

        assertEquals("capture-2", recorder.snapshot().frames[0].capture?.captureId)
        assertEquals("capture-1", recorder.snapshot().frames[1].capture?.captureId)
    }

    @Test
    fun unknownExplicitCaptureIdDoesNotConsumeAnotherPendingCapture() {
        val recorder = ScannerRollingRecorder(now = { Instant.parse("2026-08-26T12:00:00Z") })
        recorder.start()
        recorder.recordCapture(capture("capture-1"))

        recorder.recordResult(frame(0, "batch-result", elapsed = 20.0), "not-recorded")
        recorder.recordResult(frame(0, "card-1", elapsed = 10.0), "capture-1")

        assertEquals(null, recorder.snapshot().frames[0].capture)
        assertEquals("capture-1", recorder.snapshot().frames[1].capture?.captureId)
    }

    @Test
    fun clearReturnsPendingImagesAndRejectsLateAsyncAttachments() {
        val recorder = ScannerRollingRecorder(now = { Instant.parse("2026-08-26T12:00:00Z") })
        recorder.start()
        recorder.recordCapture(capture("capture-1"))
        val images = listOf(
            ScannerAttemptImageReference("session/capture-1-original.jpg", ScannerAttemptImageKind.ORIGINAL, 1200, 1600),
        )
        assertTrue(recorder.attachAttemptImages("capture-1", images))

        assertEquals(images, recorder.clear())
        assertFalse(recorder.attachAttemptImages("capture-1", images))
        assertTrue(recorder.snapshot().frames.isEmpty())
    }

    @Test
    fun canonicalCropIsCenteredBoundedAndCardShaped() {
        val portrait = canonicalScannerCrop(1200, 1600)
        val landscape = canonicalScannerCrop(1600, 900)

        assertEquals(600, (portrait.left + portrait.right) / 2)
        assertEquals(800, (portrait.top + portrait.bottom) / 2)
        assertTrue(portrait.left >= 0 && portrait.right <= 1200 && portrait.top >= 0 && portrait.bottom <= 1600)
        assertTrue(landscape.left >= 0 && landscape.right <= 1600 && landscape.top >= 0 && landscape.bottom <= 900)
        assertEquals(0.714, portrait.width.toDouble() / portrait.height, 0.002)
        assertEquals(0.714, landscape.width.toDouble() / landscape.height, 0.002)
    }

    @Test
    fun portableRecordingArchiveRoundTripsJpegsAndAcceptsLegacyMetadataOnlyJson() {
        val reference = ScannerAttemptImageReference("session/capture-original.jpg", ScannerAttemptImageKind.ORIGINAL, 10, 20)
        val bundle = ScannerRecordingBundle(
            ScannerRecordingSummary("2026-08-26T12:00:00Z", 1, "pokemon", "automatic"),
            listOf(frame(1, "card-1", elapsed = 12.0).copy(imageFile = reference.fileName, attemptImages = listOf(reference))),
        )
        val jpeg = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 1, 2, 0xFF.toByte(), 0xD9.toByte())

        val decoded = ScannerRecordingArchiveJson.decode(ScannerRecordingArchiveJson.encode(bundle) { jpeg })
        val legacy = ScannerRecordingArchiveJson.decode(ScannerRecordingJson.encode(bundle))

        assertArrayEquals(jpeg, decoded.originalBytes(decoded.recording.frames.single()))
        assertEquals(1, decoded.replayableFrameCount)
        assertEquals(0, legacy.replayableFrameCount)
        assertFalse(ScannerAttemptImageStore.validRelativeName("../capture.jpg"))
    }

    @Test(expected = IllegalArgumentException::class)
    fun recordingArchiveRejectsUnsupportedFutureFormatVersions() {
        val bundle = ScannerRecordingBundle(
            ScannerRecordingSummary("2026-08-26T12:00:00Z", 1, "pokemon", "automatic"),
            listOf(frame(1, "card-1", elapsed = 12.0)),
            formatVersion = 2,
        )

        ScannerRecordingArchiveJson.decode(ScannerRecordingJson.encode(bundle))
    }

    @Test(expected = IllegalArgumentException::class)
    fun portableExportDoesNotSilentlyDropMissingAttemptImages() {
        val reference = ScannerAttemptImageReference("session/missing-original.jpg", ScannerAttemptImageKind.ORIGINAL, 10, 20)
        val bundle = ScannerRecordingBundle(
            ScannerRecordingSummary("2026-08-26T12:00:00Z", 1, "pokemon", "automatic"),
            listOf(frame(1, "card-1", elapsed = 12.0).copy(attemptImages = listOf(reference))),
        )

        ScannerRecordingArchiveJson.encode(bundle) { null }
    }

    @Test
    fun liveDebugLogOnlyObservesWhileRunningAndIsBounded() {
        val log = ScannerLiveDebugLog(maxEvents = 3, now = { Instant.parse("2026-08-26T12:00:00Z") })
        log.record("ignored")
        log.start()
        log.record("capture one")
        log.record("result one")
        log.record("capture two")
        log.stop()
        log.record("ignored after stop")

        assertEquals(3, log.snapshot().size)
        assertEquals("result one", log.snapshot().first().message)
        assertEquals("Live pipeline observation stopped", log.snapshot().last().message)
        log.clear()
        assertTrue(log.snapshot().isEmpty())
    }

    @Test
    fun replayReportUsesExpectedLabelsAndLatency() = runTest {
        val frames = listOf(
            frame(1, "a", expected = "a", elapsed = 20.0),
            frame(2, null, expectsNoMatch = true, elapsed = 40.0),
        )
        val bundle = ScannerRecordingBundle(
            ScannerRecordingSummary("2026-08-26T12:00:00Z", 2, "pokemon", "automatic"),
            frames,
        )

        val report = ScannerReplayRunner.run(bundle) { baseline -> baseline.copy(elapsedMs = baseline.elapsedMs + 5) }

        assertEquals(2, report.processedFrames)
        assertEquals(2, report.stableFrames)
        assertEquals(2, report.topOneCorrectFrames)
        assertEquals(35.0, report.meanLatencyMs, 0.001)
        assertEquals(45.0, report.p95LatencyMs, 0.001)
    }

    private fun frame(
        index: Int,
        id: String?,
        expected: String? = null,
        expectsNoMatch: Boolean? = null,
        elapsed: Double,
    ) = RecordedScannerFrame(
        index = index,
        timestampSeconds = index.toDouble(),
        mode = "pokemon",
        pipeline = "automatic",
        elapsedMs = elapsed,
        identified = id != null,
        bestMatchCardId = id,
        expectedCardId = expected,
        expectedNoMatch = expectsNoMatch,
    )

    private fun capture(id: String) = ScannerDebugCaptureMetadata(
        captureId = id,
        capturedAt = "2026-08-26T12:00:00Z",
        game = "pokemon",
        captureMode = ScannerCaptureMode.CARD,
        triggerMode = ScannerTriggerMode.MANUAL,
        recognitionEngine = ScannerRecognitionEngine.AUTOMATIC,
        encoderVariant = ScannerEncoderVariant.ARCFACE,
        language = "English",
        imageByteCount = 123,
        source = "camera",
    )
}

import UIKit
import XCTest
@testable import TCGer

@MainActor
final class ScannerDevModeStoreTests: XCTestCase {
    override func setUp() {
        super.setUp()
        UserDefaults.standard.set(true, forKey: ScannerDevModeStore.enabledDefaultsKey)
        UserDefaults.standard.removeObject(forKey: ScannerDevModeStore.cropRescueEnabledDefaultsKey)
        UserDefaults.standard.removeObject(forKey: ScannerDevModeStore.attemptImagesDefaultsKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: ScannerDevModeStore.enabledDefaultsKey)
        UserDefaults.standard.removeObject(forKey: ScannerDevModeStore.cropRescueEnabledDefaultsKey)
        UserDefaults.standard.removeObject(forKey: ScannerDevModeStore.attemptImagesDefaultsKey)
        try? FileManager.default.removeItem(at: ScannerDevModeStore.rootDirectory())
        super.tearDown()
    }

    func testRecordWritesReplayableBundleAndEvidenceSidecar() async throws {
        let diagnostics = ScanDiagnostics()
        let attemptImage = ScannerTestImage.solid(width: 72, height: 100)
        let imageIndex = diagnostics.registerAttemptImage(attemptImage)
        diagnostics.record(ScanDiagnostics.Attempt(
            kind: .detectedCrop,
            quad: [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]],
            gateScore: 0.62,
            gateThreshold: 0.45,
            topCandidates: [
                ScanDiagnostics.Candidate(cardID: "swsh9-132", name: "Boss's Orders", similarity: 0.94),
            ],
            titleMatchedName: nil,
            titlePrintingCount: nil,
            footerPairNumbers: ["132/172"],
            ocrVerifiedCollectorNumber: nil,
            outcome: .accepted,
            imageIndex: imageIndex
        ))

        await ScannerDevModeStore.shared.record(
            image: ScannerTestImage.solid(width: 90, height: 120),
            source: .importedPhoto,
            mode: .pokemon,
            elapsedMs: 123,
            result: .failure(.noMatch),
            diagnostics: diagnostics,
            originalImage: ScannerTestImage.solid(width: 120, height: 160),
            outcomeLabel: "binderPage: 1 detections, 1 matched",
            captureMode: .binder,
            binderDetections: [
                RecordedBinderDetection(
                    pocketIndex: 0,
                    status: BinderCardDetectionStatus.matched.rawValue,
                    includedByDefault: true,
                    quad: [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]],
                    selectedCardID: "swsh9-132",
                    selectedCardName: "Boss's Orders",
                    selectedSetCode: "SWSH9",
                    confidence: 0.94,
                    alternativeCardIDs: []
                ),
            ]
        )

        let sessions = ScannerDevModeStore.listSessions()
        let session = try XCTUnwrap(sessions.first, "recording should create a session")
        XCTAssertGreaterThanOrEqual(session.frameCount, 1)

        // The session must decode with the exact schema the reference
        // browser and replay runner consume.
        let bundleData = try Data(contentsOf: session.url.appendingPathComponent("results.json"))
        let bundle = try JSONDecoder().decode(RecordedScanBundle.self, from: bundleData)
        let frame = try XCTUnwrap(bundle.frames.last)
        XCTAssertFalse(frame.identified)
        XCTAssertEqual(frame.detectedCount, 1)
        XCTAssertEqual(frame.captureMode, ScannerCaptureMode.binder.rawValue)
        XCTAssertEqual(frame.binderDetections?.first?.selectedCardID, "swsh9-132")
        XCTAssertNotNil(frame.quad)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: session.url.appendingPathComponent(frame.imageFile).path),
            "raw frame image must exist next to results.json"
        )

        let evidenceData = try Data(contentsOf: session.url.appendingPathComponent("evidence.json"))
        let evidence = try JSONDecoder().decode([ScanEvidenceRecord].self, from: evidenceData)
        let record = try XCTUnwrap(evidence.last)
        XCTAssertEqual(record.imageFile, frame.imageFile)
        XCTAssertEqual(record.source, "importedPhoto")
        XCTAssertEqual(record.captureMode, ScannerCaptureMode.binder.rawValue)
        XCTAssertEqual(record.outcome, "binderPage: 1 detections, 1 matched")
        let originalFile = try XCTUnwrap(record.originalImageFile)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: session.url.appendingPathComponent(originalFile).path),
            "the unprocessed original image must be saved alongside the pipeline input"
        )
        XCTAssertEqual(record.attempts.count, 1)
        XCTAssertEqual(record.attempts[0].outcome, .accepted)
        XCTAssertEqual(record.attempts[0].footerPairNumbers, ["132/172"])
        XCTAssertEqual(record.imageMetadata?.pixelWidth, 90)
        XCTAssertEqual(record.imageMetadata?.pixelHeight, 120)
        XCTAssertEqual(record.imageMetadata?.pixelOrientation, "up")
        XCTAssertEqual(record.imageMetadata?.semanticOrientation, .unverified)
        XCTAssertEqual(record.originalImageMetadata?.pixelWidth, 120)
        XCTAssertEqual(record.originalImageMetadata?.pixelHeight, 160)
        // Attempt crops are re-derivable from the recorded geometry, so no
        // JPEGs are written by default and the manifest lists none.
        XCTAssertTrue(record.attemptImageFiles.isEmpty)
        XCTAssertFalse(
            FileManager.default.fileExists(
                atPath: session.url.appendingPathComponent("frame-0000-attempt-0.jpg").path
            ),
            "attempt crop images are opt-in and must not be written by default"
        )
    }

    func testMixedGameSessionSummaryPreservesEveryModeAndCaptureMode() async throws {
        let image = ScannerTestImage.solid(width: 90, height: 120)
        await ScannerDevModeStore.shared.record(
            image: image,
            source: .photoCapture,
            mode: .mtg,
            elapsedMs: 1,
            result: .failure(.noMatch),
            diagnostics: nil,
            captureMode: .card
        )
        await ScannerDevModeStore.shared.record(
            image: image,
            source: .photoCapture,
            mode: .pokemon,
            elapsedMs: 2,
            result: nil,
            diagnostics: nil,
            outcomeLabel: "binderPage: 0 detections, 0 matched",
            captureMode: .binder,
            binderDetections: []
        )

        let session = try XCTUnwrap(ScannerDevModeStore.listSessions().first)
        let bundle = try JSONDecoder().decode(
            RecordedScanBundle.self,
            from: Data(contentsOf: session.url.appendingPathComponent("results.json"))
        )

        XCTAssertEqual(bundle.summary.mode, "mixed")
        XCTAssertEqual(bundle.summary.modes ?? [], ["mtg", "pokemon"])
        XCTAssertEqual(bundle.summary.captureModes ?? [], ["card", "binder"])
        XCTAssertEqual(bundle.frames.map(\.mode), ["mtg", "pokemon"])
        XCTAssertEqual(bundle.frames.compactMap(\.captureMode), ["card", "binder"])
    }

    func testAttemptImageEscapeHatchRestoresAttemptCropFiles() async throws {
        UserDefaults.standard.set(true, forKey: ScannerDevModeStore.attemptImagesDefaultsKey)
        let diagnostics = ScanDiagnostics()
        let imageIndex = diagnostics.registerAttemptImage(
            ScannerTestImage.solid(width: 72, height: 100)
        )
        diagnostics.record(ScanDiagnostics.Attempt(
            kind: .detectedCrop,
            quad: [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]],
            gateScore: 0.62,
            gateThreshold: 0.45,
            topCandidates: [],
            titleMatchedName: nil,
            titlePrintingCount: nil,
            footerPairNumbers: [],
            ocrVerifiedCollectorNumber: nil,
            outcome: .accepted,
            imageIndex: imageIndex
        ))

        await ScannerDevModeStore.shared.record(
            image: ScannerTestImage.solid(width: 90, height: 120),
            source: .importedPhoto,
            mode: .pokemon,
            elapsedMs: 12,
            result: .failure(.noMatch),
            diagnostics: diagnostics
        )

        let session = try XCTUnwrap(ScannerDevModeStore.listSessions().first)
        let evidence = try JSONDecoder().decode(
            [ScanEvidenceRecord].self,
            from: Data(contentsOf: session.url.appendingPathComponent("evidence.json"))
        )
        let record = try XCTUnwrap(evidence.last)
        XCTAssertEqual(record.attemptImageFiles.count, 1)
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: session.url.appendingPathComponent(record.attemptImageFiles[0]).path
            ),
            "the escape hatch must restore attempt crop JPEG writing"
        )
    }

    func testLegacyAttemptDecodesWithoutBinderOrOrientationMetadata() throws {
        let legacy = #"""
        {
          "kind": "detectedCrop",
          "quad": [[0.1, 0.9], [0.9, 0.9], [0.9, 0.1], [0.1, 0.1]],
          "gateScore": 0.62,
          "gateThreshold": 0.45,
          "topCandidates": [],
          "titleMatchedName": null,
          "titlePrintingCount": null,
          "footerPairNumbers": [],
          "ocrVerifiedCollectorNumber": null,
          "outcome": "accepted",
          "imageIndex": 0
        }
        """#.data(using: .utf8)!

        let attempt = try JSONDecoder().decode(ScanDiagnostics.Attempt.self, from: legacy)

        XCTAssertEqual(attempt.outcome, .accepted)
        XCTAssertNil(attempt.pocketIndex)
        XCTAssertNil(attempt.binderPolicyReason)
        XCTAssertNil(attempt.nativeCropPixelWidth)
        XCTAssertNil(attempt.semanticOrientation)
        XCTAssertNil(attempt.coordinatorQuad)
    }

    func testBinderPocketMergePreservesRealEvidenceAndTagsPolicy() throws {
        let pocket = ScanDiagnostics()
        let crop = ScannerTestImage.solid(width: 72, height: 100)
        let imageIndex = pocket.registerAttemptImage(crop)
        pocket.record(ScanDiagnostics.Attempt(
            kind: .detectedCrop,
            quad: [[0.2, 0.8], [0.8, 0.8], [0.8, 0.2], [0.2, 0.2]],
            gateScore: 0.61,
            gateThreshold: 0.45,
            topCandidates: [
                .init(cardID: "sv1-1", name: "Test Card", similarity: 0.83),
            ],
            titleMatchedName: "Test Card",
            titlePrintingCount: 2,
            footerPairNumbers: ["001/198"],
            ocrVerifiedCollectorNumber: "001",
            outcome: .accepted,
            imageIndex: imageIndex,
            semanticOrientation: .upsideDown
        ))
        let pageQuad = [[0.1, 0.9], [0.4, 0.9], [0.4, 0.5], [0.1, 0.5]]
        let page = ScanDiagnostics()

        page.mergeBinderPocket(
            from: pocket,
            metadata: .init(
                pocketIndex: 3,
                status: .matched,
                includedByDefault: true,
                policyReason: .matchedThreshold,
                sourceCropPixelWidth: 720,
                sourceCropPixelHeight: 1000,
                nativeCropPixelWidth: 236,
                nativeCropPixelHeight: 452,
                rotationDegreesApplied: 0,
                captureQuality: nil,
                pageQuad: pageQuad,
                pageFitRect: nil
            )
        )

        let merged = try XCTUnwrap(page.attempts.first)
        XCTAssertEqual(merged.pocketIndex, 3)
        XCTAssertEqual(merged.quad ?? [], pageQuad)
        XCTAssertEqual(merged.coordinatorQuad, pocket.attempts.first?.quad)
        XCTAssertEqual(merged.gateScore, 0.61)
        XCTAssertEqual(merged.footerPairNumbers, ["001/198"])
        XCTAssertEqual(merged.binderPolicyReason, .matchedThreshold)
        XCTAssertEqual(merged.binderStatus, BinderCardDetectionStatus.matched.rawValue)
        XCTAssertEqual(merged.binderIncludedByDefault, true)
        XCTAssertEqual(merged.nativeCropPixelWidth, 236)
        XCTAssertEqual(merged.nativeCropPixelHeight, 452)
        // The pocket attempt's orientation survives the merge: it records
        // which rotation of the crop this attempt evaluated, which the
        // crop-derivation tooling needs now that attempt JPEGs are opt-in.
        XCTAssertEqual(merged.semanticOrientation, .upsideDown)
        XCTAssertEqual(merged.imageIndex, 0)
        XCTAssertEqual(page.attemptImages.count, 1)
    }

    func testSessionDeletionRemovesOnlyRecordingDirectories() throws {
        let root = ScannerDevModeStore.rootDirectory()
        let first = root.appendingPathComponent("scan-session-20260809-184000", isDirectory: true)
        let second = root.appendingPathComponent("scan-session-20260809-183800", isDirectory: true)
        try FileManager.default.createDirectory(at: first, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: second, withIntermediateDirectories: true)

        try ScannerDevModeStore.deleteSession(at: first)

        XCTAssertFalse(FileManager.default.fileExists(atPath: first.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: second.path))

        try ScannerDevModeStore.deleteAllSessions()

        XCTAssertTrue(ScannerDevModeStore.listSessions().isEmpty)
    }

    func testManualCorrectionWritesHumanGroundTruthAgainstOriginalPrediction() async throws {
        let image = ScannerTestImage.solid(width: 90, height: 120)
        let originalCandidate = CardScanCandidate(
            details: CardDetails(
                identity: CardIdentity(
                    id: "original-card",
                    name: "Original Match",
                    game: .pokemon,
                    setCode: "base",
                    setName: "Base"
                ),
                rarity: nil,
                imageURL: nil,
                price: nil
            ),
            confidence: CardScanConfidence(score: 0.73, reason: nil),
            originatingStrategy: .artworkFingerprint
        )

        let didSave = await ScannerDevModeStore.shared.recordManualCorrection(
            image: image,
            mode: .pokemon,
            correction: ScannerManualCorrection(
                previousCardId: originalCandidate.details.identity.id,
                previousCardName: originalCandidate.details.identity.name,
                previousSetCode: originalCandidate.details.identity.setCode,
                previousSetName: originalCandidate.details.identity.setName,
                previousConfidence: originalCandidate.confidence.score,
                previousStrategy: originalCandidate.originatingStrategy.displayName,
                correctedCardId: "corrected-card"
            )
        )

        XCTAssertTrue(didSave)
        let session = try XCTUnwrap(ScannerDevModeStore.listSessions().first)
        let bundleData = try Data(contentsOf: session.url.appendingPathComponent("results.json"))
        let bundle = try JSONDecoder().decode(RecordedScanBundle.self, from: bundleData)
        let frame = try XCTUnwrap(bundle.frames.last)
        XCTAssertEqual(frame.bestMatchCardId, "original-card")
        XCTAssertEqual(frame.expectedCardId, "corrected-card")
        XCTAssertEqual(frame.expectedNoMatch, false)
        XCTAssertEqual(frame.strategy, ScanStrategyKind.artworkFingerprint.displayName)
    }

    func testClearingMatchWritesExplicitNoMatchGroundTruth() async throws {
        let didSave = await ScannerDevModeStore.shared.recordManualCorrection(
            image: ScannerTestImage.solid(width: 90, height: 120),
            mode: .pokemon,
            correction: ScannerManualCorrection(
                previousCardId: nil,
                previousCardName: nil,
                previousSetCode: nil,
                previousSetName: nil,
                previousConfidence: nil,
                previousStrategy: nil,
                correctedCardId: nil
            )
        )

        XCTAssertTrue(didSave)
        let session = try XCTUnwrap(ScannerDevModeStore.listSessions().first)
        let bundleData = try Data(contentsOf: session.url.appendingPathComponent("results.json"))
        let bundle = try JSONDecoder().decode(RecordedScanBundle.self, from: bundleData)
        let frame = try XCTUnwrap(bundle.frames.last)
        XCTAssertNil(frame.expectedCardId)
        XCTAssertEqual(frame.expectedNoMatch, true)
        XCTAssertFalse(frame.identified)
    }

    func testBinderExclusionReasonDistinguishesBackCardFromNonCardInput() async throws {
        let image = ScannerTestImage.solid(width: 90, height: 120)
        let prediction = ScannerBinderDetectionExclusion(
            reason: .backCard,
            pageNumber: 29,
            detectionIndex: 0,
            predictedCardId: "back-page-card",
            predictedCardName: "Back Page Card",
            predictedSetCode: "base",
            predictedSetName: "Base",
            predictedConfidence: 0.91,
            predictedStrategy: ScanStrategyKind.artworkFingerprint.displayName
        )

        let savedBackCard = await ScannerDevModeStore.shared.recordBinderDetectionExclusion(
            image: image,
            mode: .pokemon,
            exclusion: prediction
        )

        XCTAssertTrue(savedBackCard)
        var session = try XCTUnwrap(ScannerDevModeStore.listSessions().first)
        var bundle = try JSONDecoder().decode(
            RecordedScanBundle.self,
            from: Data(contentsOf: session.url.appendingPathComponent("results.json"))
        )
        var frame = try XCTUnwrap(bundle.frames.last)
        XCTAssertEqual(frame.bestMatchCardId, "back-page-card")
        XCTAssertNil(frame.expectedNoMatch, "a back card is card imagery, not open-set negative input")

        var evidence = try JSONDecoder().decode(
            [ScanEvidenceRecord].self,
            from: Data(contentsOf: session.url.appendingPathComponent("evidence.json"))
        )
        XCTAssertEqual(evidence.last?.binderExclusion?.reason, .backCard)
        XCTAssertEqual(evidence.last?.binderExclusion?.pageNumber, 29)
        XCTAssertEqual(evidence.last?.binderExclusion?.detectionIndex, 0)

        let savedNotACard = await ScannerDevModeStore.shared.recordBinderDetectionExclusion(
            image: image,
            mode: .pokemon,
            exclusion: ScannerBinderDetectionExclusion(
                reason: .notACard,
                pageNumber: 29,
                detectionIndex: 0,
                predictedCardId: nil,
                predictedCardName: nil,
                predictedSetCode: nil,
                predictedSetName: nil,
                predictedConfidence: nil,
                predictedStrategy: nil
            )
        )

        XCTAssertTrue(savedNotACard)
        session = try XCTUnwrap(ScannerDevModeStore.listSessions().first)
        bundle = try JSONDecoder().decode(
            RecordedScanBundle.self,
            from: Data(contentsOf: session.url.appendingPathComponent("results.json"))
        )
        frame = try XCTUnwrap(bundle.frames.last)
        XCTAssertEqual(frame.expectedNoMatch, true)

        evidence = try JSONDecoder().decode(
            [ScanEvidenceRecord].self,
            from: Data(contentsOf: session.url.appendingPathComponent("evidence.json"))
        )
        XCTAssertEqual(evidence.last?.binderExclusion?.reason, .notACard)
    }

    func testSessionDeletionRejectsLocationsOutsideRecordingsFolder() throws {
        let outsideURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("not-a-scanner-recording", isDirectory: true)
        try FileManager.default.createDirectory(at: outsideURL, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: outsideURL) }

        XCTAssertThrowsError(try ScannerDevModeStore.deleteSession(at: outsideURL))
        XCTAssertTrue(FileManager.default.fileExists(atPath: outsideURL.path))
    }

    func testViewModelScanRecordsSessionWhenDevModeEnabled() async throws {
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    behavior: .match(cardID: "dev-mode-card"),
                    recorder: ScanInvocationRecorder()
                ),
            ],
            apiService: APIService()
        )
        let viewModel = CardScannerViewModel(coordinator: coordinator)
        let environment = EnvironmentStore()
        environment.serverConfiguration = .onDevice
        viewModel.updateEnvironment(environment)

        let framesBefore = ScannerDevModeStore.listSessions().reduce(0) { $0 + $1.frameCount }
        await viewModel.scan(image: ScannerTestImage.solid(width: 64, height: 90))

        // The recorder runs in a detached utility task; poll briefly.
        let deadline = Date().addingTimeInterval(5)
        var framesAfter = framesBefore
        while framesAfter <= framesBefore, Date() < deadline {
            try await Task.sleep(nanoseconds: 100_000_000)
            framesAfter = ScannerDevModeStore.listSessions().reduce(0) { $0 + $1.frameCount }
        }
        XCTAssertGreaterThan(
            framesAfter,
            framesBefore,
            "a scan with dev mode enabled must persist a session frame"
        )
    }

    func testCoordinatorScanPopulatesDiagnosticsEvidence() async throws {
        let image = try XCTUnwrap(UIImage(named: "BossOrders")?.cgImage)
        let diagnostics = ScanDiagnostics()
        var context = CardScannerContext.test(engine: .localOnly)
        context.diagnostics = diagnostics

        // Exercise a deterministic diagnostics path. The default ArcFace
        // encoder intentionally has no DINO rejection gate and BossOrders is
        // a documented known miss for that encoder, while this test verifies
        // that the gate-backed DINO strategy records its evidence correctly.
        let coordinator = CardScannerCoordinator(
            strategies: [BoardCardEmbeddingScannerStrategy(variant: .dinov2)],
            apiService: APIService()
        )
        let result = await coordinator.scan(
            image: image,
            context: context,
            source: .importedPhoto
        )

        guard case .success = result else {
            return XCTFail("Bundled fixture should scan; got \(result)")
        }
        let attempts = diagnostics.attempts
        XCTAssertFalse(attempts.isEmpty, "diagnostics must record at least one attempt")
        let accepted = try XCTUnwrap(
            attempts.first { $0.outcome == .accepted },
            "an accepted scan must record an accepted attempt"
        )
        XCTAssertFalse(accepted.topCandidates.isEmpty)
        XCTAssertEqual(accepted.topCandidates.first?.cardID, "swsh9-132")
        XCTAssertNotNil(accepted.gateScore)
        XCTAssertEqual(diagnostics.attemptImages.count, attempts.count)
    }
}

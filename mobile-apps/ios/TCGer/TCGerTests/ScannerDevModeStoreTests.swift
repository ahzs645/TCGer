import UIKit
import XCTest
@testable import TCGer

@MainActor
final class ScannerDevModeStoreTests: XCTestCase {
    override func setUp() {
        super.setUp()
        UserDefaults.standard.set(true, forKey: ScannerDevModeStore.enabledDefaultsKey)
    }

    override func tearDown() {
        UserDefaults.standard.removeObject(forKey: ScannerDevModeStore.enabledDefaultsKey)
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
            outcomeLabel: "binderPage: 1 detections, 1 matched"
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
        XCTAssertEqual(record.outcome, "binderPage: 1 detections, 1 matched")
        let originalFile = try XCTUnwrap(record.originalImageFile)
        XCTAssertTrue(
            FileManager.default.fileExists(atPath: session.url.appendingPathComponent(originalFile).path),
            "the unprocessed original image must be saved alongside the pipeline input"
        )
        XCTAssertEqual(record.attempts.count, 1)
        XCTAssertEqual(record.attempts[0].outcome, .accepted)
        XCTAssertEqual(record.attempts[0].footerPairNumbers, ["132/172"])
        XCTAssertEqual(record.attemptImageFiles.count, 1)
        XCTAssertTrue(
            FileManager.default.fileExists(
                atPath: session.url.appendingPathComponent(record.attemptImageFiles[0]).path
            ),
            "attempt crop image must exist next to evidence.json"
        )
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

        let result = await CardScannerCoordinator.makeDefault().scan(
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

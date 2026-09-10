import CoreGraphics
import Foundation
import XCTest
@testable import TCGer

@MainActor
final class ScannerReplayRunnerTests: XCTestCase {
    func testRecordingDirectoryPackagesAsNonEmptyZip() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("scanner-export-test-\(UUID().uuidString)", isDirectory: true)
        let frames = root.appendingPathComponent("frames", isDirectory: true)
        try FileManager.default.createDirectory(at: frames, withIntermediateDirectories: true)
        defer {
            try? FileManager.default.removeItem(at: root)
        }

        try Data(#"{"summary":{"frameCount":1}}"#.utf8)
            .write(to: root.appendingPathComponent("results.json"))
        try Data([0xFF, 0xD8, 0xFF, 0xD9])
            .write(to: frames.appendingPathComponent("frame-0001.jpg"))

        let archiveURL = try ScannerDebugViewModel.packageDirectoryForExport(root)
        defer {
            try? FileManager.default.removeItem(at: archiveURL)
        }
        let archive = try Data(contentsOf: archiveURL)

        XCTAssertEqual(Array(archive.prefix(4)), [0x50, 0x4B, 0x03, 0x04])
        XCTAssertNotNil(archive.range(of: Data("results.json".utf8)))
        XCTAssertNotNil(archive.range(of: Data("frame-0001.jpg".utf8)))
        XCTAssertGreaterThan(archive.count, 100)
    }

    func testSelectedDevModeSessionsExportOnlyRequestedDirectories() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("selected-session-export-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let selectedNames = ["scan-session-20260817-214400", "scan-session-20260816-204700"]
        let omittedName = "scan-session-20260816-165400"
        for name in selectedNames + [omittedName] {
            let directory = root.appendingPathComponent(name, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try Data("contents-for-\(name)".utf8)
                .write(to: directory.appendingPathComponent("results.json"))
        }

        let sessions = selectedNames.map { name in
            ScannerDevModeStore.SessionInfo(
                url: root.appendingPathComponent(name, isDirectory: true),
                frameCount: 1,
                sizeBytes: 1
            )
        }
        let archive = try DevModeExporter.zip(sessions: sessions)
        defer { try? FileManager.default.removeItem(at: archive.url) }
        let archiveData = try Data(contentsOf: archive.url)

        for name in selectedNames {
            XCTAssertNotNil(archiveData.range(of: Data(name.utf8)))
        }
        XCTAssertNil(archiveData.range(of: Data(omittedName.utf8)))
    }

    func testLegacyRecordingDecodesWithoutNewLabelFields() throws {
        let data = Data(#"""
        {
          "summary": {"capturedAt":"2026-01-01","frameCount":1,"mode":"Pokémon","pipeline":"full","app":"TCGer"},
          "frames": [{
            "index":1,"timestampSeconds":0,"mode":"Pokémon","pipeline":"full","elapsedMs":5,
            "detectedCount":1,"identified":true,"bestMatchName":"Card","bestMatchCardId":"card-1",
            "confidence":0.9,"strategy":"Artwork fingerprint","alternatives":[],"imageFile":"frames/one.jpg"
          }]
        }
        """#.utf8)

        let decoded = try JSONDecoder().decode(RecordedScanBundle.self, from: data)
        XCTAssertEqual(decoded.frames.first?.bestMatchCardId, "card-1")
        XCTAssertNil(decoded.frames.first?.alternativeCardIds)
        XCTAssertNil(decoded.frames.first?.expectedCardId)
        XCTAssertNil(decoded.frames.first?.expectedNoMatch)
    }

    func testReplayReportTracksStableAndChangedPredictions() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    supportsLiveScanning: true,
                    behavior: .match(cardID: "card-1"),
                    recorder: recorder
                )
            ],
            apiService: APIService()
        )
        let recording = RecordedScanBundle(
            summary: .init(
                capturedAt: "2026-08-01T00:00:00Z",
                frameCount: 2,
                mode: "Pokémon",
                pipeline: "test",
                app: "TCGer"
            ),
            frames: [
                frame(index: 1, baseline: "card-1", image: "frames/one.jpg"),
                frame(index: 2, baseline: nil, image: "frames/two.jpg")
            ]
        )
        let image = ScannerTestImage.solid()
        let replay = ScannerReplayImport(recording: recording, images: [
            "frames/one.jpg": image,
            "frames/two.jpg": image
        ])

        let report = await CardScannerReplayRunner(coordinator: coordinator).run(
            replay: replay,
            context: .test(engine: .localOnly)
        )

        XCTAssertEqual(report.totalFrames, 2)
        XCTAssertEqual(report.processedFrames, 2)
        XCTAssertEqual(report.stableFrames, 1)
        XCTAssertEqual(report.changedFrames, 1)
        XCTAssertEqual(report.topOneCorrectFrames, 1)
        XCTAssertEqual(report.positiveReferenceFrames, 1)
        XCTAssertEqual(report.topFiveHits, 1)
        XCTAssertEqual(report.accuracyRate, 0.5)
        XCTAssertEqual(report.topFiveRecall, 1)
        XCTAssertEqual(report.falsePositiveRegressions, 1)
        XCTAssertEqual(report.missRegressions, 0)
        XCTAssertEqual(report.strategyChangedFrames, 0)
        XCTAssertGreaterThanOrEqual(report.meanLatencyMs, 0)
    }

    /// Optional integration test against an isolated original-only fixture.
    /// Normal CI uses the small deterministic recorder tests above.
    func testExternalOriginalOnlyRecordingImportsEveryFrame() throws {
        guard let path = ProcessInfo.processInfo.environment["SCANNER_RECORDING_FIXTURE_DIR"] else {
            throw XCTSkip("Set SCANNER_RECORDING_FIXTURE_DIR to an original-only recording fixture")
        }
        let directory = URL(fileURLWithPath: path)
        let replay = try ScannerReplayDocumentLoader.load(urls: [directory])
        XCTAssertFalse(replay.recording.frames.isEmpty)
        for frame in replay.recording.frames {
            let recipe = try XCTUnwrap(frame.inputImageTransform)
            XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent(frame.imageFile).path))
            let image = try XCTUnwrap(replay.images[frame.imageFile])
            XCTAssertEqual(image.width, recipe.cropRectPixels[2])
            XCTAssertEqual(image.height, recipe.cropRectPixels[3])
        }
        let reference = try XCTUnwrap(ScannerReferenceLibrary.makeSet(at: directory))
        XCTAssertEqual(reference.items.count, replay.recording.frames.count)
        for item in reference.items { XCTAssertNotNil(item.loadImage()) }
        print("RECORDINGIMPORT verified \(replay.recording.frames.count) original-only frames in replay and reference browser")
    }

    /// Report JPEG reconstruction drift and the effect of a wider input using
    /// one fixed bundled recognition runtime. Recorded identities are baseline
    /// observations, not independently verified ground truth.
    func testExternalRecordingRecognitionComparison() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let originalPath = environment["SCANNER_RECORDING_ORIGINAL_DIR"],
              let fixturePath = environment["SCANNER_RECORDING_FIXTURE_DIR"] else {
            throw XCTSkip("Set both recording directories to run the recognition comparison")
        }
        let directory = URL(fileURLWithPath: originalPath)
        let fixture = URL(fileURLWithPath: fixturePath)
        let bundle = try JSONDecoder().decode(RecordedScanBundle.self,
            from: Data(contentsOf: fixture.appendingPathComponent("results.json")))
        let coordinator = CardScannerCoordinator(strategies: [
            BoardCardEmbeddingScannerStrategy(variant: .arcface)
        ], apiService: APIService())
        var rows: [[String: String]] = []
        for frame in bundle.frames where frame.captureMode != "binder" {
            let recipe = try XCTUnwrap(frame.inputImageTransform)
            let archived = try XCTUnwrap(ScannerRecordedImageLoader.load(
                imageFile: frame.imageFile, transform: nil, directory: directory))
            let derived = try XCTUnwrap(ScannerRecordedImageLoader.load(
                imageFile: frame.imageFile, transform: recipe, directory: fixture))
            let full = try XCTUnwrap(ScannerRecordedImageLoader.load(
                imageFile: recipe.sourceImageFile, transform: nil, directory: fixture))
            var row = ["imageFile": frame.imageFile, "recorded": frame.bestMatchCardId ?? "noMatch"]
            for (name, image) in [("archived", archived), ("derived", derived), ("full", full)] {
                let result = await coordinator.scan(image: image, context: .test(engine: .localOnly), source: .photoCapture)
                switch result {
                case .success(let match): row[name] = match.primary.details.identity.id
                case .failure(let error):
                    row[name] = "noMatch"
                    row[name + "Error"] = String(describing: error)
                }
            }
            rows.append(row)
            print("RECORDINGCOMPARE \(row)")
        }
        XCTAssertFalse(rows.isEmpty)
        XCTAssertTrue(rows.contains { $0["archived"] != "noMatch" }, "Comparison must exercise a working recognition runtime")
        if let report = environment["SCANNER_RECORDING_COMPARISON_REPORT"] {
            try JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys])
                .write(to: URL(fileURLWithPath: report), options: .atomic)
        }
        print("RECORDINGCOMPARE frames=\(rows.count) reconstructionDrift=\(rows.filter { $0["archived"] != $0["derived"] }.count) fullFrameChanges=\(rows.filter { $0["archived"] != $0["full"] }.count)")
    }

    private func frame(index: Int, baseline: String?, image: String) -> RecordedScanFrame {
        RecordedScanFrame(
            index: index,
            timestampSeconds: Double(index),
            mode: "Pokémon",
            pipeline: "test",
            elapsedMs: 1,
            detectedCount: 1,
            segmentationConfidence: 1,
            quad: nil,
            identified: baseline != nil,
            bestMatchName: baseline,
            bestMatchCardId: baseline,
            bestMatchSetCode: nil,
            bestMatchSetName: nil,
            confidence: baseline == nil ? nil : 0.9,
            strategy: ScanStrategyKind.artworkFingerprint.displayName,
            alternatives: [],
            alternativeCardIds: [],
            expectedCardId: nil,
            expectedNoMatch: nil,
            imageFile: image
        )
    }
}

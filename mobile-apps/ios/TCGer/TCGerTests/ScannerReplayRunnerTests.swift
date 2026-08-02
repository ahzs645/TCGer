import XCTest
@testable import TCGer

@MainActor
final class ScannerReplayRunnerTests: XCTestCase {
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

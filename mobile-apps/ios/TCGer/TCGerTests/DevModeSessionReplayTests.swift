import CoreGraphics
import Foundation
import ImageIO
import XCTest
@testable import TCGer

/// Replays exported dev-mode sessions through the full production coordinator
/// and compares each frame's new outcome against what the recording device
/// decided at capture time — the recorded results ARE the before-baseline, so
/// this measures pipeline changes directly against real user captures.
///
/// Point DEVMODE_SESSIONS_DIR at a folder of scan-session-* directories (the
/// unzipped "Export All Sessions" archive) via
/// `TEST_RUNNER_DEVMODE_SESSIONS_DIR=... xcodebuild test`. Skips when unset.
@MainActor
final class DevModeSessionReplayTests: XCTestCase {
    /// Ground truth for frames whose card was verified by a flat-on scan of
    /// the same physical card in the same archive (2026-08-09 sessions).
    private static let expectedCards: [String: String] = [
        "scan-session-20260809-160556/frame-0001.jpg": "dpp-DP38",
        "scan-session-20260809-160556/frame-0007.jpg": "dp4-104",
        "scan-session-20260809-160556/frame-0009.jpg": "swshp-SWSH204",
        "scan-session-20260809-160556/frame-0010.jpg": "swshp-SWSH204",
        "scan-session-20260809-160556/frame-0011.jpg": "swshp-SWSH204",
        "scan-session-20260809-160556/frame-0012.jpg": "swshp-SWSH204",
        "scan-session-20260809-160556/frame-0014.jpg": "me05-016",
    ]
    /// Frames that must NOT match anything (accidental shutter presses).
    private static let expectedNoMatch: Set<String> = [
        "scan-session-20260809-145850/frame-0000.jpg",
        "scan-session-20260809-145850/frame-0001.jpg",
        "scan-session-20260809-145947/frame-0000.jpg",
    ]
    /// Frames whose device decision does not reproduce in the Simulator even
    /// on unmodified code (Simulator Vision doc-seg/rectangles diverge from
    /// device Vision — a long-known trap). Excluded from the lost-frame
    /// regression assertion; still printed.
    private static let knownSimulatorDivergences: Set<String> = [
        "scan-session-20260809-160556/frame-0005.jpg",
    ]

    func testReplayDevModeSessions() async throws {
        guard let dir = ProcessInfo.processInfo.environment["DEVMODE_SESSIONS_DIR"] else {
            throw XCTSkip("Set DEVMODE_SESSIONS_DIR to an unzipped Export All archive to run.")
        }
        let root = URL(fileURLWithPath: dir, isDirectory: true)
        let sessions = ((try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []).filter {
            FileManager.default.fileExists(atPath: $0.appendingPathComponent("results.json").path)
        }.sorted { $0.lastPathComponent < $1.lastPathComponent }
        XCTAssertFalse(sessions.isEmpty, "no sessions found under \(dir)")

        let coordinator = CardScannerCoordinator.makeDefault()
        var recoveredCount = 0
        var lostCount = 0
        var newFalseAccepts: [String] = []
        var expectedHits = 0
        var expectedTotal = 0

        for session in sessions {
            let bundle = try JSONDecoder().decode(
                RecordedScanBundle.self,
                from: Data(contentsOf: session.appendingPathComponent("results.json"))
            )
            for frame in bundle.frames.sorted(by: { $0.index < $1.index }) {
                let imageURL = session.appendingPathComponent(frame.imageFile)
                guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
                else { continue }

                let key = "\(session.lastPathComponent)/\(frame.imageFile)"
                let diagnostics = ScanDiagnostics()
                var context = CardScannerContext.test(engine: .localOnly)
                context.diagnostics = diagnostics
                let result = await coordinator.scan(
                    image: image,
                    context: context,
                    source: .photoCapture
                )

                var newCardID: String?
                var newScore: Double?
                if case .success(let scan) = result {
                    newCardID = scan.primary.details.identity.id
                    newScore = scan.primary.confidence.score
                }

                let baseline = frame.identified ? (frame.bestMatchCardId ?? "?") : "noMatch"
                let current = newCardID ?? "noMatch"
                var verdict = ""
                if let expected = Self.expectedCards[key] {
                    expectedTotal += 1
                    if newCardID == expected {
                        expectedHits += 1
                        verdict = " ✓ RECOVERED (expected \(expected))"
                    } else {
                        verdict = " ✗ still wrong (expected \(expected))"
                    }
                }
                if Self.expectedNoMatch.contains(key) {
                    if newCardID != nil {
                        newFalseAccepts.append("\(key) → \(current)")
                        verdict = " ✗ FALSE ACCEPT"
                    } else {
                        verdict = " ✓ still declined"
                    }
                }
                if !frame.identified, newCardID != nil, Self.expectedCards[key] == nil,
                   !Self.expectedNoMatch.contains(key) {
                    recoveredCount += 1
                }
                if frame.identified, newCardID == nil {
                    if Self.knownSimulatorDivergences.contains(key) {
                        verdict += " (known Simulator divergence: was \(baseline))"
                    } else {
                        lostCount += 1
                        verdict += " (LOST: was \(baseline))"
                    }
                }

                let outcomes = diagnostics.attempts.map { "\($0.kind.rawValue):\($0.outcome.rawValue)" }
                    .joined(separator: ", ")
                print(
                    "DEVREPLAY \(key): \(baseline) -> \(current)"
                    + (newScore.map { String(format: " @%.2f", $0) } ?? "")
                    + verdict + "  [\(outcomes)]"
                )
            }
        }

        print("DEVREPLAY summary: labeled \(expectedHits)/\(expectedTotal) correct, "
            + "\(lostCount) previously-accepted lost, \(newFalseAccepts.count) new false accepts")
        XCTAssertTrue(
            newFalseAccepts.isEmpty,
            "accidental captures must stay declined: \(newFalseAccepts)"
        )
        XCTAssertEqual(lostCount, 0, "previously accepted frames must not be lost")
    }
}

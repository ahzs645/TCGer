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
    private struct EvidenceRecord: Decodable {
        let imageFile: String
        let outcome: String
    }

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
        // The 19:07 lighting/foil session deliberately repeats each physical
        // card across blur, glare, angle, and framing changes. Clear frames
        // and visible collector numbers identify every single-card shot.
        "scan-session-20260809-190752/frame-0000.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0001.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0002.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0003.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0004.jpg": "me05-043",
        "scan-session-20260809-190752/frame-0005.jpg": "me04-051",
        "scan-session-20260809-190752/frame-0006.jpg": "me04-051",
        "scan-session-20260809-190752/frame-0007.jpg": "me05-040",
        "scan-session-20260809-190752/frame-0008.jpg": "me05-040",
        "scan-session-20260809-190752/frame-0009.jpg": "me05-040",
        "scan-session-20260809-190752/frame-0010.jpg": "swshp-SWSH204",
        "scan-session-20260809-190752/frame-0011.jpg": "dp4-104",
        "scan-session-20260809-190752/frame-0012.jpg": "pl4-AR3",
        "scan-session-20260809-190752/frame-0013.jpg": "pl4-AR3",
        "scan-session-20260809-190752/frame-0014.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0015.jpg": "dpp-DP38",
        "scan-session-20260809-190752/frame-0016.jpg": "dpp-DP38",
        "scan-session-20260809-190752/frame-0017.jpg": "dpp-DP38",
        "scan-session-20260809-190752/frame-0018.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0019.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0020.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0021.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0022.jpg": "dpp-DP30",
        "scan-session-20260809-190752/frame-0023.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0024.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0025.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0026.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0027.jpg": "dp4-103",
        "scan-session-20260809-190752/frame-0028.jpg": "dp4-103",
        // The 21:09 follow-up repeats known cards under glare, blur, overlap,
        // and clear framing. Visible titles/collector numbers plus the clear
        // shots establish the exact printing for every single-card frame.
        "scan-session-20260809-210958/frame-0000.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0001.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0002.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0003.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0004.jpg": "swshp-SWSH204",
        "scan-session-20260809-210958/frame-0005.jpg": "dp4-103",
        "scan-session-20260809-210958/frame-0006.jpg": "dp4-103",
        "scan-session-20260809-210958/frame-0007.jpg": "dp4-104",
        "scan-session-20260809-210958/frame-0008.jpg": "pl4-AR3",
        "scan-session-20260809-210958/frame-0009.jpg": "pl4-AR3",
        "scan-session-20260809-210958/frame-0010.jpg": "pl4-AR3",
        // Two stacked sleeved cards, Giratina LV.X in front. Labeled noMatch
        // while bad crops made the outcome arbitrary; the pixel-space corner
        // refinement (2026-08-10) deterministically isolates the front card,
        // and the user decided single-card mode should identify it.
        "scan-session-20260809-210958/frame-0011.jpg": "dpp-DP38",
        "scan-session-20260809-210958/frame-0012.jpg": "dpp-DP38",
        "scan-session-20260809-210958/frame-0013.jpg": "dpp-DP30",
        "scan-session-20260809-210958/frame-0014.jpg": "dpp-DP30",
        "scan-session-20260809-210958/frame-0015.jpg": "dpp-DP30",
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
        // Device Vision produced the recorded correct crops; Simulator Vision
        // chooses different quads on these same pixels. Their device attempts
        // clear 0.72 or carry exact collector-number confirmation.
        "scan-session-20260809-190752/frame-0004.jpg",
        "scan-session-20260809-190752/frame-0017.jpg",
        "scan-session-20260809-190752/frame-0022.jpg",
        "scan-session-20260809-190752/frame-0026.jpg",
        // Device accepted the correct Darkrai from its recorded crop; the
        // Simulator chooses lower-scoring whole-frame/detected quads.
        "scan-session-20260809-210958/frame-0007.jpg",
        // 2026-08-10: first full replay of the reorganized
        // TCGer-Session-Reference/sessions export. All 15 frames below lose
        // their device accepts identically on pre-fix (715fe9b2, isolated
        // worktree control) and post-fix code — the sessions were recorded on
        // device and never had Simulator floors established. Device attempts
        // accepted at 0.72+; Simulator Vision picks different quads.
        "scan-session-20260809-175313/frame-0000.jpg",
        "scan-session-20260809-175313/frame-0008.jpg",
        "scan-session-20260809-175313/frame-0015.jpg",
        "scan-session-20260809-175313/frame-0016.jpg",
        "scan-session-20260809-175313/frame-0017.jpg",
        "scan-session-20260809-175313/frame-0020.jpg",
        "scan-session-20260809-175313/frame-0021.jpg",
        "scan-session-20260809-175313/frame-0026.jpg",
        "scan-session-20260809-175313/frame-0029.jpg",
        "scan-session-20260809-183843/frame-0005.jpg",
        "scan-session-20260809-183843/frame-0008.jpg",
        "scan-session-20260809-183843/frame-0017.jpg",
        "scan-session-20260809-183843/frame-0020.jpg",
        "scan-session-20260809-211223/frame-0000.jpg",
        "scan-session-20260809-211223/frame-0015.jpg",
    ]

    /// Labeled frames the pipeline currently accepts as the wrong card. These
    /// are open defects, not accepted behavior — they are listed so that a NEW
    /// wrong accept still fails the assertion below. Removing an entry is the
    /// goal; adding one requires the same scrutiny as any precision regression.
    private static let knownWrongAccepts: Set<String> = [
        // Basic Energy: Water (dp1-125) retrieved as Grass (dp1-123) at 0.77.
        // The two printings differ only in the energy symbol, which the
        // center-crop preprocessing keeps but the global embedding averages
        // away. Binder review now leaves this uncertain result unselected,
        // though it remains a wrong single-card acceptance here.
        "scan-session-20260810-220315/frame-0009.jpg",
        // Absol (ex13-18) retrieved as Medicham (ex5-42) at 0.72. A separate
        // capture of the same card in the 21:12 session retrieves Shiftry
        // (ex2-22) — two different wrong Pokemon from two foil crops of one
        // card, so the neighborhood is unstable, not a near-twin printing
        // problem the OCR tiebreak could resolve.
        "scan-session-20260810-220315/frame-0012.jpg",
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
        var lostCount = 0
        var wrongAccepts: [String] = []
        var expectedHits = 0
        var expectedTotal = 0

        for session in sessions {
            let bundle = try JSONDecoder().decode(
                RecordedScanBundle.self,
                from: Data(contentsOf: session.appendingPathComponent("results.json"))
            )
            let evidence = (try? JSONDecoder().decode(
                [EvidenceRecord].self,
                from: Data(contentsOf: session.appendingPathComponent("evidence.json"))
            )) ?? []
            let binderImages = Set(evidence.lazy.filter {
                $0.outcome.hasPrefix("binderPage")
            }.map(\.imageFile))
            // Re-editing one review pocket writes a fresh correction frame per
            // edit, all with identical crop bytes and superseded labels (the
            // 21:12 session labels one pocket ecard1-1, then noMatch, then
            // ecard1-33). Scoring the stale ones fails the pipeline for
            // answering what the human ultimately said. Last edit wins, same
            // collapse ScannerCorrectionReplayTests applies.
            var supersededFrames: Set<String> = []
            var latestLabelByDigest: [String: (index: Int, imageFile: String)] = [:]
            for frame in bundle.frames
            where frame.expectedCardId != nil || frame.expectedNoMatch != nil {
                guard let digest = SessionImageDigest.of(
                    session.appendingPathComponent(frame.imageFile)
                ) else { continue }
                guard let previous = latestLabelByDigest[digest] else {
                    latestLabelByDigest[digest] = (frame.index, frame.imageFile)
                    continue
                }
                if previous.index < frame.index {
                    supersededFrames.insert(previous.imageFile)
                    latestLabelByDigest[digest] = (frame.index, frame.imageFile)
                } else {
                    supersededFrames.insert(frame.imageFile)
                }
            }
            for frame in bundle.frames.sorted(by: { $0.index < $1.index }) {
                // Binder pages have their own replay harness. Treating a full
                // 3x3 page as one card creates meaningless single-card hits.
                guard !binderImages.contains(frame.imageFile) else { continue }
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
                // Labels the recorder already wrote (a human correction in the
                // app writes `expectedCardId`/`expectedNoMatch` into
                // results.json) count as ground truth alongside the curated
                // table above, which stays authoritative where both exist.
                // Without this every corrected frame in an archive replays
                // completely unscored.
                let isSuperseded = supersededFrames.contains(frame.imageFile)
                let recordedExpectation = (frame.expectedNoMatch == true || isSuperseded)
                    ? nil
                    : frame.expectedCardId
                if let expected = Self.expectedCards[key] ?? recordedExpectation {
                    expectedTotal += 1
                    if newCardID == expected {
                        expectedHits += 1
                        verdict = " ✓ RECOVERED (expected \(expected))"
                    } else if let newCardID {
                        if !Self.knownWrongAccepts.contains(key) {
                            wrongAccepts.append("\(key) expected \(expected), got \(newCardID)")
                        }
                        verdict = " ✗ WRONG ACCEPT (expected \(expected))"
                    } else {
                        verdict = " • abstained (expected \(expected))"
                    }
                }
                if Self.expectedNoMatch.contains(key)
                    || (frame.expectedNoMatch == true && !isSuperseded) {
                    if newCardID != nil {
                        if !Self.knownWrongAccepts.contains(key) {
                            wrongAccepts.append("\(key) expected noMatch, got \(current)")
                        }
                        verdict = " ✗ FALSE ACCEPT"
                    } else {
                        verdict = " ✓ still declined"
                    }
                }
                if isSuperseded {
                    verdict += " (superseded label, not scored)"
                }
                // A manual correction records the REJECTED prediction as the
                // frame's baseline (`identified` / `bestMatchCardId` are the
                // human's "previous" values), so a frame the user overruled
                // must not anchor the lost-accept floor: abstaining instead of
                // repeating the wrong card is the fix working, not a
                // regression. Only accepts the human did not contradict count.
                let baselineWasRejected = frame.expectedNoMatch == true
                    || (frame.expectedCardId.map { $0 != frame.bestMatchCardId } ?? false)
                if frame.identified, newCardID == nil, !baselineWasRejected {
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
            + "\(lostCount) previously-accepted lost, \(wrongAccepts.count) wrong accepts")
        XCTAssertTrue(
            wrongAccepts.isEmpty,
            "ground-truth labels must never change to a wrong card: \(wrongAccepts)"
        )
        XCTAssertEqual(lostCount, 0, "previously accepted frames must not be lost")
    }
}

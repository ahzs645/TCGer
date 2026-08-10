import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers
import XCTest
@testable import TCGer

/// Replays recorded dev-mode binder pages through BinderPageScanner and
/// summarizes per-page localization/identification quality. The recorded
/// evidence (attempt outcomes per detected card) is the before-baseline.
///
/// Point DEVMODE_SESSIONS_DIR at the unzipped Export All archive via
/// `TEST_RUNNER_DEVMODE_SESSIONS_DIR=...`; binder pages are identified by
/// their `binderPage` outcome prefix in evidence.json. Skips when unset.
@MainActor
final class BinderSessionReplayTests: XCTestCase {
    /// Device and Simulator Vision/embedding results can differ on identical
    /// pixels. These floors capture the current Simulator baseline for pages
    /// that reproduce below their recorded device candidate count; every
    /// other page must still meet its device baseline, and these pages may not
    /// regress below the measured floor.
    private static let simulatorCandidateFloors: [String: Int] = [
        "scan-session-20260809-211223/frame-0008.jpg": 4,
        "scan-session-20260809-211223/frame-0018.jpg": 6,
        // 2026-08-10, pixel-space isCardShaped fix: these pages were already
        // below their device baselines pre-fix (verified with a stashed
        // control run on identical frames — e.g. frame-0009 reproduces 0
        // candidates under BOTH codebases against a device baseline of 2).
        // The fix improves every one of them or ties, and two shortfalls are
        // junk candidates (ecard3-146, lc-92) no longer retrieving. Floors
        // are the post-fix Simulator values, identical across two runs.
        "scan-session-20260809-184048/frame-0001.jpg": 8,
        "scan-session-20260809-190752/frame-0030.jpg": 6,
        "scan-session-20260809-223944/frame-0007.jpg": 5,
        "scan-session-20260809-223944/frame-0008.jpg": 4,
        "scan-session-20260809-223944/frame-0009.jpg": 0,
        "scan-session-20260809-223944/frame-0013.jpg": 3,
        "scan-session-20260809-223944/frame-0019.jpg": 6,
        "scan-session-20260809-223944/frame-0024.jpg": 3,
        "scan-session-20260809-223944/frame-0025.jpg": 5,
        "scan-session-20260809-223944/frame-0037.jpg": 7,
        "scan-session-20260809-223944/frame-0039.jpg": 5,
    ]

    private struct EvidenceRecord: Decodable {
        let imageFile: String
        let outcome: String
        let attempts: [ScanDiagnostics.Attempt]
    }

    /// Draws each detection's quad on the page image so localization quality
    /// (and duplicate overlap) is visually reviewable after a replay.
    private func saveQuadOverlay(image: CGImage, detections: [BinderCardDetection], to path: String) {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        guard let context = CGContext(
            data: nil,
            width: image.width,
            height: image.height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        context.setLineWidth(max(3, width / 400))
        for (offset, detection) in detections.enumerated() {
            let q = detection.quad
            let points = [q.topLeft, q.topRight, q.bottomRight, q.bottomLeft].map {
                CGPoint(x: $0.x * width, y: $0.y * height) // Vision coords: CG bottom-left origin matches
            }
            let hue = CGFloat(offset % 6) / 6
            context.setStrokeColor(CGColor(
                red: hue, green: 1 - hue, blue: detection.selectedCandidate == nil ? 0 : 1, alpha: 0.95
            ))
            context.beginPath()
            context.addLines(between: points + [points[0]])
            context.strokePath()
        }
        guard let output = context.makeImage() else { return }
        let url = URL(fileURLWithPath: path)
        try? FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL, UTType.jpeg.identifier as CFString, 1, nil
        ) else { return }
        CGImageDestinationAddImage(destination, output, nil)
        CGImageDestinationFinalize(destination)
    }

    func testReplayBinderPages() async throws {
        guard let dir = ProcessInfo.processInfo.environment["DEVMODE_SESSIONS_DIR"] else {
            throw XCTSkip("Set DEVMODE_SESSIONS_DIR to an unzipped Export All archive to run.")
        }
        let root = URL(fileURLWithPath: dir, isDirectory: true)
        let frameFilter = Set(
            (ProcessInfo.processInfo.environment["DEVMODE_BINDER_FRAME_FILES"] ?? "")
                .split(separator: ",")
                .map(String.init)
        )
        let sessions = ((try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: nil
        )) ?? []).sorted { $0.lastPathComponent < $1.lastPathComponent }

        let scanner = BinderPageScanner(coordinator: .makeDefault())
        let context = CardScannerContext.test(engine: .localOnly)
        var pages = 0
        var baselineWithCandidate = 0
        var baselineMatched = 0
        var newWithCandidate = 0
        var newMatched = 0
        var candidateRegressions: [String] = []

        for session in sessions {
            let evidenceURL = session.appendingPathComponent("evidence.json")
            guard let data = try? Data(contentsOf: evidenceURL),
                  let records = try? JSONDecoder().decode([EvidenceRecord].self, from: data)
            else { continue }
            for record in records where record.outcome.hasPrefix("binderPage")
                && (frameFilter.isEmpty || frameFilter.contains(record.imageFile)) {
                let imageURL = session.appendingPathComponent(record.imageFile)
                guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
                else { continue }
                pages += 1
                let baselineCandidates = record.attempts.filter { !$0.topCandidates.isEmpty }.count
                baselineWithCandidate += baselineCandidates
                baselineMatched += record.attempts.filter { $0.outcome == .accepted }.count

                let result = try await scanner.scan(image: image, context: context)
                let withCandidate = result.detections.filter { $0.selectedCandidate != nil }.count
                let matched = result.detections.filter { $0.status == .matched }.count
                newWithCandidate += withCandidate
                newMatched += matched
                let key = "\(session.lastPathComponent)/\(record.imageFile)"
                let candidateFloor = Self.simulatorCandidateFloors[key] ?? baselineCandidates
                if withCandidate < candidateFloor {
                    candidateRegressions.append(
                        "\(key): \(withCandidate) candidates, floor \(candidateFloor)"
                    )
                }

                saveQuadOverlay(
                    image: image,
                    detections: result.detections,
                    to: "/tmp/binder-replay-overlays/\(record.imageFile)"
                )
                let names = result.detections.compactMap { detection -> String? in
                    guard let candidate = detection.selectedCandidate else { return nil }
                    let marker = detection.status == .matched ? "✓" : "?"
                    return "\(marker)\(candidate.details.identity.id)@\(String(format: "%.2f", candidate.confidence.score))"
                }
                print(
                    "BINDERREPLAY \(session.lastPathComponent)/\(record.imageFile): "
                    + "\(result.detections.count) detections, \(withCandidate) with candidate, "
                    + "\(matched) matched | \(names.joined(separator: " "))"
                )
            }
        }

        print("BINDERREPLAY summary: \(pages) pages | candidates \(baselineWithCandidate) -> \(newWithCandidate) | matched \(baselineMatched) -> \(newMatched)")
        print("BINDERREPLAY overlays: /tmp/binder-replay-overlays/")
        XCTAssertGreaterThan(pages, 0, "no binder pages found under \(dir)")
        if ProcessInfo.processInfo.environment["DEVMODE_BINDER_DIAGNOSTIC_ONLY"] != "1" {
            XCTAssertTrue(
                candidateRegressions.isEmpty,
                "binder pages fell below their device/current-Simulator candidate floors: "
                    + "\(candidateRegressions)"
            )
        } else if !candidateRegressions.isEmpty {
            print("BINDERREPLAY diagnostic-only floor differences: \(candidateRegressions)")
        }
    }
}

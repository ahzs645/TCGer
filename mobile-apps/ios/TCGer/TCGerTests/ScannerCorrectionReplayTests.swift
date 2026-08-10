import Foundation
import ImageIO
import XCTest
@testable import TCGer

/// Replays the user's explicit dev-mode corrections. Unlike the historical
/// device decision, these labels are ground truth. Repeated edits of the same
/// crop are collapsed by image bytes so the final correction wins.
@MainActor
final class ScannerCorrectionReplayTests: XCTestCase {
    func testReplayHumanCorrections() async throws {
        guard let dir = ProcessInfo.processInfo.environment["DEVMODE_SESSIONS_DIR"] else {
            throw XCTSkip("Set DEVMODE_SESSIONS_DIR to an unzipped Export All archive.")
        }
        let root = URL(fileURLWithPath: dir, isDirectory: true)
        let frameFilter = ProcessInfo.processInfo.environment["DEVMODE_CORRECTION_FRAME"]
        let sessions = ((try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []).filter {
            FileManager.default.fileExists(atPath: $0.appendingPathComponent("results.json").path)
        }.sorted { $0.lastPathComponent < $1.lastPathComponent }

        let coordinator = CardScannerCoordinator.makeDefault()
        var labeledCount = 0
        var correctCount = 0
        var abstainedCount = 0
        var wrongAccepts: [String] = []

        for session in sessions {
            let bundle = try JSONDecoder().decode(
                RecordedScanBundle.self,
                from: Data(contentsOf: session.appendingPathComponent("results.json"))
            )
            var finalFrameByImageData: [Data: RecordedScanFrame] = [:]
            for frame in bundle.frames.sorted(by: { $0.index < $1.index })
                where frame.expectedCardId != nil || frame.expectedNoMatch != nil {
                let data = try Data(contentsOf: session.appendingPathComponent(frame.imageFile))
                finalFrameByImageData[data] = frame
            }

            for frame in finalFrameByImageData.values.sorted(by: { $0.index < $1.index }) {
                let key = "\(session.lastPathComponent)/\(frame.imageFile)"
                guard frameFilter == nil || key == frameFilter || frame.imageFile == frameFilter else {
                    continue
                }
                let imageURL = session.appendingPathComponent(frame.imageFile)
                guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
                else {
                    XCTFail("could not decode \(key)")
                    continue
                }
                labeledCount += 1
                let directTitles = CardTitleOCR().read(from: image).map {
                    "\($0.text)@\(String(format: "%.2f", $0.confidence))"
                }.joined(separator: "/")
                let directFooter = CollectorNumberOCR().readFooter(from: image)
                let diagnostics = ScanDiagnostics()
                var context = CardScannerContext.test(engine: .localOnly)
                context.diagnostics = diagnostics
                let result = await coordinator.scan(
                    image: image,
                    context: context,
                    source: .photoCapture
                )
                let current: String?
                let score: Double?
                if case .success(let scan) = result {
                    current = scan.primary.details.identity.id
                    score = scan.primary.confidence.score
                } else {
                    current = nil
                    score = nil
                }

                let expected = frame.expectedNoMatch == true ? nil : frame.expectedCardId
                let verdict: String
                if current == expected {
                    correctCount += 1
                    verdict = "correct"
                } else if let current {
                    wrongAccepts.append("\(key) expected \(expected ?? "noMatch"), got \(current)")
                    verdict = "WRONG ACCEPT"
                } else {
                    abstainedCount += 1
                    verdict = "abstained"
                }
                let attemptImages = diagnostics.attemptImages
                let outcomes = diagnostics.attempts.map { attempt in
                    let candidates = attempt.topCandidates.prefix(2).map {
                        "\($0.cardID)@\(String(format: "%.3f", $0.similarity))"
                    }.joined(separator: "/")
                    let cropTitles: String
                    if attemptImages.indices.contains(attempt.imageIndex) {
                        cropTitles = CardTitleOCR().read(from: attemptImages[attempt.imageIndex])
                            .map(\.text).joined(separator: "/")
                    } else {
                        cropTitles = ""
                    }
                    return "\(attempt.kind.rawValue):\(attempt.outcome.rawValue)"
                        + " gate=\(attempt.gateScore.map { String(format: "%.3f", $0) } ?? "-")"
                        + " top=\(candidates.isEmpty ? "-" : candidates)"
                        + " title=\(attempt.titleMatchedName ?? "-")"
                        + " cropTitle=\(cropTitles.isEmpty ? "-" : cropTitles)"
                        + " footer=\(attempt.footerPairNumbers.joined(separator: "/"))"
                        + " verified=\(attempt.ocrVerifiedCollectorNumber ?? "-")"
                }.joined(separator: ",")
                print("CORRECTIONREPLAY \(key) expected=\(expected ?? "noMatch") "
                    + "current=\(current ?? "noMatch")"
                    + (score.map { String(format: " @%.3f", $0) } ?? "")
                    + " \(verdict) directTitle=\(directTitles.isEmpty ? "-" : directTitles)"
                    + " directFooter=\(directFooter.pairNumbers.joined(separator: "/"))"
                    + " [\(outcomes)]")
            }
        }

        print("CORRECTIONREPLAY summary: labels=\(labeledCount) correct=\(correctCount) "
            + "abstained=\(abstainedCount) wrongAccepts=\(wrongAccepts.count)")
        XCTAssertGreaterThan(labeledCount, 0, "no explicit human corrections found under \(dir)")
        XCTAssertTrue(
            wrongAccepts.isEmpty,
            "human corrections must never become a wrong accepted card: \(wrongAccepts)"
        )
    }
}

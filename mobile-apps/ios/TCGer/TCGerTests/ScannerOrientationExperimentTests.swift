import CoreImage
import Foundation
import ImageIO
import XCTest
@testable import TCGer

/// Measures whether an abstention-only 180-degree retry is worth its latency.
/// Manual corrections in an exported dev-mode session supply the labels. When
/// a correction was edited more than once, the last event for identical image
/// bytes is treated as the final label.
@MainActor
final class ScannerOrientationExperimentTests: XCTestCase {
    private static let strongAcceptanceScore = 0.72

    private enum Variant: String, CaseIterable {
        case baseline
        case rotated180

        func apply(to image: CGImage, context: CIContext) -> CGImage? {
            guard self == .rotated180 else { return image }
            var output = CIImage(cgImage: image).oriented(.down)
            output = output.transformed(by: CGAffineTransform(
                translationX: -output.extent.minX,
                y: -output.extent.minY
            ))
            return context.createCGImage(output, from: output.extent)
        }
    }

    private struct Candidate {
        let id: String
        let score: Double
    }

    private struct Totals {
        var frames = 0
        var top1Correct = 0
        var correctAtStrongThreshold = 0
        var wrongAtStrongThreshold = 0
    }

    func testManualCorrectionRotationVariants() async throws {
        guard let path = ProcessInfo.processInfo.environment["ORIENTATION_EXPERIMENT_SESSION_DIR"] else {
            throw XCTSkip("Set ORIENTATION_EXPERIMENT_SESSION_DIR to a labeled dev-mode session.")
        }
        let root = URL(fileURLWithPath: path, isDirectory: true)
        let bundle = try JSONDecoder().decode(
            RecordedScanBundle.self,
            from: Data(contentsOf: root.appendingPathComponent("results.json"))
        )

        // A correction can be changed in the review UI. Collapse identical
        // crop bytes in event order so only the final human decision remains.
        var finalFramesByImageData: [Data: RecordedScanFrame] = [:]
        for frame in bundle.frames.sorted(by: { $0.index < $1.index })
            where frame.expectedCardId != nil || frame.expectedNoMatch != nil {
            let data = try Data(contentsOf: root.appendingPathComponent(frame.imageFile))
            finalFramesByImageData[data] = frame
        }
        let labeledFrames = finalFramesByImageData.values
            .filter { $0.expectedCardId != nil }
            .sorted { $0.index < $1.index }
        XCTAssertFalse(labeledFrames.isEmpty, "no positive manual corrections in \(path)")

        let encoder = CardEmbeddingEncoder()
        let index = AnnoyIndexStore()
        let metadata = CardIndexMetadataStore.shared
        let allowed = await metadata.indices(for: .pokemon, setCode: nil)
        let ciContext = CIContext(options: [.cacheIntermediates: false])
        var totals = Dictionary(uniqueKeysWithValues: Variant.allCases.map { ($0, Totals()) })
        var bestOrientationCorrect = 0
        var bestOrientationStrongCorrect = 0
        var bestOrientationStrongWrong = 0

        for frame in labeledFrames {
            let expected = try XCTUnwrap(frame.expectedCardId)
            let imageURL = root.appendingPathComponent(frame.imageFile)
            guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else {
                XCTFail("could not decode \(frame.imageFile)")
                continue
            }

            var topByVariant: [Variant: Candidate] = [:]
            for variant in Variant.allCases {
                guard let transformed = variant.apply(to: image, context: ciContext) else { continue }
                let embedding = try await encoder.embedding(for: transformed)
                let matches = try await index.nearestNeighbors(
                    for: embedding,
                    limit: 10,
                    allowedIndices: allowed
                )
                var ranked: [Candidate] = []
                for match in matches {
                    guard let entry = await metadata.entry(for: match.index) else { continue }
                    ranked.append(Candidate(id: entry.cardId, score: 1 - match.distance))
                }
                guard let top = ranked.first else { continue }
                topByVariant[variant] = top
                var value = totals[variant] ?? Totals()
                value.frames += 1
                if top.id == expected { value.top1Correct += 1 }
                if top.id == expected, top.score >= Self.strongAcceptanceScore {
                    value.correctAtStrongThreshold += 1
                }
                if top.id != expected, top.score >= Self.strongAcceptanceScore {
                    value.wrongAtStrongThreshold += 1
                }
                totals[variant] = value
                let expectedRank = ranked.firstIndex(where: { $0.id == expected }).map { $0 + 1 } ?? 0
                let expectedScore = ranked.first(where: { $0.id == expected })?.score ?? 0
                print(String(
                    format: "ORIENTATION %@ %@ expected=%@ top=%@@%.3f expectedRank=%d expectedScore=%.3f",
                    frame.imageFile,
                    variant.rawValue,
                    expected,
                    top.id,
                    top.score,
                    expectedRank,
                    expectedScore
                ))
            }

            if let best = topByVariant.values.max(by: { $0.score < $1.score }) {
                if best.id == expected { bestOrientationCorrect += 1 }
                if best.id == expected, best.score >= Self.strongAcceptanceScore {
                    bestOrientationStrongCorrect += 1
                }
                if best.id != expected, best.score >= Self.strongAcceptanceScore {
                    bestOrientationStrongWrong += 1
                }
            }
        }

        for variant in Variant.allCases {
            let value = totals[variant] ?? Totals()
            print("ORIENTATION SUMMARY \(variant.rawValue) frames=\(value.frames) "
                + "top1=\(value.top1Correct) strongCorrect=\(value.correctAtStrongThreshold) "
                + "strongWrong=\(value.wrongAtStrongThreshold)")
        }
        print("ORIENTATION SUMMARY bestOfTwo frames=\(labeledFrames.count) "
            + "top1=\(bestOrientationCorrect) strongCorrect=\(bestOrientationStrongCorrect) "
            + "strongWrong=\(bestOrientationStrongWrong)")
    }
}

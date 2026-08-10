import CoreImage
import Foundation
import ImageIO
import XCTest
@testable import TCGer

/// Measures rescue-only image transforms against labeled device crops. The
/// test is environment-gated and diagnostic: production preprocessing must
/// not change unless a variant improves recall without introducing strong
/// wrong top-1 results on this set and the full scanner replay corpus.
@MainActor
final class ScannerLightingExperimentTests: XCTestCase {
    private struct EvidenceRecord: Decodable {
        let imageFile: String
        let attemptImageFiles: [String]
        let attempts: [Attempt]
    }

    private struct Attempt: Decodable {
        let kind: String
        let imageIndex: Int
    }

    private enum Variant: String, CaseIterable {
        case baseline
        case exposureDown
        case highlightCompression
        case sharpen
        case highlightCompressionAndSharpen

        func apply(to image: CGImage, context: CIContext) -> CGImage? {
            guard self != .baseline else { return image }
            var output = CIImage(cgImage: image)
            switch self {
            case .baseline:
                break
            case .exposureDown:
                output = output.applyingFilter(
                    "CIExposureAdjust",
                    parameters: [kCIInputEVKey: -0.35]
                )
            case .highlightCompression:
                output = Self.compressHighlights(output)
            case .sharpen:
                output = Self.sharpen(output)
            case .highlightCompressionAndSharpen:
                output = Self.sharpen(Self.compressHighlights(output))
            }
            return context.createCGImage(output, from: output.extent)
        }

        private static func compressHighlights(_ image: CIImage) -> CIImage {
            image.applyingFilter(
                "CIHighlightShadowAdjust",
                parameters: [
                    "inputHighlightAmount": 0.65,
                    "inputShadowAmount": 0.15,
                ]
            )
        }

        private static func sharpen(_ image: CIImage) -> CIImage {
            image.applyingFilter(
                "CISharpenLuminance",
                parameters: ["inputSharpness": 0.35]
            )
        }
    }

    private struct Totals {
        var frames = 0
        var top1Correct = 0
        var correctAtStrongThreshold = 0
        var wrongAtStrongThreshold = 0
        var correctScoreSum = 0.0
        var gateScoreSum = 0.0
    }

    private static let expectedCards: [String: String] = [
        "frame-0000.jpg": "me05-043",
        "frame-0001.jpg": "me05-043",
        "frame-0002.jpg": "me05-043",
        "frame-0003.jpg": "me05-043",
        "frame-0004.jpg": "me05-043",
        "frame-0005.jpg": "me04-051",
        "frame-0006.jpg": "me04-051",
        "frame-0007.jpg": "me05-040",
        "frame-0008.jpg": "me05-040",
        "frame-0009.jpg": "me05-040",
        "frame-0010.jpg": "swshp-SWSH204",
        "frame-0011.jpg": "dp4-104",
        "frame-0012.jpg": "pl4-AR3",
        "frame-0013.jpg": "pl4-AR3",
        "frame-0014.jpg": "dpp-DP30",
        "frame-0015.jpg": "dpp-DP38",
        "frame-0016.jpg": "dpp-DP38",
        "frame-0017.jpg": "dpp-DP38",
        "frame-0018.jpg": "dpp-DP30",
        "frame-0019.jpg": "dpp-DP30",
        "frame-0020.jpg": "dpp-DP30",
        "frame-0021.jpg": "dpp-DP30",
        "frame-0022.jpg": "dpp-DP30",
        "frame-0023.jpg": "dp4-103",
        "frame-0024.jpg": "dp4-103",
        "frame-0025.jpg": "dp4-103",
        "frame-0026.jpg": "dp4-103",
        "frame-0027.jpg": "dp4-103",
        "frame-0028.jpg": "dp4-103",
    ]

    func testLightingRescueVariants() async throws {
        guard let path = ProcessInfo.processInfo.environment["LIGHTING_EXPERIMENT_SESSION_DIR"] else {
            throw XCTSkip("Set LIGHTING_EXPERIMENT_SESSION_DIR to scan-session-20260809-190752.")
        }
        let root = URL(fileURLWithPath: path, isDirectory: true)
        let evidence = try JSONDecoder().decode(
            [EvidenceRecord].self,
            from: Data(contentsOf: root.appendingPathComponent("evidence.json"))
        )
        let records = evidence.filter { Self.expectedCards[$0.imageFile] != nil }
        XCTAssertEqual(records.count, Self.expectedCards.count)

        let encoder = CardEmbeddingEncoder()
        let index = AnnoyIndexStore()
        let metadata = CardIndexMetadataStore.shared
        let gate = CardFaceRejectionGate.loadBundled()
        let allowed = await metadata.indices(for: .pokemon, setCode: nil)
        let ciContext = CIContext(options: [.cacheIntermediates: false])
        var totals = Dictionary(uniqueKeysWithValues: Variant.allCases.map { ($0, Totals()) })

        for record in records.sorted(by: { $0.imageFile < $1.imageFile }) {
            guard let expected = Self.expectedCards[record.imageFile],
                  let attempt = record.attempts.first(where: { $0.kind == "detectedCrop" })
                    ?? record.attempts.first,
                  record.attemptImageFiles.indices.contains(attempt.imageIndex)
            else { continue }
            let imageURL = root.appendingPathComponent(record.attemptImageFiles[attempt.imageIndex])
            guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { continue }

            for variant in Variant.allCases {
                guard let transformed = variant.apply(to: image, context: ciContext) else { continue }
                let embedding = try await encoder.embedding(for: transformed)
                let gateScore = gate?.cardFaceScore(for: embedding) ?? 0
                let matches = try await index.nearestNeighbors(
                    for: embedding,
                    limit: 10,
                    allowedIndices: allowed
                )
                var ranked: [(id: String, score: Double)] = []
                for match in matches {
                    guard let entry = await metadata.entry(for: match.index) else { continue }
                    ranked.append((entry.cardId, 1 - match.distance))
                }
                let top = ranked.first
                let correct = ranked.first(where: { $0.id == expected })
                var value = totals[variant] ?? Totals()
                value.frames += 1
                value.gateScoreSum += gateScore
                value.correctScoreSum += correct?.score ?? 0
                if top?.id == expected { value.top1Correct += 1 }
                if top?.id == expected, (top?.score ?? 0) >= 0.70 {
                    value.correctAtStrongThreshold += 1
                }
                if top?.id != expected, (top?.score ?? 0) >= 0.70 {
                    value.wrongAtStrongThreshold += 1
                }
                totals[variant] = value
                print(String(
                    format: "LIGHTING %@ %@ expected=%@ top=%@@%.3f correct=%.3f gate=%.3f",
                    record.imageFile,
                    variant.rawValue,
                    expected,
                    top?.id ?? "none",
                    top?.score ?? 0,
                    correct?.score ?? 0,
                    gateScore
                ))
            }
        }

        for variant in Variant.allCases {
            let value = totals[variant] ?? Totals()
            let divisor = Double(max(value.frames, 1))
            print(String(
                format: "LIGHTING SUMMARY %@ frames=%d top1=%d strongCorrect=%d strongWrong=%d meanCorrect=%.3f meanGate=%.3f",
                variant.rawValue,
                value.frames,
                value.top1Correct,
                value.correctAtStrongThreshold,
                value.wrongAtStrongThreshold,
                value.correctScoreSum / divisor,
                value.gateScoreSum / divisor
            ))
        }
    }
}

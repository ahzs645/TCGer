import CoreImage
import Foundation
import ImageIO
import UIKit
import XCTest
@preconcurrency import Vision
@testable import TCGer

/// Evaluates explicit manual-correction labels through three orientation paths:
///
/// 1. the source image rotated 0/90/180/270 degrees and embedded directly;
/// 2. each source rotation passed through the production portrait-geometry
///    preprocessing in `CardCropper.normalizedWholeImage`;
/// 3. an experimental semantic 180-degree retry, performed only when path 2
///    scores below the strong ANN threshold.
///
/// This is intentionally test-only. It quantifies the accuracy, false-accept,
/// embedding-count, and runtime tradeoff before any production retry is added.
/// When a correction was edited more than once, the final label for identical
/// image bytes wins. Corrected "no match" crops remain as negative labels.
@MainActor
final class ScannerOrientationExperimentTests: XCTestCase {
    private static let strongAcceptanceScore = 0.72

    private enum SourceRotation: String, CaseIterable {
        case degrees0 = "0deg"
        case degrees90 = "90deg"
        case degrees180 = "180deg"
        case degrees270 = "270deg"

        private var imageOrientation: CGImagePropertyOrientation {
            switch self {
            case .degrees0: .up
            case .degrees90: .right
            case .degrees180: .down
            case .degrees270: .left
            }
        }

        func apply(to image: CGImage, context: CIContext) -> CGImage? {
            var output = CIImage(cgImage: image).oriented(imageOrientation)
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

    private struct VariantResult {
        let top: Candidate
        let expectedRank: Int?
        let expectedScore: Double?
    }

    private struct Totals {
        var frames = 0
        var positiveFrames = 0
        var negativeFrames = 0
        var exactTop1 = 0
        var expectedInTop5 = 0
        var strongCorrect = 0
        var strongWrong = 0
        var strongAbstain = 0

        mutating func record(_ result: VariantResult, expected: String?) {
            frames += 1
            if let expected {
                positiveFrames += 1
                if result.top.id == expected { exactTop1 += 1 }
                if let rank = result.expectedRank, rank <= 5 { expectedInTop5 += 1 }
                if result.top.score < ScannerOrientationExperimentTests.strongAcceptanceScore {
                    strongAbstain += 1
                } else if result.top.id == expected {
                    strongCorrect += 1
                } else {
                    strongWrong += 1
                }
            } else {
                negativeFrames += 1
                if result.top.score >= ScannerOrientationExperimentTests.strongAcceptanceScore {
                    strongWrong += 1
                } else {
                    strongAbstain += 1
                }
            }
        }
    }

    private struct GeometryTotals {
        var scenes = 0
        var detectorFound = 0
        var cropFound = 0
        var refinedWithFallbackAvailable = 0
        var axisAlignedFallback = 0
        var exactTop1 = 0
        var strongCorrect = 0
        var strongWrong = 0
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

        var finalFramesByImageData: [Data: RecordedScanFrame] = [:]
        for frame in bundle.frames.sorted(by: { $0.index < $1.index })
            where frame.expectedCardId != nil || frame.expectedNoMatch != nil {
            let data = try Data(contentsOf: root.appendingPathComponent(frame.imageFile))
            finalFramesByImageData[data] = frame
        }
        let frameFilter = ProcessInfo.processInfo.environment["ORIENTATION_EXPERIMENT_FRAME"]
        let labeledFrames = finalFramesByImageData.values
            .filter { frameFilter == nil || $0.imageFile == frameFilter }
            .sorted { $0.index < $1.index }
        XCTAssertFalse(labeledFrames.isEmpty, "no manual corrections in \(path)")

        let encoder = CardEmbeddingEncoder()
        let index = AnnoyIndexStore()
        let metadata = CardIndexMetadataStore.shared
        let allowed = await metadata.indices(for: .pokemon, setCode: nil)
        let ciContext = CIContext(options: [.cacheIntermediates: false])
        let cropper = CardCropper(detector: nil)
        var rawTotals = Dictionary(uniqueKeysWithValues: SourceRotation.allCases.map { ($0, Totals()) })
        var normalizedTotals = rawTotals
        var abstentionRetryTotals = rawTotals
        var bestRawTotals = Totals()
        var bestNormalizedTotals = Totals()
        var bestRetryTotals = Totals()
        var rawEmbeddingSeconds: TimeInterval = 0
        var normalizedEmbeddingSeconds: TimeInterval = 0
        var retryEmbeddingSeconds: TimeInterval = 0
        var retryEmbeddingCount = 0
        let experimentStarted = Date()

        func rank(_ image: CGImage, expected: String?) async throws -> (VariantResult, TimeInterval) {
            let started = Date()
            let embedding = try await encoder.embedding(for: image)
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
            let top = try XCTUnwrap(ranked.first, "no ANN candidates")
            let result = VariantResult(
                top: top,
                expectedRank: expected.flatMap { expected in
                    ranked.firstIndex(where: { $0.id == expected }).map { $0 + 1 }
                },
                expectedScore: expected.flatMap { expected in
                    ranked.first(where: { $0.id == expected })?.score
                }
            )
            return (result, Date().timeIntervalSince(started))
        }

        for frame in labeledFrames {
            let expected = frame.expectedNoMatch == true ? nil : frame.expectedCardId
            let imageURL = root.appendingPathComponent(frame.imageFile)
            guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else {
                XCTFail("could not decode \(frame.imageFile)")
                continue
            }

            var rawResults: [SourceRotation: VariantResult] = [:]
            var normalizedResults: [SourceRotation: VariantResult] = [:]
            var retryResults: [SourceRotation: VariantResult] = [:]

            for rotation in SourceRotation.allCases {
                guard let rotated = rotation.apply(to: image, context: ciContext) else {
                    XCTFail("could not rotate \(frame.imageFile) at \(rotation.rawValue)")
                    continue
                }

                let (rawResult, rawSeconds) = try await rank(rotated, expected: expected)
                rawEmbeddingSeconds += rawSeconds
                rawResults[rotation] = rawResult
                rawTotals[rotation, default: Totals()].record(rawResult, expected: expected)

                guard let normalized = cropper.normalizedWholeImage(from: rotated) else {
                    XCTFail("could not normalize \(frame.imageFile) at \(rotation.rawValue)")
                    continue
                }
                XCTAssertEqual(normalized.width, Int(CardCropper.Configuration.targetSize.width))
                XCTAssertEqual(normalized.height, Int(CardCropper.Configuration.targetSize.height))
                let (normalizedResult, normalizedSeconds) = try await rank(normalized, expected: expected)
                normalizedEmbeddingSeconds += normalizedSeconds
                normalizedResults[rotation] = normalizedResult
                normalizedTotals[rotation, default: Totals()].record(normalizedResult, expected: expected)

                var retryPolicyResult = normalizedResult
                if normalizedResult.top.score < Self.strongAcceptanceScore,
                   let semanticFlip = SourceRotation.degrees180.apply(to: normalized, context: ciContext) {
                    let (flippedResult, retrySeconds) = try await rank(semanticFlip, expected: expected)
                    retryEmbeddingSeconds += retrySeconds
                    retryEmbeddingCount += 1
                    if flippedResult.top.score > retryPolicyResult.top.score {
                        retryPolicyResult = flippedResult
                    }
                }
                retryResults[rotation] = retryPolicyResult
                abstentionRetryTotals[rotation, default: Totals()].record(
                    retryPolicyResult,
                    expected: expected
                )

                printResult("raw", frame.imageFile, rotation, expected, rawResult)
                printResult("normalized", frame.imageFile, rotation, expected, normalizedResult)
                printResult("abstention180", frame.imageFile, rotation, expected, retryPolicyResult)
            }

            if let best = rawResults.values.max(by: { $0.top.score < $1.top.score }) {
                bestRawTotals.record(best, expected: expected)
            }
            if let best = normalizedResults.values.max(by: { $0.top.score < $1.top.score }) {
                bestNormalizedTotals.record(best, expected: expected)
            }
            if let best = retryResults.values.max(by: { $0.top.score < $1.top.score }) {
                bestRetryTotals.record(best, expected: expected)
            }
        }

        for rotation in SourceRotation.allCases {
            let raw = rawTotals[rotation] ?? Totals()
            let normalized = normalizedTotals[rotation] ?? Totals()
            let retry = abstentionRetryTotals[rotation] ?? Totals()
            XCTAssertEqual(raw.frames, labeledFrames.count)
            XCTAssertEqual(normalized.frames, labeledFrames.count)
            XCTAssertEqual(retry.frames, labeledFrames.count)
            printSummary("raw/\(rotation.rawValue)", raw)
            printSummary("normalized/\(rotation.rawValue)", normalized)
            printSummary("abstention180/\(rotation.rawValue)", retry)
        }
        XCTAssertEqual(bestRawTotals.frames, labeledFrames.count)
        XCTAssertEqual(bestNormalizedTotals.frames, labeledFrames.count)
        XCTAssertEqual(bestRetryTotals.frames, labeledFrames.count)
        printSummary("raw/bestOfFour", bestRawTotals)
        printSummary("normalized/bestOfFour", bestNormalizedTotals)
        printSummary("abstention180/bestOfFour", bestRetryTotals)

        let baseEmbeddingCount = labeledFrames.count * SourceRotation.allCases.count
        print(String(
            format: "ORIENTATION RUNTIME wall=%.3fs rawEmbeddings=%d rawEmbeddingTime=%.3fs normalizedEmbeddings=%d normalizedEmbeddingTime=%.3fs retryExtraEmbeddings=%d retryEmbeddingTime=%.3fs",
            Date().timeIntervalSince(experimentStarted),
            baseEmbeddingCount,
            rawEmbeddingSeconds,
            baseEmbeddingCount,
            normalizedEmbeddingSeconds,
            retryEmbeddingCount,
            retryEmbeddingSeconds
        ))
    }

    /// Places one or more real, human-labeled card crops into synthetic camera
    /// scenes at non-cardinal angles. Geometry is measured independently for
    /// upright and upside-down artwork because rectangle localization should
    /// be invariant to semantic orientation, while ANN recognition is not.
    func testManualCorrectionArbitraryAngleGeometry() async throws {
        guard let path = ProcessInfo.processInfo.environment["ORIENTATION_EXPERIMENT_SESSION_DIR"] else {
            throw XCTSkip("Set ORIENTATION_EXPERIMENT_SESSION_DIR to a labeled dev-mode session.")
        }
        let root = URL(fileURLWithPath: path, isDirectory: true)
        let bundle = try JSONDecoder().decode(
            RecordedScanBundle.self,
            from: Data(contentsOf: root.appendingPathComponent("results.json"))
        )
        var finalFramesByImageData: [Data: RecordedScanFrame] = [:]
        for frame in bundle.frames.sorted(by: { $0.index < $1.index })
            where frame.expectedCardId != nil {
            let data = try Data(contentsOf: root.appendingPathComponent(frame.imageFile))
            finalFramesByImageData[data] = frame
        }
        let frameFilter = ProcessInfo.processInfo.environment["ORIENTATION_EXPERIMENT_FRAME"]
        let allPositiveFrames = finalFramesByImageData.values
            .filter { frameFilter == nil || $0.imageFile == frameFilter }
            .sorted { $0.index < $1.index }
        let useAllLabels = ProcessInfo.processInfo.environment[
            "ORIENTATION_EXPERIMENT_GEOMETRY_ALL_LABELS"
        ] == "1"
        let labeledFrames = useAllLabels ? allPositiveFrames : Array(allPositiveFrames.prefix(1))
        XCTAssertFalse(labeledFrames.isEmpty, "no positive manual corrections in \(path)")

        let angles: [CGFloat] = [-75, -60, -45, -30, -15, 15, 30, 45, 60, 75]
        let perspectiveAngles: Set<CGFloat> = [-60, -30, 30, 60]
        let cropper = CardCropper()
        let detector = CardObjectDetector.shared
        let encoder = CardEmbeddingEncoder()
        let index = AnnoyIndexStore()
        let metadata = CardIndexMetadataStore.shared
        let allowed = await metadata.indices(for: .pokemon, setCode: nil)
        var totalsByKind: [String: GeometryTotals] = [:]
        let started = Date()

        for frame in labeledFrames {
            let expected = try XCTUnwrap(frame.expectedCardId)
            let imageURL = root.appendingPathComponent(frame.imageFile)
            guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                  let card = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else {
                XCTFail("could not decode \(frame.imageFile)")
                continue
            }

            for angle in angles {
                let perspectiveOptions = perspectiveAngles.contains(angle) ? [false, true] : [false]
                for mildPerspective in perspectiveOptions {
                    for semantic180 in [false, true] {
                        let kind = "\(mildPerspective ? "perspective" : "flat")/"
                            + "\(semantic180 ? "semantic180" : "upright")"
                        var totals = totalsByKind[kind] ?? GeometryTotals()
                        totals.scenes += 1

                        guard let scene = makeScene(
                            card: card,
                            angle: angle,
                            semantic180: semantic180,
                            mildPerspective: mildPerspective
                        ) else {
                            XCTFail("could not render scene at \(angle) degrees")
                            totalsByKind[kind] = totals
                            continue
                        }

                        let detections = (try? detector?.detections(in: scene)) ?? []
                        if !detections.isEmpty { totals.detectorFound += 1 }
                        let detailed = try cropper.detectRectanglesDetailed(in: scene)
                        guard let observation = CardCropper.preferredObservation(
                            from: detailed.observations
                        ), let crop = cropper.makeNormalizedCrop(
                            from: scene,
                            observation: observation
                        ) else {
                            print("ANGLEGEOMETRY frame=\(frame.imageFile) angle=\(angle) "
                                + "perspective=\(mildPerspective) semantic180=\(semantic180) "
                                + "detector=\(detections.count) observations=\(detailed.observations.count) "
                                + "crop=nil")
                            totalsByKind[kind] = totals
                            continue
                        }

                        totals.cropFound += 1
                        let usedFallback = isAxisAligned(observation)
                        if usedFallback { totals.axisAlignedFallback += 1 }
                        if detailed.alternateBox != nil {
                            totals.refinedWithFallbackAvailable += 1
                        }

                        let embedding = try await encoder.embedding(for: crop)
                        let matches = try await index.nearestNeighbors(
                            for: embedding,
                            limit: 5,
                            allowedIndices: allowed
                        )
                        var ranked: [Candidate] = []
                        for match in matches {
                            guard let entry = await metadata.entry(for: match.index) else { continue }
                            ranked.append(Candidate(id: entry.cardId, score: 1 - match.distance))
                        }
                        let top = try XCTUnwrap(ranked.first)
                        if top.id == expected { totals.exactTop1 += 1 }
                        if top.score >= Self.strongAcceptanceScore {
                            if top.id == expected {
                                totals.strongCorrect += 1
                            } else {
                                totals.strongWrong += 1
                            }
                        }
                        let expectedRank = ranked.firstIndex(where: { $0.id == expected })
                            .map { $0 + 1 } ?? 0
                        let route = usedFallback ? "axisFallback"
                            : detailed.alternateBox == nil ? "directQuad" : "refinedQuad"
                        print(String(
                            format: "ANGLEGEOMETRY frame=%@ angle=%+.0f perspective=%@ semantic180=%@ detector=%d observations=%d route=%@ top=%@@%.3f expected=%@ rank=%d",
                            frame.imageFile,
                            angle,
                            mildPerspective.description,
                            semantic180.description,
                            detections.count,
                            detailed.observations.count,
                            route,
                            top.id,
                            top.score,
                            expected,
                            expectedRank
                        ))
                        totalsByKind[kind] = totals
                    }
                }
            }
        }

        for kind in totalsByKind.keys.sorted() {
            let value = totalsByKind[kind] ?? GeometryTotals()
            print("ANGLEGEOMETRY SUMMARY \(kind) scenes=\(value.scenes) "
                + "detectorFound=\(value.detectorFound) cropFound=\(value.cropFound) "
                + "refined=\(value.refinedWithFallbackAvailable) "
                + "axisFallback=\(value.axisAlignedFallback) exactTop1=\(value.exactTop1) "
                + "strongCorrect=\(value.strongCorrect) strongWrong=\(value.strongWrong)")
        }
        print(String(
            format: "ANGLEGEOMETRY RUNTIME wall=%.3fs labels=%d",
            Date().timeIntervalSince(started),
            labeledFrames.count
        ))
    }

    private func makeScene(
        card: CGImage,
        angle: CGFloat,
        semantic180: Bool,
        mildPerspective: Bool
    ) -> CGImage? {
        let cardSize = CGSize(width: 600, height: 840)
        let cardFormat = UIGraphicsImageRendererFormat.preferred()
        cardFormat.scale = 1
        cardFormat.opaque = false
        var cardImage = UIGraphicsImageRenderer(size: cardSize, format: cardFormat).image { _ in
            UIImage(cgImage: card).draw(in: CGRect(origin: .zero, size: cardSize))
        }
        if mildPerspective, let input = CIImage(image: cardImage) {
            let width = input.extent.width
            let height = input.extent.height
            let output = input.applyingFilter("CIPerspectiveTransform", parameters: [
                "inputTopLeft": CIVector(x: width * 0.08, y: height * 0.98),
                "inputTopRight": CIVector(x: width * 0.94, y: height * 0.93),
                "inputBottomLeft": CIVector(x: width * 0.02, y: height * 0.04),
                "inputBottomRight": CIVector(x: width * 0.99, y: height * 0.01)
            ]).cropped(to: input.extent)
            if let transformed = CIContext(options: [.cacheIntermediates: false])
                .createCGImage(output, from: input.extent) {
                cardImage = UIImage(cgImage: transformed)
            }
        }

        let sceneSize = CGSize(width: 1_200, height: 1_600)
        let sceneFormat = UIGraphicsImageRendererFormat.preferred()
        sceneFormat.scale = 1
        sceneFormat.opaque = true
        let scene = UIGraphicsImageRenderer(size: sceneSize, format: sceneFormat).image { context in
            UIColor(white: 0.12, alpha: 1).setFill()
            context.fill(CGRect(origin: .zero, size: sceneSize))
            context.cgContext.translateBy(x: sceneSize.width / 2, y: sceneSize.height / 2)
            let semanticDegrees: CGFloat = semantic180 ? 180 : 0
            context.cgContext.rotate(by: (angle + semanticDegrees) * .pi / 180)
            cardImage.draw(in: CGRect(
                x: -cardSize.width / 2,
                y: -cardSize.height / 2,
                width: cardSize.width,
                height: cardSize.height
            ))
        }
        return scene.cgImage
    }

    private func isAxisAligned(_ observation: VNRectangleObservation) -> Bool {
        let bounds = observation.boundingBox
        let tolerance: CGFloat = 0.01
        func close(_ lhs: CGPoint, _ rhs: CGPoint) -> Bool {
            abs(lhs.x - rhs.x) <= tolerance && abs(lhs.y - rhs.y) <= tolerance
        }
        return close(observation.topLeft, CGPoint(x: bounds.minX, y: bounds.maxY))
            && close(observation.topRight, CGPoint(x: bounds.maxX, y: bounds.maxY))
            && close(observation.bottomLeft, CGPoint(x: bounds.minX, y: bounds.minY))
            && close(observation.bottomRight, CGPoint(x: bounds.maxX, y: bounds.minY))
    }

    private func printResult(
        _ pipeline: String,
        _ imageFile: String,
        _ rotation: SourceRotation,
        _ expected: String?,
        _ result: VariantResult
    ) {
        print(String(
            format: "ORIENTATION %@ %@ %@ expected=%@ top=%@@%.3f expectedRank=%d expectedScore=%.3f",
            pipeline,
            imageFile,
            rotation.rawValue,
            expected ?? "noMatch",
            result.top.id,
            result.top.score,
            result.expectedRank ?? 0,
            result.expectedScore ?? 0
        ))
    }

    private func printSummary(_ name: String, _ value: Totals) {
        print("ORIENTATION SUMMARY \(name) frames=\(value.frames) "
            + "positive=\(value.positiveFrames) negative=\(value.negativeFrames) "
            + "exactTop1=\(value.exactTop1) top5=\(value.expectedInTop5) "
            + "strongCorrect=\(value.strongCorrect) strongWrong=\(value.strongWrong) "
            + "strongAbstain=\(value.strongAbstain)")
    }
}

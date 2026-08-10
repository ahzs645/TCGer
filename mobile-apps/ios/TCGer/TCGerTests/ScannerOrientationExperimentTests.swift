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

    private struct BinderEvidenceRecord: Decodable {
        let imageFile: String
        let attemptImageFiles: [String]
        let attempts: [ScanDiagnostics.Attempt]
    }

    private struct BinderWarpSample {
        let record: BinderEvidenceRecord
        let offset: Int
        let attempt: ScanDiagnostics.Attempt
        let expected: String
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

    /// Compares perspective/corner-ordering hypotheses on one manually labeled
    /// crop from a real binder export. This remains environment-gated because
    /// exported binder sessions do not yet persist per-slot ground truth.
    func testLabeledBinderPerspectiveVariants() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["BINDER_ORIENTATION_EXPERIMENT_SESSION_DIR"],
              let frameFile = environment["BINDER_ORIENTATION_EXPERIMENT_FRAME"],
              let attemptText = environment["BINDER_ORIENTATION_EXPERIMENT_ATTEMPT"],
              let attemptOffset = Int(attemptText),
              let expected = environment["BINDER_ORIENTATION_EXPERIMENT_EXPECTED"]
        else {
            throw XCTSkip(
                "Set BINDER_ORIENTATION_EXPERIMENT_SESSION_DIR, _FRAME, _ATTEMPT, and _EXPECTED."
            )
        }

        let root = URL(fileURLWithPath: path, isDirectory: true)
        let evidence = try JSONDecoder().decode(
            [BinderEvidenceRecord].self,
            from: Data(contentsOf: root.appendingPathComponent("evidence.json"))
        )
        let record = try XCTUnwrap(evidence.first { $0.imageFile == frameFile })
        XCTAssertTrue(record.attempts.indices.contains(attemptOffset))
        let attempt = record.attempts[attemptOffset]
        let attemptImageFile = try XCTUnwrap(
            record.attemptImageFiles.indices.contains(attempt.imageIndex)
                ? record.attemptImageFiles[attempt.imageIndex]
                : nil
        )
        // Evidence quads are normalized in the persisted scanner-input image
        // (`imageFile`), not the optional full camera original.
        let original = try loadImage(root.appendingPathComponent(record.imageFile))
        let archivedCrop = try loadImage(root.appendingPathComponent(attemptImageFile))
        let observation = try observation(from: XCTUnwrap(attempt.quad))
        let screenUprightObservation = screenUprightObservation(
            from: observation,
            imageSize: CGSize(width: original.width, height: original.height)
        )
        let cropper = CardCropper(detector: nil)
        let currentCrop = try XCTUnwrap(
            cropper.makeNormalizedCrop(from: original, observation: observation)
        )
        let reorderedCrop = try XCTUnwrap(
            cropper.makeNormalizedCrop(from: original, observation: screenUprightObservation)
        )
        let ciContext = CIContext(options: [.cacheIntermediates: false])
        let reordered180 = try XCTUnwrap(
            SourceRotation.degrees180.apply(to: reorderedCrop, context: ciContext)
        )

        let encoder = CardEmbeddingEncoder()
        let index = AnnoyIndexStore()
        let metadata = CardIndexMetadataStore.shared
        let allowed = await metadata.indices(for: .pokemon, setCode: nil)

        func rank(_ image: CGImage) async throws -> VariantResult {
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
            let top = try XCTUnwrap(ranked.first)
            return VariantResult(
                top: top,
                expectedRank: ranked.firstIndex(where: { $0.id == expected }).map { $0 + 1 },
                expectedScore: ranked.first(where: { $0.id == expected })?.score
            )
        }

        var variants: [(String, CGImage)] = [
            ("archivedBinderCrop", archivedCrop),
            ("currentCardCropper", currentCrop),
            ("shortEdgeReordered", reorderedCrop),
            ("shortEdgeReordered180", reordered180),
        ]
        if let detector = CardObjectDetector.shared,
           let detectorBox = try detector.detections(in: original).max(by: {
               CardCropper.intersectionOverUnion($0.boundingBox, observation.boundingBox)
                   < CardCropper.intersectionOverUnion($1.boundingBox, observation.boundingBox)
           }) {
            if let detectorBoxCrop = cropper.makeNormalizedCrop(
                from: original,
                observation: CardCropper.rectangleObservation(for: detectorBox.boundingBox)
            ) {
                variants.append(("detectorAxisBox", detectorBoxCrop))
            }
            for (index, outerBorder) in outerBorderObservations(
                in: original,
                around: detectorBox.boundingBox
            ).enumerated() {
                if let outerCrop = cropper.makeNormalizedCrop(
                    from: original,
                    observation: outerBorder
                ) {
                    variants.append(("outerBorderHough\(index)", outerCrop))
                }
            }
        }
        for (name, image) in variants {
            let result = try await rank(image)
            print(String(
                format: "BINDERORIENTATION %@ frame=%@ attempt=%d expected=%@ top=%@@%.3f expectedRank=%d expectedScore=%.3f",
                name,
                frameFile,
                attemptOffset,
                expected,
                result.top.id,
                result.top.score,
                result.expectedRank ?? 0,
                result.expectedScore ?? 0
            ))
            if name == "detectorAxisBox" || name.hasPrefix("outerBorderHough") {
                let coordinatorResult = await CardScannerCoordinator.makeDefault().scan(
                    image: image,
                    context: .test(engine: .localOnly),
                    source: .photoCapture
                )
                switch coordinatorResult {
                case .success(let scan):
                    print("BINDERORIENTATION coordinator \(name) "
                        + "top=\(scan.primary.details.identity.id)@"
                        + String(format: "%.3f", scan.primary.confidence.score))
                case .failure(let error):
                    print("BINDERORIENTATION coordinator \(name) failure=\(error)")
                }
            }
        }
    }

    /// Uses the device's strongly accepted binder attempts as regression
    /// labels, then asks whether detector-box and outer-border warps preserve
    /// that identity. These are pseudo-labels, not a replacement for human
    /// ground truth, but they are useful for rejecting a warp hypothesis that
    /// damages already-good manual-shutter captures.
    func testAcceptedBinderWarpVariants() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["BINDER_WARP_EXPERIMENT_SESSION_DIR"] else {
            throw XCTSkip("Set BINDER_WARP_EXPERIMENT_SESSION_DIR to a binder dev-mode session.")
        }
        let limit = environment["BINDER_WARP_EXPERIMENT_LIMIT"].flatMap(Int.init) ?? 20
        let root = URL(fileURLWithPath: path, isDirectory: true)
        let evidence = try JSONDecoder().decode(
            [BinderEvidenceRecord].self,
            from: Data(contentsOf: root.appendingPathComponent("evidence.json"))
        )
        let allSamples: [BinderWarpSample] = evidence.flatMap { record in
            record.attempts.enumerated().compactMap { offset, attempt -> BinderWarpSample? in
                guard attempt.outcome == .accepted,
                      attempt.quad != nil,
                      let expected = attempt.topCandidates.first,
                      expected.similarity >= 0.82
                else { return nil }
                return BinderWarpSample(
                    record: record,
                    offset: offset,
                    attempt: attempt,
                    expected: expected.cardID
                )
            }
        }
        let samples = Array(allSamples.prefix(limit))
        XCTAssertFalse(samples.isEmpty, "no strongly accepted binder attempts in \(path)")

        let cropper = CardCropper(detector: nil)
        let detector = try XCTUnwrap(CardObjectDetector.shared)
        let encoder = CardEmbeddingEncoder()
        let index = AnnoyIndexStore()
        let metadata = CardIndexMetadataStore.shared
        let allowed = await metadata.indices(for: .pokemon, setCode: nil)
        var refinedTotals = Totals()
        var detectorTotals = Totals()
        var outerBorderPolicyTotals = Totals()
        var proposals = 0
        var houghSeconds: TimeInterval = 0

        func rank(_ image: CGImage, expected: String) async throws -> VariantResult {
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
            let top = try XCTUnwrap(ranked.first)
            return VariantResult(
                top: top,
                expectedRank: ranked.firstIndex(where: { $0.id == expected }).map { $0 + 1 },
                expectedScore: ranked.first(where: { $0.id == expected })?.score
            )
        }

        for sample in samples {
            let original = try loadImage(root.appendingPathComponent(sample.record.imageFile))
            let refined = try observation(from: XCTUnwrap(sample.attempt.quad))
            guard let refinedCrop = cropper.makeNormalizedCrop(
                from: original,
                observation: refined
            ) else {
                XCTFail("refined crop failed for \(sample.record.imageFile)#\(sample.offset)")
                continue
            }
            let refinedResult = try await rank(refinedCrop, expected: sample.expected)
            refinedTotals.record(refinedResult, expected: sample.expected)

            let detections = try detector.detections(in: original)
            guard let box = detections.max(by: {
                CardCropper.intersectionOverUnion($0.boundingBox, refined.boundingBox)
                    < CardCropper.intersectionOverUnion($1.boundingBox, refined.boundingBox)
            }), let detectorCrop = cropper.makeNormalizedCrop(
                from: original,
                observation: CardCropper.rectangleObservation(for: box.boundingBox)
            ) else {
                XCTFail("detector crop failed for \(sample.record.imageFile)#\(sample.offset)")
                continue
            }
            let detectorResult = try await rank(detectorCrop, expected: sample.expected)
            detectorTotals.record(detectorResult, expected: sample.expected)

            let houghStarted = Date()
            let observations = outerBorderObservations(in: original, around: box.boundingBox)
            houghSeconds += Date().timeIntervalSince(houghStarted)
            proposals += observations.count
            var policyResult = detectorResult
            for observation in observations {
                guard let crop = cropper.makeNormalizedCrop(from: original, observation: observation)
                else { continue }
                let result = try await rank(crop, expected: sample.expected)
                if result.top.score > policyResult.top.score { policyResult = result }
            }
            outerBorderPolicyTotals.record(policyResult, expected: sample.expected)
            print(String(
                format: "BINDERWARP frame=%@ attempt=%d expected=%@ refined=%@@%.3f detector=%@@%.3f outerPolicy=%@@%.3f proposals=%d",
                sample.record.imageFile,
                sample.offset,
                sample.expected,
                refinedResult.top.id,
                refinedResult.top.score,
                detectorResult.top.id,
                detectorResult.top.score,
                policyResult.top.id,
                policyResult.top.score,
                observations.count
            ))
        }

        printSummary("binderWarp/refined", refinedTotals)
        printSummary("binderWarp/detectorBox", detectorTotals)
        printSummary("binderWarp/detectorPlusOuterBorder", outerBorderPolicyTotals)
        print(String(
            format: "BINDERWARP RUNTIME samples=%d proposals=%d houghCPU=%.3fs",
            refinedTotals.frames,
            proposals,
            houghSeconds
        ))
    }

    /// Test-only policy-evidence dump. For every strongly accepted binder
    /// attempt it records the full ANN candidate list and Laplacian sharpness
    /// for the refined crop, the detector-box crop, and every outer-border
    /// Hough proposal, as one JSON line per attempt. Crop variants are also
    /// saved as PNGs when a directory is provided. Selection policies
    /// (agreement, margin, hysteresis, sharpness gates, reference re-ranking)
    /// are then scored offline from one Simulator run instead of re-embedding
    /// once per policy.
    func testAcceptedBinderPolicyEvidence() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["BINDER_WARP_EXPERIMENT_SESSION_DIR"] else {
            throw XCTSkip("Set BINDER_WARP_EXPERIMENT_SESSION_DIR to a binder dev-mode session.")
        }
        guard let outputPath = environment["BINDER_POLICY_EVIDENCE_OUT"] else {
            throw XCTSkip("Set BINDER_POLICY_EVIDENCE_OUT to a writable JSONL path.")
        }
        let cropsDirectory = environment["BINDER_POLICY_EVIDENCE_CROPS_DIR"]
            .map { URL(fileURLWithPath: $0, isDirectory: true) }
        if let cropsDirectory {
            try FileManager.default.createDirectory(
                at: cropsDirectory,
                withIntermediateDirectories: true
            )
        }
        let limit = environment["BINDER_WARP_EXPERIMENT_LIMIT"].flatMap(Int.init) ?? 20
        let root = URL(fileURLWithPath: path, isDirectory: true)
        let evidence = try JSONDecoder().decode(
            [BinderEvidenceRecord].self,
            from: Data(contentsOf: root.appendingPathComponent("evidence.json"))
        )
        let allSamples: [BinderWarpSample] = evidence.flatMap { record in
            record.attempts.enumerated().compactMap { offset, attempt -> BinderWarpSample? in
                guard attempt.outcome == .accepted,
                      attempt.quad != nil,
                      let expected = attempt.topCandidates.first,
                      expected.similarity >= 0.82
                else { return nil }
                return BinderWarpSample(
                    record: record,
                    offset: offset,
                    attempt: attempt,
                    expected: expected.cardID
                )
            }
        }
        let samples = Array(allSamples.prefix(limit))
        XCTAssertFalse(samples.isEmpty, "no strongly accepted binder attempts in \(path)")

        let cropper = CardCropper(detector: nil)
        let detector = try XCTUnwrap(CardObjectDetector.shared)
        let encoder = CardEmbeddingEncoder()
        let index = AnnoyIndexStore()
        let metadata = CardIndexMetadataStore.shared
        let allowed = await metadata.indices(for: .pokemon, setCode: nil)

        func rankAll(_ image: CGImage) async throws -> [Candidate] {
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
            return ranked
        }

        var lines: [String] = []
        for sample in samples {
            let original = try loadImage(root.appendingPathComponent(sample.record.imageFile))
            var variants: [(name: String, crop: CGImage)] = []
            let refined = try observation(from: XCTUnwrap(sample.attempt.quad))
            if let refinedCrop = cropper.makeNormalizedCrop(from: original, observation: refined) {
                variants.append(("refined", refinedCrop))
            }
            let detections = try detector.detections(in: original)
            let box = detections.max(by: {
                CardCropper.intersectionOverUnion($0.boundingBox, refined.boundingBox)
                    < CardCropper.intersectionOverUnion($1.boundingBox, refined.boundingBox)
            })
            if let box {
                if let detectorCrop = cropper.makeNormalizedCrop(
                    from: original,
                    observation: CardCropper.rectangleObservation(for: box.boundingBox)
                ) {
                    variants.append(("detectorBox", detectorCrop))
                }
                // The production sub-image refinement as shipped (pixel-space
                // isCardShaped). Distinct from "refined", which replays the
                // quad the device recorded before the coordinate-space fix.
                if let productionQuad = cropper.refinedQuad(in: original, around: box.boundingBox),
                   let productionCrop = cropper.makeNormalizedCrop(
                       from: original,
                       observation: productionQuad
                   ) {
                    variants.append(("productionRefined", productionCrop))
                }
                for (offset, proposal) in outerBorderObservations(
                    in: original,
                    around: box.boundingBox
                ).enumerated() {
                    if let crop = cropper.makeNormalizedCrop(from: original, observation: proposal) {
                        variants.append(("hough\(offset)", crop))
                    }
                }
            }

            var variantPayloads: [[String: Any]] = []
            for variant in variants {
                let ranked = try await rankAll(variant.crop)
                if let cropsDirectory {
                    let fileName = "\(sample.record.imageFile)-a\(sample.offset)-\(variant.name).png"
                    savePNG(variant.crop, to: cropsDirectory.appendingPathComponent(fileName))
                }
                variantPayloads.append([
                    "name": variant.name,
                    "sharpness": laplacianVariance(of: variant.crop),
                    "candidates": ranked.map { ["id": $0.id, "score": $0.score] },
                ])
            }
            let payload: [String: Any] = [
                "frame": sample.record.imageFile,
                "attempt": sample.offset,
                "expected": sample.expected,
                "acceptedSimilarity": sample.attempt.topCandidates.first?.similarity ?? 0,
                "variants": variantPayloads,
            ]
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
            lines.append(String(decoding: data, as: UTF8.self))
            print("BINDERPOLICY progress \(lines.count)/\(samples.count) \(sample.record.imageFile)#\(sample.offset)")
        }
        try (lines.joined(separator: "\n") + "\n")
            .write(toFile: outputPath, atomically: true, encoding: .utf8)
        print("BINDERPOLICY wrote \(lines.count) samples to \(outputPath)")
    }

    /// Separates the two corner sources that `CardCropper.refinedQuad` merges,
    /// because "use a learned corner/mask head instead of hand-tuned geometry"
    /// is already half-shipped: the sub-image retry runs an ANE document
    /// segmentation model (the same family as LDRNet/RTMDet corner heads, and
    /// what VNDocumentCamera itself switched to) *and* a classical
    /// `VNDetectRectanglesRequest`, then keeps whichever wins area selection.
    /// Nothing measured which of the two the production quad actually comes
    /// from, so this scores them independently against the detector box, plus
    /// the corner-stage wall clock to compare with the Sobel/Hough proposal
    /// generator.
    ///
    /// Simulator Vision diverges from device Vision, so this also reports IoU
    /// against the recorded device quad. Read a low IoU as divergence evidence,
    /// not as a corner-source verdict.
    func testBinderCornerSourceVariants() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["BINDER_WARP_EXPERIMENT_SESSION_DIR"] else {
            throw XCTSkip("Set BINDER_WARP_EXPERIMENT_SESSION_DIR to a binder dev-mode session.")
        }
        let limit = environment["BINDER_WARP_EXPERIMENT_LIMIT"].flatMap(Int.init) ?? 20
        let skip = environment["BINDER_WARP_EXPERIMENT_SKIP"].flatMap(Int.init) ?? 0
        let root = URL(fileURLWithPath: path, isDirectory: true)
        let evidence = try JSONDecoder().decode(
            [BinderEvidenceRecord].self,
            from: Data(contentsOf: root.appendingPathComponent("evidence.json"))
        )
        let allSamples: [BinderWarpSample] = evidence.flatMap { record in
            record.attempts.enumerated().compactMap { offset, attempt -> BinderWarpSample? in
                guard attempt.outcome == .accepted,
                      attempt.quad != nil,
                      let expected = attempt.topCandidates.first,
                      expected.similarity >= 0.82
                else { return nil }
                return BinderWarpSample(
                    record: record,
                    offset: offset,
                    attempt: attempt,
                    expected: expected.cardID
                )
            }
        }
        let samples = Array(allSamples.dropFirst(skip).prefix(limit))
        XCTAssertFalse(samples.isEmpty, "no strongly accepted binder attempts in \(path)")

        let cropper = CardCropper(detector: nil)
        let detector = try XCTUnwrap(CardObjectDetector.shared)
        let encoder = CardEmbeddingEncoder()
        let index = AnnoyIndexStore()
        let metadata = CardIndexMetadataStore.shared
        let allowed = await metadata.indices(for: .pokemon, setCode: nil)

        func rank(_ image: CGImage, expected: String) async throws -> VariantResult {
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
            let top = try XCTUnwrap(ranked.first)
            return VariantResult(
                top: top,
                expectedRank: ranked.firstIndex(where: { $0.id == expected }).map { $0 + 1 },
                expectedScore: ranked.first(where: { $0.id == expected })?.score
            )
        }

        let variants: [CornerVariant] = [
            CornerVariant(name: "docSeg/normalizedShape", source: .documentSegmentation, shape: .normalized),
            CornerVariant(name: "both/normalizedShape", source: .both, shape: .normalized),
            CornerVariant(name: "docSeg/pixelShape", source: .documentSegmentation, shape: .pixel),
            CornerVariant(name: "rectangles/pixelShape", source: .rectangles, shape: .pixel),
            CornerVariant(name: "both/pixelShape", source: .both, shape: .pixel),
        ]
        var totals: [String: Totals] = ["recordedDevice": Totals(), "detectorBox": Totals()]
        var available: [String: Int] = [:]
        var seconds: [String: TimeInterval] = [:]
        var iouSum: [String: Double] = [:]
        var counters: [String: CornerCounters] = [:]
        for variant in variants { totals[variant.name] = Totals() }

        for sample in samples {
            let original = try loadImage(root.appendingPathComponent(sample.record.imageFile))
            let recorded = try observation(from: XCTUnwrap(sample.attempt.quad))
            if let crop = cropper.makeNormalizedCrop(from: original, observation: recorded) {
                totals["recordedDevice"]?.record(
                    try await rank(crop, expected: sample.expected),
                    expected: sample.expected
                )
                available["recordedDevice", default: 0] += 1
            }
            guard let box = try detector.detections(in: original).max(by: {
                CardCropper.intersectionOverUnion($0.boundingBox, recorded.boundingBox)
                    < CardCropper.intersectionOverUnion($1.boundingBox, recorded.boundingBox)
            }) else {
                XCTFail("no detection for \(sample.record.imageFile)#\(sample.offset)")
                continue
            }
            if let crop = cropper.makeNormalizedCrop(
                from: original,
                observation: CardCropper.rectangleObservation(for: box.boundingBox)
            ) {
                totals["detectorBox"]?.record(
                    try await rank(crop, expected: sample.expected),
                    expected: sample.expected
                )
                available["detectorBox", default: 0] += 1
                iouSum["detectorBox", default: 0] += Double(
                    CardCropper.intersectionOverUnion(box.boundingBox, recorded.boundingBox)
                )
            }

            for variant in variants {
                let started = Date()
                var variantCounters = counters[variant.name] ?? CornerCounters()
                let quad = cornerObservation(
                    in: original,
                    around: box.boundingBox,
                    source: variant.source,
                    shape: variant.shape,
                    counters: &variantCounters
                )
                counters[variant.name] = variantCounters
                seconds[variant.name, default: 0] += Date().timeIntervalSince(started)
                guard let quad,
                      let crop = cropper.makeNormalizedCrop(from: original, observation: quad)
                else { continue }
                totals[variant.name]?.record(
                    try await rank(crop, expected: sample.expected),
                    expected: sample.expected
                )
                available[variant.name, default: 0] += 1
                iouSum[variant.name, default: 0] += Double(
                    CardCropper.intersectionOverUnion(quad.boundingBox, recorded.boundingBox)
                )
            }
            print("CORNERSOURCE progress \(sample.record.imageFile)#\(sample.offset)")
        }

        for name in ["recordedDevice", "detectorBox"] + variants.map(\.name) {
            guard let value = totals[name] else { continue }
            printSummary("cornerSource/\(name)", value)
            let count = available[name] ?? 0
            let meanIoU = count > 0 ? (iouSum[name] ?? 0) / Double(count) : 0
            print("CORNERSOURCE RUNTIME \(name) available=\(count)/\(samples.count) "
                + String(format: "meanIoUvsDevice=%.3f cornerCPU=%.3fs", meanIoU, seconds[name] ?? 0)
                + " " + (counters[name]?.description ?? ""))
        }
    }

    /// Page-fit geometry on real binder frames across simulated guide sizes
    /// ("zooms"). For every selected frame it runs production localization
    /// (`BinderPageScanner.detectCardQuads`), then evaluates
    /// `pageFitRect(for:protecting:)` under several centered guide presets —
    /// from no guide at all to a tight guide with cards spilling past it —
    /// and writes the fitted image with remapped quad overlays for visual
    /// review. Asserts the invariants that matter: no detected corner is
    /// ever cropped out, and the fit never trims inside the guide.
    ///
    /// PAGEFIT_SESSION_DIR selects the session; PAGEFIT_FRAME_FILES
    /// (comma-separated) selects frames; PAGEFIT_OUT_DIR receives images.
    func testBinderPageFitVariants() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let path = environment["PAGEFIT_SESSION_DIR"] else {
            throw XCTSkip("Set PAGEFIT_SESSION_DIR to a binder dev-mode session.")
        }
        let root = URL(fileURLWithPath: path, isDirectory: true)
        let frames = (environment["PAGEFIT_FRAME_FILES"] ?? "frame-0009.jpg")
            .split(separator: ",").map(String.init)
        let outDir = environment["PAGEFIT_OUT_DIR"].map { URL(fileURLWithPath: $0, isDirectory: true) }
        if let outDir {
            try FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
        }

        func centeredGuide(_ fraction: CGFloat) -> CGRect {
            CGRect(
                x: (1 - fraction) / 2, y: (1 - fraction) / 2,
                width: fraction, height: fraction
            )
        }
        let presets: [(name: String, guide: CGRect?)] = [
            ("noGuide", nil),
            ("guide94", centeredGuide(0.94)),
            ("guide85", centeredGuide(0.85)),
            ("guide70", centeredGuide(0.70)),
            ("guide50", centeredGuide(0.50)),
        ]

        let scanner = BinderPageScanner(coordinator: .makeDefault())
        for frame in frames {
            let image = try loadImage(root.appendingPathComponent(frame))
            let observations = try await scanner.detectCardQuads(in: image)
            let quads = observations.map(BinderNormalizedQuad.init(observation:))
            print("PAGEFIT \(frame): \(quads.count) detected quads")
            XCTAssertFalse(quads.isEmpty, "no detections on \(frame)")

            for preset in presets {
                let fit = BinderPageScanner.pageFitRect(for: quads, protecting: preset.guide)
                let retained = fit.map { $0.width * $0.height } ?? 1
                if let fit {
                    // Invariant: every detected corner stays inside the fit
                    // (the fit's margin makes this strict containment).
                    let outside = quads.flatMap { [$0.topLeft, $0.topRight, $0.bottomLeft, $0.bottomRight] }
                        .filter { !fit.insetBy(dx: -0.0001, dy: -0.0001).contains($0) }
                    XCTAssertTrue(outside.isEmpty, "\(frame)/\(preset.name): corners cropped out \(outside)")
                    // Invariant: the guide area is never trimmed.
                    if let guide = preset.guide {
                        XCTAssertTrue(
                            fit.insetBy(dx: -0.0001, dy: -0.0001).contains(guide),
                            "\(frame)/\(preset.name): fit \(fit) cuts inside guide \(guide)"
                        )
                    }
                }
                print(String(
                    format: "PAGEFIT %@ %@: fit=%@ retainedArea=%.2f",
                    frame, preset.name,
                    fit.map { String(format: "(%.2f,%.2f %.2fx%.2f)", $0.minX, $0.minY, $0.width, $0.height) } ?? "none",
                    retained
                ))

                guard let outDir else { continue }
                let fitted = fit.flatMap { BinderPageScanner.crop(image, toNormalizedRect: $0) } ?? image
                let mapped = fit.map { rect in quads.map { $0.remapped(into: rect) } } ?? quads
                let name = "\(frame.replacingOccurrences(of: ".jpg", with: ""))-\(preset.name).png"
                savePNG(
                    drawQuads(mapped, on: fitted),
                    to: outDir.appendingPathComponent(name)
                )
            }
        }
    }

    private func drawQuads(_ quads: [BinderNormalizedQuad], on image: CGImage) -> CGImage {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        guard let context = CGContext(
            data: nil, width: image.width, height: image.height,
            bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return image }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        context.setLineWidth(max(3, width / 400))
        context.setStrokeColor(CGColor(red: 0, green: 1, blue: 0.2, alpha: 0.95))
        for quad in quads {
            let points = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft]
                .map { CGPoint(x: $0.x * width, y: $0.y * height) }
            context.beginPath()
            context.addLines(between: points + [points[0]])
            context.strokePath()
        }
        return context.makeImage() ?? image
    }

    /// One-off detector/Vision dump for a single image outside the bundled
    /// fixtures (SINGLE_IMAGE_DIAGNOSTIC_PATH). Prints every detector box so
    /// multi-card policy guards can be designed from measured geometry.
    func testSingleImageDetectorDiagnostic() throws {
        guard let path = ProcessInfo.processInfo.environment["SINGLE_IMAGE_DIAGNOSTIC_PATH"] else {
            throw XCTSkip("Set SINGLE_IMAGE_DIAGNOSTIC_PATH to an image file.")
        }
        let image = try loadImage(URL(fileURLWithPath: path))
        let detector = try XCTUnwrap(CardObjectDetector.shared)
        let detections = try detector.detections(in: image)
        print("SINGLEIMAGE \(image.width)x\(image.height) detections=\(detections.count)")
        for (offset, detection) in detections.enumerated() {
            let box = detection.boundingBox.standardized
            print(String(
                format: "SINGLEIMAGE box[%d] conf=%.3f x=%.3f y=%.3f w=%.3f h=%.3f area=%.3f",
                offset, detection.confidence,
                box.minX, box.minY, box.width, box.height, box.width * box.height
            ))
        }
        for lhs in detections.indices {
            for rhs in detections.indices where rhs > lhs {
                let a = detections[lhs].boundingBox.standardized
                let b = detections[rhs].boundingBox.standardized
                let inter = a.intersection(b)
                let interArea = inter.isNull ? 0 : inter.width * inter.height
                let smaller = min(a.width * a.height, b.width * b.height)
                print(String(
                    format: "SINGLEIMAGE overlap[%d,%d] iou=%.3f overSmaller=%.3f",
                    lhs, rhs,
                    CardCropper.intersectionOverUnion(a, b),
                    smaller > 0 ? interArea / smaller : 0
                ))
            }
        }
    }

    private enum CornerSource {
        case documentSegmentation
        case rectangles
        case both
    }

    /// `CardCropper.isCardShaped` measures edge lengths on Vision-normalized
    /// points. Normalized units are anisotropic on any non-square image, so the
    /// same quad reports a different ratio depending on the frame it came from.
    /// `.pixel` rescales by the image size first, which is what the [0.58, 0.9]
    /// band was written for.
    private enum ShapeCheck {
        case normalized
        case pixel
    }

    private struct CornerVariant {
        let name: String
        let source: CornerSource
        let shape: ShapeCheck
    }

    /// Mirrors `CardCropper.refinedObservations` (private) with the corner
    /// source made selectable, so the learned head and the classical detector
    /// can be scored apart. Padding, guards, and area limits are copied
    /// deliberately: any drift here would make the comparison meaningless.
    /// Counts why sub-image corner proposals disappear, so an empty result is
    /// reported as measured evidence rather than an unexplained zero.
    private struct CornerCounters {
        var raw = 0
        var confidenceRejected = 0
        var shapeRejected = 0
        var tooSmallRejected = 0
        var tooLargeRejected = 0
        var kept = 0

        var description: String {
            "raw=\(raw) confReject=\(confidenceRejected) shapeReject=\(shapeRejected) "
                + "areaTooSmall=\(tooSmallRejected) areaTooLarge=\(tooLargeRejected) kept=\(kept)"
        }
    }

    private func cornerObservation(
        in image: CGImage,
        around normalizedBox: CGRect,
        source: CornerSource,
        shape: ShapeCheck,
        counters: inout CornerCounters
    ) -> VNRectangleObservation? {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        let box = normalizedBox.standardized
        let padded = box.insetBy(dx: -box.width * 0.12, dy: -box.height * 0.12)
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        let pixelRect = CGRect(
            x: padded.minX * width,
            y: (1 - padded.maxY) * height,
            width: padded.width * width,
            height: padded.height * height
        ).integral
        guard pixelRect.width >= 64, pixelRect.height >= 64,
              let subImage = image.cropping(to: pixelRect)
        else { return nil }

        let handler = VNImageRequestHandler(cgImage: subImage, orientation: .up, options: [:])
        let documentRequest = VNDetectDocumentSegmentationRequest()
        let rectangleRequest = VNDetectRectanglesRequest()
        rectangleRequest.maximumObservations = CardCropper.Configuration.maximumObservations
        rectangleRequest.minimumConfidence = CardCropper.Configuration.minimumConfidence
        rectangleRequest.minimumAspectRatio = CardCropper.Configuration.minimumAspectRatio
        rectangleRequest.maximumAspectRatio = CardCropper.Configuration.maximumAspectRatio
        rectangleRequest.minimumSize = 0.3
        switch source {
        case .documentSegmentation: try? handler.perform([documentRequest])
        case .rectangles: try? handler.perform([rectangleRequest])
        case .both: try? handler.perform([documentRequest, rectangleRequest])
        }

        var candidates: [VNRectangleObservation] = []
        if source != .rectangles {
            let all = documentRequest.results ?? []
            counters.raw += all.count
            candidates += all.filter { $0.confidence >= CardCropper.Configuration.minimumConfidence }
            counters.confidenceRejected += all.count - candidates.count
        }
        if source != .documentSegmentation {
            let all = rectangleRequest.results ?? []
            counters.raw += all.count
            candidates += all
        }
        let boxArea = box.width * box.height
        let mapped = candidates.compactMap { observation -> VNRectangleObservation? in
            func map(_ point: CGPoint) -> CGPoint {
                CardCropper.mapSubImagePoint(
                    point,
                    pixelRect: pixelRect,
                    imageWidth: width,
                    imageHeight: height
                )
            }
            let topLeft = map(observation.topLeft)
            let topRight = map(observation.topRight)
            let bottomRight = map(observation.bottomRight)
            let bottomLeft = map(observation.bottomLeft)
            let cardShaped: Bool
            switch shape {
            case .normalized:
                cardShaped = CardCropper.isCardShaped(
                    topLeft: topLeft,
                    topRight: topRight,
                    bottomLeft: bottomLeft,
                    bottomRight: bottomRight
                )
            case .pixel:
                let scale = { (point: CGPoint) in
                    CGPoint(x: point.x * width, y: point.y * height)
                }
                cardShaped = CardCropper.isCardShaped(
                    topLeft: scale(topLeft),
                    topRight: scale(topRight),
                    bottomLeft: scale(bottomLeft),
                    bottomRight: scale(bottomRight)
                )
            }
            guard cardShaped else {
                counters.shapeRejected += 1
                return nil
            }
            let area = CardCropper.quadrilateralArea(
                topLeft: topLeft,
                topRight: topRight,
                bottomRight: bottomRight,
                bottomLeft: bottomLeft
            )
            guard area >= boxArea * 0.5 else {
                counters.tooSmallRejected += 1
                return nil
            }
            guard area <= boxArea * 1.15 else {
                counters.tooLargeRejected += 1
                return nil
            }
            return VNRectangleObservation(
                requestRevision: VNDetectRectanglesRequestRevision1,
                topLeft: topLeft,
                bottomLeft: bottomLeft,
                bottomRight: bottomRight,
                topRight: topRight
            )
        }
        counters.kept += mapped.count
        return mapped.isEmpty ? nil : CardCropper.preferredObservation(from: mapped)
    }

    /// Variance of a 4-neighbor Laplacian on a 256-wide grayscale rendering;
    /// the standard cheap sharpness proxy (RiftBound-style blur gate).
    private func laplacianVariance(of image: CGImage) -> Double {
        let targetWidth = min(256, image.width)
        let targetHeight = max(
            3,
            Int((Double(image.height) * Double(targetWidth) / Double(image.width)).rounded())
        )
        guard targetWidth > 2,
              let pixels = grayscalePixels(image: image, width: targetWidth, height: targetHeight)
        else { return 0 }
        var sum = 0.0
        var sumSquares = 0.0
        var count = 0.0
        for y in 1..<(targetHeight - 1) {
            for x in 1..<(targetWidth - 1) {
                let i = y * targetWidth + x
                let value = 4 * Double(pixels[i]) - Double(pixels[i - 1]) - Double(pixels[i + 1])
                    - Double(pixels[i - targetWidth]) - Double(pixels[i + targetWidth])
                sum += value
                sumSquares += value * value
                count += 1
            }
        }
        let mean = sum / count
        return sumSquares / count - mean * mean
    }

    private func savePNG(_ image: CGImage, to url: URL) {
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            "public.png" as CFString,
            1,
            nil
        ) else { return }
        CGImageDestinationAddImage(destination, image, nil)
        CGImageDestinationFinalize(destination)
    }

    private func loadImage(_ url: URL) throws -> CGImage {
        let source = try XCTUnwrap(CGImageSourceCreateWithURL(url as CFURL, nil))
        return try XCTUnwrap(CGImageSourceCreateImageAtIndex(source, 0, nil))
    }

    private struct HoughLine {
        let theta: Double
        let rho: Double
        let votes: Int32
        let position: Double
    }

    /// Test-only implementation of the transferable Rarebox/OSS Document
    /// Scanner idea: try several Sobel thresholds, then compare the strongest
    /// border line in each zone with the outermost sufficiently strong line.
    /// It deliberately runs only inside an existing detector box; it is not a
    /// replacement card detector and cannot introduce a new scene candidate.
    private func outerBorderObservations(
        in image: CGImage,
        around normalizedBox: CGRect
    ) -> [VNRectangleObservation] {
        let imageWidth = CGFloat(image.width)
        let imageHeight = CGFloat(image.height)
        let padded = normalizedBox.standardized
            .insetBy(dx: -normalizedBox.width * 0.08, dy: -normalizedBox.height * 0.08)
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        let pixelRect = CGRect(
            x: padded.minX * imageWidth,
            y: (1 - padded.maxY) * imageHeight,
            width: padded.width * imageWidth,
            height: padded.height * imageHeight
        ).integral
        guard pixelRect.width >= 64, pixelRect.height >= 64,
              let subImage = image.cropping(to: pixelRect)
        else { return [] }

        let targetWidth = min(360, subImage.width)
        let targetHeight = max(
            1,
            Int((Double(subImage.height) * Double(targetWidth) / Double(subImage.width)).rounded())
        )
        guard let grayscale = grayscalePixels(
            image: subImage,
            width: targetWidth,
            height: targetHeight
        ) else { return [] }

        var observations: [VNRectangleObservation] = []
        for multiplier in [2.2, 1.5, 1.0] {
            let edgePoints = sobelEdgePoints(
                grayscale,
                width: targetWidth,
                height: targetHeight,
                thresholdMultiplier: multiplier
            )
            guard edgePoints.count >= 400,
                  edgePoints.count <= targetWidth * targetHeight
            else { continue }
            for lines in houghBorderHypotheses(
                edgePoints: edgePoints,
                width: targetWidth,
                height: targetHeight
            ) {
                guard let topLeft = intersection(lines.top, lines.left),
                      let topRight = intersection(lines.top, lines.right),
                      let bottomRight = intersection(lines.bottom, lines.right),
                      let bottomLeft = intersection(lines.bottom, lines.left)
                else { continue }

                let scaleX = pixelRect.width / CGFloat(targetWidth)
                let scaleY = pixelRect.height / CGFloat(targetHeight)
                func normalized(_ point: CGPoint) -> CGPoint {
                    let fullX = pixelRect.minX + point.x * scaleX
                    let fullY = pixelRect.minY + point.y * scaleY
                    return CGPoint(x: fullX / imageWidth, y: 1 - fullY / imageHeight)
                }
                let tl = normalized(topLeft)
                let tr = normalized(topRight)
                let br = normalized(bottomRight)
                let bl = normalized(bottomLeft)
                guard CardCropper.isCardShaped(
                    topLeft: tl,
                    topRight: tr,
                    bottomLeft: bl,
                    bottomRight: br
                ) else { continue }
                let area = CardCropper.quadrilateralArea(
                    topLeft: tl,
                    topRight: tr,
                    bottomRight: br,
                    bottomLeft: bl
                )
                let boxArea = normalizedBox.width * normalizedBox.height
                guard area >= boxArea * 0.35, area <= boxArea * 1.25 else { continue }

                let candidate = VNRectangleObservation(
                    requestRevision: VNDetectRectanglesRequestRevision1,
                    topLeft: tl,
                    bottomLeft: bl,
                    bottomRight: br,
                    topRight: tr
                )
                let isDuplicate = observations.contains { existing in
                    hypot(existing.topLeft.x - tl.x, existing.topLeft.y - tl.y) < 0.015
                        && hypot(existing.bottomRight.x - br.x, existing.bottomRight.y - br.y) < 0.015
                }
                if !isDuplicate { observations.append(candidate) }
                if observations.count >= 6 { return observations }
            }
        }
        return observations
    }

    private func grayscalePixels(
        image: CGImage,
        width: Int,
        height: Int
    ) -> [UInt8]? {
        var pixels = [UInt8](repeating: 0, count: width * height)
        let rendered = pixels.withUnsafeMutableBytes { bytes -> Bool in
            guard let context = CGContext(
                data: bytes.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width,
                space: CGColorSpaceCreateDeviceGray(),
                bitmapInfo: CGImageAlphaInfo.none.rawValue
            ) else { return false }
            context.interpolationQuality = .medium
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        return rendered ? pixels : nil
    }

    private func sobelEdgePoints(
        _ pixels: [UInt8],
        width: Int,
        height: Int,
        thresholdMultiplier: Double
    ) -> [Int] {
        guard width > 2, height > 2 else { return [] }
        var magnitudes = [Double](repeating: 0, count: width * height)
        var sum = 0.0
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let i = y * width + x
                let gx = -Double(pixels[i - width - 1]) - 2 * Double(pixels[i - 1])
                    - Double(pixels[i + width - 1]) + Double(pixels[i - width + 1])
                    + 2 * Double(pixels[i + 1]) + Double(pixels[i + width + 1])
                let gy = -Double(pixels[i - width - 1]) - 2 * Double(pixels[i - width])
                    - Double(pixels[i - width + 1]) + Double(pixels[i + width - 1])
                    + 2 * Double(pixels[i + width]) + Double(pixels[i + width + 1])
                let magnitude = hypot(gx, gy)
                magnitudes[i] = magnitude
                sum += magnitude
            }
        }
        let mean = sum / Double((width - 2) * (height - 2))
        let threshold = max(24, mean * thresholdMultiplier)
        var points: [Int] = []
        points.reserveCapacity(width * height / 10)
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) where magnitudes[y * width + x] > threshold {
                points.append(x)
                points.append(y)
            }
        }
        return points
    }

    private func houghBorderHypotheses(
        edgePoints: [Int],
        width: Int,
        height: Int
    ) -> [(left: HoughLine, right: HoughLine, top: HoughLine, bottom: HoughLine)] {
        let degrees = Array(stride(from: -35, through: 35, by: 2))
            + Array(stride(from: 55, through: 125, by: 2))
        let thetas = degrees.map { Double($0) * .pi / 180 }
        let cosines = thetas.map { Foundation.cos($0) }
        let sines = thetas.map { Foundation.sin($0) }
        let diagonal = Int(ceil(hypot(Double(width), Double(height))))
        let rhoCount = 2 * diagonal + 1
        var accumulator = [Int32](repeating: 0, count: thetas.count * rhoCount)
        for pointOffset in stride(from: 0, to: edgePoints.count, by: 2) {
            let x = Double(edgePoints[pointOffset])
            let y = Double(edgePoints[pointOffset + 1])
            for thetaIndex in thetas.indices {
                let rho = Int((x * cosines[thetaIndex] + y * sines[thetaIndex]).rounded())
                    + diagonal
                if rho >= 0, rho < rhoCount {
                    accumulator[thetaIndex * rhoCount + rho] += 1
                }
            }
        }

        var zones: [String: [HoughLine]] = [
            "left": [], "right": [], "top": [], "bottom": []
        ]
        let middleX = Double(width) / 2
        let middleY = Double(height) / 2
        let minimumVotes = Int32(max(12, min(width, height) / 12))
        for thetaIndex in thetas.indices {
            let isVerticalBorder = degrees[thetaIndex] >= -35 && degrees[thetaIndex] <= 35
            for rhoIndex in 0..<rhoCount {
                let votes = accumulator[thetaIndex * rhoCount + rhoIndex]
                guard votes >= minimumVotes else { continue }
                let rho = Double(rhoIndex - diagonal)
                if isVerticalBorder {
                    guard abs(cosines[thetaIndex]) > 0.01 else { continue }
                    let position = (rho - middleY * sines[thetaIndex]) / cosines[thetaIndex]
                    let line = HoughLine(
                        theta: thetas[thetaIndex], rho: rho, votes: votes, position: position
                    )
                    if position >= -10, position < Double(width) * 0.47 {
                        zones["left", default: []].append(line)
                    } else if position > Double(width) * 0.53, position <= Double(width) + 10 {
                        zones["right", default: []].append(line)
                    }
                } else {
                    guard abs(sines[thetaIndex]) > 0.01 else { continue }
                    let position = (rho - middleX * cosines[thetaIndex]) / sines[thetaIndex]
                    let line = HoughLine(
                        theta: thetas[thetaIndex], rho: rho, votes: votes, position: position
                    )
                    if position >= -10, position < Double(height) * 0.47 {
                        zones["top", default: []].append(line)
                    } else if position > Double(height) * 0.53, position <= Double(height) + 10 {
                        zones["bottom", default: []].append(line)
                    }
                }
            }
        }

        func selected(_ name: String, outermost: Bool) -> HoughLine? {
            guard let lines = zones[name], !lines.isEmpty else { return nil }
            if !outermost { return lines.max { $0.votes < $1.votes } }
            let strongest = lines.map(\.votes).max() ?? 0
            let strong = lines.filter { Double($0.votes) >= Double(strongest) * 0.55 }
            if name == "left" || name == "top" {
                return strong.min { $0.position < $1.position }
            }
            return strong.max { $0.position < $1.position }
        }

        var results: [(
            left: HoughLine,
            right: HoughLine,
            top: HoughLine,
            bottom: HoughLine
        )] = []
        for outermost in [false, true] {
            if let left = selected("left", outermost: outermost),
               let right = selected("right", outermost: outermost),
               let top = selected("top", outermost: outermost),
               let bottom = selected("bottom", outermost: outermost) {
                results.append((left, right, top, bottom))
            }
        }
        return results
    }

    private func intersection(_ first: HoughLine, _ second: HoughLine) -> CGPoint? {
        let a1 = cos(first.theta)
        let b1 = sin(first.theta)
        let a2 = cos(second.theta)
        let b2 = sin(second.theta)
        let determinant = a1 * b2 - a2 * b1
        guard abs(determinant) > 1e-9 else { return nil }
        return CGPoint(
            x: CGFloat((first.rho * b2 - second.rho * b1) / determinant),
            y: CGFloat((a1 * second.rho - a2 * first.rho) / determinant)
        )
    }

    private func observation(from quad: [[Double]]) throws -> VNRectangleObservation {
        XCTAssertEqual(quad.count, 4)
        let points = try quad.map { pair -> CGPoint in
            XCTAssertEqual(pair.count, 2)
            return CGPoint(x: try XCTUnwrap(pair.first), y: try XCTUnwrap(pair.last))
        }
        return VNRectangleObservation(
            requestRevision: VNDetectRectanglesRequestRevision1,
            topLeft: points[0],
            bottomLeft: points[3],
            bottomRight: points[2],
            topRight: points[1]
        )
    }

    /// Orders the shorter opposite edges as the card's top and bottom, then
    /// chooses the screen-higher short edge as top. For an upright card rotated
    /// within +/-90 degrees this preserves semantic up while removing arbitrary
    /// in-plane rotation. It deliberately cannot solve a true 180-degree input.
    private func screenUprightObservation(
        from observation: VNRectangleObservation,
        imageSize: CGSize
    ) -> VNRectangleObservation {
        let points = [
            observation.topLeft,
            observation.topRight,
            observation.bottomRight,
            observation.bottomLeft,
        ]
        func length(_ edge: (CGPoint, CGPoint)) -> CGFloat {
            hypot(
                (edge.1.x - edge.0.x) * imageSize.width,
                (edge.1.y - edge.0.y) * imageSize.height
            )
        }
        let edges = points.indices.map { index in
            (points[index], points[(index + 1) % points.count])
        }
        let shortPair = length(edges[0]) + length(edges[2])
            <= length(edges[1]) + length(edges[3]) ? [edges[0], edges[2]] : [edges[1], edges[3]]
        let topEdge = shortPair.max { lhs, rhs in
            (lhs.0.y + lhs.1.y) < (rhs.0.y + rhs.1.y)
        } ?? shortPair[0]
        let bottomEdge = shortPair.first {
            !($0.0 == topEdge.0 && $0.1 == topEdge.1)
        } ?? shortPair[1]
        let top = [topEdge.0, topEdge.1].sorted { $0.x < $1.x }
        let bottom = [bottomEdge.0, bottomEdge.1].sorted { $0.x < $1.x }
        return VNRectangleObservation(
            requestRevision: VNDetectRectanglesRequestRevision1,
            topLeft: top[0],
            bottomLeft: bottom[0],
            bottomRight: bottom[1],
            topRight: top[1]
        )
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

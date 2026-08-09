import CoreGraphics
import Foundation
import ImageIO
import Vision
import XCTest
@testable import TCGer

/// Host-driven diagnostic for Roboflow COCO archives. The dataset stays outside
/// the app bundle; set ROBOFLOW_REPLAY_DIR to the directory produced by
/// scripts/prepare_roboflow_ios_replay.py.
@MainActor
final class RoboflowArchiveDiagnosticTests: XCTestCase {
    func testRoboflowArchivesThroughIOSScanner() async throws {
        let environment = ProcessInfo.processInfo.environment
        let documents = try XCTUnwrap(
            FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        )
        let simulatorReplay = documents.appendingPathComponent("TCGer-Roboflow-Replay", isDirectory: true)
        let diagnosticMarker = simulatorReplay.appendingPathComponent("recognition-diagnostic")
        let isMarkedSimulatorDiagnostic = FileManager.default.fileExists(atPath: diagnosticMarker.path)
        guard let replayDirectory = environment["ROBOFLOW_REPLAY_DIR"] ??
            (isMarkedSimulatorDiagnostic ? "__documents__" : nil)
        else {
            throw XCTSkip("Set ROBOFLOW_REPLAY_DIR to run the Roboflow scanner diagnostic.")
        }
        let root = replayDirectory == "__documents__"
            ? simulatorReplay
            : URL(fileURLWithPath: replayDirectory, isDirectory: true)
        let manifestURL = root.appendingPathComponent("roboflow-ios-replay.json")
        let manifest = try JSONDecoder().decode(
            RoboflowReplayManifest.self,
            from: Data(contentsOf: manifestURL)
        )
        let detectionLimit = Int(environment["ROBOFLOW_DETECTION_PER_DATASET"] ??
            (isMarkedSimulatorDiagnostic ? "10" : ""))
        let recognitionPerDataset = Int(environment["ROBOFLOW_RECOGNITION_PER_DATASET"] ?? "10") ?? 10
        let recognizeAll = environment["ROBOFLOW_RECOGNITION_ALL"] == "1" || isMarkedSimulatorDiagnostic
        let selectedRecords = selectRecords(manifest.records, perDataset: detectionLimit)
        let recognitionPaths = recognizeAll
            ? Set(selectedRecords.map(\.imagePath))
            : Set(selectRecords(selectedRecords, perDataset: recognitionPerDataset).map(\.imagePath))

        let cropper = CardCropper()
        let encoder = CardEmbeddingEncoder()
        let indexStore = AnnoyIndexStore()
        let metadataStore = CardIndexMetadataStore.shared
        let rejectionGate = CardFaceRejectionGate.loadBundled()
        let collectorOCR = CollectorNumberOCR()
        let coordinator = CardScannerCoordinator.makeDefault()
        let context = CardScannerContext.test(mode: .pokemon, engine: .localOnly)
        var measurements: [RoboflowImageMeasurement] = []
        measurements.reserveCapacity(selectedRecords.count)

        for (offset, record) in selectedRecords.enumerated() {
            let imageURL = root.appendingPathComponent(record.imagePath)
            guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else {
                measurements.append(.unreadable(record: record))
                continue
            }

            let detectionStarted = ContinuousClock.now
            let observations = (try? cropper.detectRectangles(in: image)) ?? []
            let detectionMs = milliseconds(since: detectionStarted)
            let bestObservation = CardCropper.preferredObservation(from: observations)
            let cropSucceeded = bestObservation.flatMap {
                cropper.makeNormalizedCrop(from: image, observation: $0)
            } != nil
            let bestIoU = bestObservation.map {
                maximumIoU(
                    predicted: cocoBoundingBox(for: $0, image: image),
                    annotations: record.annotations
                )
            }

            var recognition: RoboflowRecognitionMeasurement?
            if recognitionPaths.contains(record.imagePath) {
                let diagnostic = try? await recognitionDiagnostic(
                    image: image,
                    cropper: cropper,
                    encoder: encoder,
                    indexStore: indexStore,
                    metadataStore: metadataStore,
                    rejectionGate: rejectionGate,
                    collectorOCR: collectorOCR
                )
                let recognitionStarted = ContinuousClock.now
                let result = await coordinator.scan(
                    image: image,
                    context: context,
                    source: .photoCapture
                )
                let recognitionMs = milliseconds(since: recognitionStarted)
                switch result {
                case .success(let scan):
                    recognition = RoboflowRecognitionMeasurement(
                        matched: true,
                        cardID: scan.primary.details.identity.id,
                        name: scan.primary.details.identity.name,
                        confidence: scan.primary.confidence.score,
                        strategy: scan.primary.originatingStrategy.displayName,
                        elapsedMs: recognitionMs,
                        failure: nil,
                        diagnostic: diagnostic
                    )
                case .failure(let failure):
                    recognition = RoboflowRecognitionMeasurement(
                        matched: false,
                        cardID: nil,
                        name: nil,
                        confidence: nil,
                        strategy: nil,
                        elapsedMs: recognitionMs,
                        failure: String(describing: failure),
                        diagnostic: diagnostic
                    )
                }
            }

            measurements.append(RoboflowImageMeasurement(
                dataset: record.dataset,
                split: record.split,
                imagePath: record.imagePath,
                annotationCount: record.annotations.count,
                readable: true,
                detected: bestObservation != nil,
                cropSucceeded: cropSucceeded,
                detectionConfidence: bestObservation.map { Double($0.confidence) },
                bestIoU: bestIoU,
                detectionMs: detectionMs,
                recognition: recognition
            ))

            if (offset + 1).isMultiple(of: 100) {
                print("ROBOFLOW progress \(offset + 1)/\(selectedRecords.count)")
            }
        }

        let report = RoboflowIOSReport(
            generatedAt: ISO8601DateFormatter().string(from: Date()),
            detectorBundled: CardObjectDetector.shared != nil,
            manifestImages: manifest.totals.images,
            processedImages: measurements.count,
            detectionLimitPerDataset: detectionLimit,
            recognitionPerDataset: recognizeAll ? nil : recognitionPerDataset,
            datasets: aggregate(measurements),
            recognitionSamples: measurements.compactMap { measurement in
                measurement.recognition.map { result in
                    let expected = RoboflowRecognitionGroundTruth.expected(
                        for: measurement.imagePath
                    )
                    return RoboflowRecognitionSample(
                        dataset: measurement.dataset,
                        imagePath: measurement.imagePath,
                        expectedCardID: expected?.cardID,
                        expectedName: expected?.name,
                        nameCorrect: expected.map { result.name == $0.name },
                        printingCorrect: expected.map { result.cardID == $0.cardID },
                        result: result
                    )
                }
            }
        )

        // Fill correctness from the actual result after encoding the sample
        // metadata above. Any accepted, labeled frame must be the exact
        // printing—not merely another card with the same name.
        let printingErrors = report.recognitionSamples.filter { sample in
            guard sample.result.matched, let expected = sample.expectedCardID else { return false }
            return sample.result.cardID != expected
        }
        let printingErrorDescription = printingErrors.map { sample in
            "\(sample.imagePath): \(sample.result.cardID ?? "nil") != \(sample.expectedCardID ?? "nil")"
        }.joined(separator: ", ")
        XCTAssertTrue(
            printingErrors.isEmpty,
            "Wrong printing accepted: \(printingErrorDescription)"
        )

        let reportData = try JSONEncoder.prettyPrinted.encode(report)
        let reportURL: URL
        if let reportPath = environment["ROBOFLOW_REPORT_PATH"], reportPath != "__documents__" {
            reportURL = URL(fileURLWithPath: reportPath)
        } else {
            reportURL = documents.appendingPathComponent("tcger-roboflow-ios-report.json")
        }
        try reportData.write(to: reportURL, options: .atomic)
        print("ROBOFLOW report \(reportURL.path)")
        print(String(decoding: reportData, as: UTF8.self))

        XCTAssertGreaterThan(report.processedImages, 0)
        XCTAssertEqual(report.datasets.reduce(0) { $0 + $1.images }, report.processedImages)
    }

    private func selectRecords(
        _ records: [RoboflowReplayRecord],
        perDataset limit: Int?
    ) -> [RoboflowReplayRecord] {
        guard let limit, limit > 0 else { return records }
        return Dictionary(grouping: records, by: \.dataset)
            .keys.sorted()
            .flatMap { dataset in
                let candidates = Dictionary(grouping: records, by: \.dataset)[dataset] ?? []
                guard candidates.count > limit else { return candidates }
                guard limit > 1 else { return [candidates[candidates.count / 2]] }
                return (0..<limit).map { index in
                    let position = Int(
                        (Double(index) * Double(candidates.count - 1) / Double(limit - 1)).rounded()
                    )
                    return candidates[position]
                }
            }
    }

    private func milliseconds(since start: ContinuousClock.Instant) -> Double {
        let elapsed = start.duration(to: .now)
        return Double(elapsed.components.seconds) * 1_000
            + Double(elapsed.components.attoseconds) / 1_000_000_000_000_000
    }

    private func recognitionDiagnostic(
        image: CGImage,
        cropper: CardCropper,
        encoder: CardEmbeddingEncoder,
        indexStore: AnnoyIndexStore,
        metadataStore: CardIndexMetadataStore,
        rejectionGate: CardFaceRejectionGate?,
        collectorOCR: CollectorNumberOCR
    ) async throws -> RoboflowRecognitionDiagnostic {
        let crop = try cropper.bestCrop(from: image) ?? image
        let embedding = try await encoder.embedding(for: crop)
        let gateScore = rejectionGate?.cardFaceScore(for: embedding)
        let allowed = await metadataStore.indices(for: .pokemon)
        let matches = try await indexStore.nearestNeighbors(
            for: embedding,
            limit: 10,
            allowedIndices: allowed
        )
        var candidates: [RoboflowRecognitionCandidate] = []
        for match in matches {
            guard let details = await metadataStore.details(for: match.index) else { continue }
            candidates.append(RoboflowRecognitionCandidate(
                cardID: details.identity.id,
                name: details.identity.name,
                setCode: details.identity.setCode,
                similarity: 1 - match.distance
            ))
        }
        let footer = collectorOCR.readFooter(from: crop)
        return RoboflowRecognitionDiagnostic(
            gateScore: gateScore,
            gateThreshold: rejectionGate?.threshold,
            footerPairNumbers: footer.pairNumbers,
            footerDigitRuns: footer.digitRuns,
            recognizedText: recognizedText(in: crop),
            candidates: candidates
        )
    }

    private func recognizedText(in image: CGImage) -> [String] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = false
        request.minimumTextHeight = 0.012
        try? VNImageRequestHandler(cgImage: image, orientation: .up).perform([request])
        return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    }

    private func cocoBoundingBox(
        for observation: VNRectangleObservation,
        image: CGImage
    ) -> CGRect {
        let bounds = observation.boundingBox.standardized
        return CGRect(
            x: bounds.minX * CGFloat(image.width),
            y: (1 - bounds.maxY) * CGFloat(image.height),
            width: bounds.width * CGFloat(image.width),
            height: bounds.height * CGFloat(image.height)
        )
    }

    private func maximumIoU(predicted: CGRect, annotations: [RoboflowReplayAnnotation]) -> Double {
        annotations.map { annotation in
            intersectionOverUnion(predicted, annotation.rect)
        }.max() ?? 0
    }

    private func intersectionOverUnion(_ lhs: CGRect, _ rhs: CGRect) -> Double {
        let intersection = lhs.intersection(rhs)
        guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else { return 0 }
        let intersectionArea = intersection.width * intersection.height
        let unionArea = lhs.width * lhs.height + rhs.width * rhs.height - intersectionArea
        guard unionArea > 0 else { return 0 }
        return Double(intersectionArea / unionArea)
    }

    private func aggregate(_ measurements: [RoboflowImageMeasurement]) -> [RoboflowDatasetReport] {
        Dictionary(grouping: measurements, by: \.dataset)
            .keys.sorted()
            .map { dataset in
                let rows = Dictionary(grouping: measurements, by: \.dataset)[dataset] ?? []
                let readable = rows.filter(\.readable)
                let detected = readable.filter(\.detected)
                let ious = detected.compactMap(\.bestIoU)
                let recognition = readable.compactMap(\.recognition)
                return RoboflowDatasetReport(
                    dataset: dataset,
                    images: rows.count,
                    readableImages: readable.count,
                    annotatedImages: readable.filter { $0.annotationCount > 0 }.count,
                    detectedImages: detected.count,
                    cropSuccesses: readable.filter(\.cropSucceeded).count,
                    meanIoU: mean(ious),
                    iouAt50: ious.filter { $0 >= 0.5 }.count,
                    iouAt75: ious.filter { $0 >= 0.75 }.count,
                    meanDetectionMs: mean(readable.map(\.detectionMs)),
                    p95DetectionMs: percentile95(readable.map(\.detectionMs)),
                    recognitionImages: recognition.count,
                    recognitionMatches: recognition.filter(\.matched).count,
                    meanRecognitionMs: mean(recognition.map(\.elapsedMs)),
                    p95RecognitionMs: percentile95(recognition.map(\.elapsedMs))
                )
            }
    }

    private func mean(_ values: [Double]) -> Double {
        values.isEmpty ? 0 : values.reduce(0, +) / Double(values.count)
    }

    private func percentile95(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        guard !sorted.isEmpty else { return 0 }
        let index = min(sorted.count - 1, Int((Double(sorted.count) * 0.95).rounded(.up)) - 1)
        return sorted[index]
    }
}

private struct RoboflowReplayManifest: Decodable {
    struct Totals: Decodable { let images: Int; let annotations: Int }
    let records: [RoboflowReplayRecord]
    let totals: Totals
}

private struct RoboflowReplayRecord: Decodable {
    let dataset: String
    let split: String
    let imagePath: String
    let width: Int
    let height: Int
    let annotations: [RoboflowReplayAnnotation]
}

private struct RoboflowReplayAnnotation: Decodable {
    let category: String
    let bbox: [Double]
    let area: Double

    var rect: CGRect {
        guard bbox.count == 4 else { return .zero }
        return CGRect(x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3])
    }
}

private struct RoboflowRecognitionMeasurement: Codable {
    let matched: Bool
    let cardID: String?
    let name: String?
    let confidence: Double?
    let strategy: String?
    let elapsedMs: Double
    let failure: String?
    let diagnostic: RoboflowRecognitionDiagnostic?
}

private struct RoboflowRecognitionDiagnostic: Codable {
    let gateScore: Double?
    let gateThreshold: Double?
    let footerPairNumbers: [String]
    let footerDigitRuns: [String]
    let recognizedText: [String]
    let candidates: [RoboflowRecognitionCandidate]
}

private struct RoboflowRecognitionCandidate: Codable {
    let cardID: String
    let name: String
    let setCode: String?
    let similarity: Double
}

private struct RoboflowImageMeasurement {
    let dataset: String
    let split: String
    let imagePath: String
    let annotationCount: Int
    let readable: Bool
    let detected: Bool
    let cropSucceeded: Bool
    let detectionConfidence: Double?
    let bestIoU: Double?
    let detectionMs: Double
    let recognition: RoboflowRecognitionMeasurement?

    static func unreadable(record: RoboflowReplayRecord) -> Self {
        Self(
            dataset: record.dataset,
            split: record.split,
            imagePath: record.imagePath,
            annotationCount: record.annotations.count,
            readable: false,
            detected: false,
            cropSucceeded: false,
            detectionConfidence: nil,
            bestIoU: nil,
            detectionMs: 0,
            recognition: nil
        )
    }
}

private struct RoboflowDatasetReport: Codable {
    let dataset: String
    let images: Int
    let readableImages: Int
    let annotatedImages: Int
    let detectedImages: Int
    let cropSuccesses: Int
    let meanIoU: Double
    let iouAt50: Int
    let iouAt75: Int
    let meanDetectionMs: Double
    let p95DetectionMs: Double
    let recognitionImages: Int
    let recognitionMatches: Int
    let meanRecognitionMs: Double
    let p95RecognitionMs: Double
}

private struct RoboflowRecognitionSample: Codable {
    let dataset: String
    let imagePath: String
    let expectedCardID: String?
    let expectedName: String?
    let nameCorrect: Bool?
    let printingCorrect: Bool?
    let result: RoboflowRecognitionMeasurement
}

private enum RoboflowRecognitionGroundTruth {
    struct Expected {
        let cardID: String
        let name: String
    }

    static func expected(for imagePath: String) -> Expected? {
        let filename = (imagePath as NSString).lastPathComponent
        let stem = filename.components(separatedBy: ".rf.").first ?? filename
        switch stem {
        case "1526692_JPG", "Blastoise-Ex-200-4_jpg":
            return Expected(cardID: "sv03.5-200", name: "Blastoise ex")
        case "Charizard-Ex-223-2_jpg":
            return Expected(cardID: "sv03-223", name: "Charizard ex")
        case "Espeon-Deoxys-SM240-1_jpg":
            return Expected(cardID: "smp-SM240", name: "Espeon & Deoxys GX")
        case "Venusaur-ex-198-3_jpg":
            return Expected(cardID: "sv03.5-198", name: "Venusaur ex")
        case "zapdos-ex-202-151_jpg":
            return Expected(cardID: "sv03.5-202", name: "Zapdos ex")
        case "IMG_1127-Large_jpeg":
            return Expected(cardID: "swsh12.5-093", name: "Bisharp")
        case "IMG_1114-Large_jpeg":
            return Expected(cardID: "swsh12.5-079", name: "Krokorok")
        case "pro10__WIN_20250214_10_40_37_Pro":
            return Expected(cardID: "sv03-104", name: "Dugtrio")
        case "pro2__241_jpg":
            return Expected(cardID: "gym1-77", name: "Erika's Exeggcute")
        case "IMG_4734_jpg", "IMG_4758_jpg", "IMG_4793_jpg", "IMG_4826_jpg":
            return Expected(cardID: "me02-027", name: "Piplup")
        case "IMG_4901_jpg":
            return Expected(cardID: "sv01-170", name: "Electric Generator")
        case "Aerodactyl_-035-110-_35-110-_jpg":
            return Expected(cardID: "ex13-35", name: "Aerodactyl δ")
        case "Azumarill_-114-113-_jpg":
            return Expected(cardID: "ex11-114", name: "Azumarill")
        case "Dugtrio_-86-214-_086-214-_jpg":
            return Expected(cardID: "sm10-86", name: "Dugtrio")
        case "Gym_Badge_-XY208-_jpg":
            return Expected(cardID: "xyp-XY208", name: "Gym Badge")
        case "Luxio_-50-172-_050-172-_jpg":
            return Expected(cardID: "swsh9-050", name: "Luxio")
        case "Palpitoad_-035-124-_35-124-_jpg":
            return Expected(cardID: "bw6-35", name: "Palpitoad")
        case "Roaring_Moon_-109-162-_jpg":
            return Expected(cardID: "sv05-109", name: "Roaring Moon")
        case "Thundurus_-035-098-_35-98-_jpg":
            return Expected(cardID: "bw2-35", name: "Thundurus")
        case "Dark_Weezing_-14-82-_014-082-_jpg":
            return Expected(cardID: "base5-14", name: "Dark Weezing")
        default:
            return nil
        }
    }
}

private struct RoboflowIOSReport: Codable {
    let generatedAt: String
    let detectorBundled: Bool
    let manifestImages: Int
    let processedImages: Int
    let detectionLimitPerDataset: Int?
    let recognitionPerDataset: Int?
    let datasets: [RoboflowDatasetReport]
    let recognitionSamples: [RoboflowRecognitionSample]
}

private extension JSONEncoder {
    static var prettyPrinted: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}

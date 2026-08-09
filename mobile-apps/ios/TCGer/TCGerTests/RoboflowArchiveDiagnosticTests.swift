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
        guard let replayDirectory = environment["ROBOFLOW_REPLAY_DIR"] else {
            throw XCTSkip("Set ROBOFLOW_REPLAY_DIR to run the Roboflow scanner diagnostic.")
        }

        let documents = try XCTUnwrap(
            FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first
        )
        let root = replayDirectory == "__documents__"
            ? documents.appendingPathComponent("TCGer-Roboflow-Replay", isDirectory: true)
            : URL(fileURLWithPath: replayDirectory, isDirectory: true)
        let manifestURL = root.appendingPathComponent("roboflow-ios-replay.json")
        let manifest = try JSONDecoder().decode(
            RoboflowReplayManifest.self,
            from: Data(contentsOf: manifestURL)
        )
        let detectionLimit = Int(environment["ROBOFLOW_DETECTION_PER_DATASET"] ?? "")
        let recognitionPerDataset = Int(environment["ROBOFLOW_RECOGNITION_PER_DATASET"] ?? "10") ?? 10
        let recognizeAll = environment["ROBOFLOW_RECOGNITION_ALL"] == "1"
        let selectedRecords = selectRecords(manifest.records, perDataset: detectionLimit)
        let recognitionPaths = recognizeAll
            ? Set(selectedRecords.map(\.imagePath))
            : Set(selectRecords(selectedRecords, perDataset: recognitionPerDataset).map(\.imagePath))

        let cropper = CardCropper()
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
            let bestObservation = observations.max(by: { $0.confidence < $1.confidence })
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
                        failure: nil
                    )
                case .failure(let failure):
                    recognition = RoboflowRecognitionMeasurement(
                        matched: false,
                        cardID: nil,
                        name: nil,
                        confidence: nil,
                        strategy: nil,
                        elapsedMs: recognitionMs,
                        failure: String(describing: failure)
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
                measurement.recognition.map {
                    RoboflowRecognitionSample(
                        dataset: measurement.dataset,
                        imagePath: measurement.imagePath,
                        result: $0
                    )
                }
            }
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
    let result: RoboflowRecognitionMeasurement
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

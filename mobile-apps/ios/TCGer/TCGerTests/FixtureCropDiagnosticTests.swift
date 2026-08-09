import CoreImage
import UIKit
import XCTest
@preconcurrency import Vision
@testable import TCGer

/// Investigation harness for `ScannerFixtureTests` failures. Prints
/// per-fixture crop geometry, gate score, top ANN candidates, and the
/// whole-frame arbitration candidate so a failure can be attributed to
/// localization, the gate, or retrieval without guessing.
@MainActor
final class FixtureCropDiagnosticTests: XCTestCase {
    func testDumpFixtureDiagnostics() async throws {
        let assets = ["BossOrders", "Peonia", "Rayquaza", "PokeStop", "ProfessorsResearch"]
        let cropper = CardCropper()
        let detector = CardObjectDetector.shared
        let encoder = CardEmbeddingEncoder()
        let indexStore = AnnoyIndexStore()
        let metadataStore = CardIndexMetadataStore.shared
        let gate = CardFaceRejectionGate.loadBundled()
        let allowed = await metadataStore.indices(for: .pokemon)

        var inputs: [(name: String, image: CGImage)] = []
        for assetName in assets {
            guard let image = UIImage(named: assetName)?.cgImage else {
                print("FIXTURE \(assetName): MISSING ASSET")
                continue
            }
            inputs.append((assetName, image))
        }
        // Mirror of the two-cards fixture composite so its failure mode gets
        // the same per-signal dump as the single-card assets.
        if let boss = UIImage(named: "BossOrders"),
           let pikachu = UIImage(named: "Rayquaza"),
           let composite = Self.twoCardScene(boss, pikachu).cgImage {
            inputs.append(("TwoCardsComposite", composite))
        }

        for (assetName, image) in inputs {
            let detections = (try? detector?.detections(in: image)) ?? []
            let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
            let documentRequest = VNDetectDocumentSegmentationRequest()
            try? handler.perform([documentRequest])
            let documents = documentRequest.results ?? []
            let rectRequest = VNDetectRectanglesRequest()
            rectRequest.maximumObservations = 5
            rectRequest.minimumConfidence = 0.65
            rectRequest.minimumAspectRatio = 0.58
            rectRequest.maximumAspectRatio = 0.9
            rectRequest.minimumSize = 0.1
            try? handler.perform([rectRequest])
            let rectangles = rectRequest.results ?? []

            let crop = try cropper.bestCrop(from: image)
            let used = crop ?? image
            let embedding = try await encoder.embedding(for: used)
            let gateScore = gate?.cardFaceScore(for: embedding) ?? -1
            let matches = try await indexStore.nearestNeighbors(
                for: embedding,
                limit: 5,
                allowedIndices: allowed
            )
            var tops: [String] = []
            for match in matches {
                guard let details = await metadataStore.details(for: match.index) else { continue }
                tops.append(String(
                    format: "%@ %@ %.3f",
                    details.identity.id,
                    details.identity.name,
                    1 - match.distance
                ))
            }

            // The importedPhoto arbitration's other candidate: the whole frame
            // normalized like a crop. Print its gate score and retrieval so a
            // lost arbitration is visible in the dump.
            var wholeSummary = "unavailable"
            if let wholeFrame = cropper.normalizedWholeImage(from: image) {
                let wholeEmbedding = try await encoder.embedding(for: wholeFrame)
                let wholeGate = gate?.cardFaceScore(for: wholeEmbedding) ?? -1
                let wholeMatches = try await indexStore.nearestNeighbors(
                    for: wholeEmbedding,
                    limit: 3,
                    allowedIndices: allowed
                )
                var wholeTops: [String] = []
                for match in wholeMatches {
                    guard let details = await metadataStore.details(for: match.index) else { continue }
                    wholeTops.append(String(
                        format: "%@ %@ %.3f",
                        details.identity.id,
                        details.identity.name,
                        1 - match.distance
                    ))
                }
                wholeSummary = String(format: "gate %.3f top3 %@", wholeGate, "\(wholeTops)")
            }

            print("""
            FIXTURE \(assetName)
              source \(image.width)x\(image.height) aspect \
            \(String(format: "%.3f", Double(image.width) / Double(image.height)))
              detector boxes \(detections.count) \
            \(detections.map { String(format: "conf %.2f %@", $0.confidence, "\($0.boundingBox)") })
              document results \(documents.count) \
            \(documents.map { String(format: "conf %.2f area %.2f plausible %@", $0.confidence, $0.boundingBox.width * $0.boundingBox.height, CardCropper.isPlausibleDocumentDetection($0) ? "Y" : "N") })
              rectangles \(rectangles.count) \
            \(rectangles.map { String(format: "conf %.2f area %.2f", $0.confidence, $0.boundingBox.width * $0.boundingBox.height) })
              bestCrop \(crop.map { "\($0.width)x\($0.height)" } ?? "nil (using full image)")
              gate \(String(format: "%.3f", gateScore)) threshold \
            \(String(format: "%.2f", gate?.threshold ?? -1))
              top5 \(tops)
              wholeFrame \(wholeSummary)
            """)
        }
    }

    /// Same composition as ScannerFixtureTests.multipleCards.
    private static func twoCardScene(_ first: UIImage, _ second: UIImage) -> UIImage {
        let size = CGSize(width: first.size.width * 1.55, height: first.size.height)
        return UIGraphicsImageRenderer(size: size).image { _ in
            UIColor.darkGray.setFill()
            UIRectFill(CGRect(origin: .zero, size: size))
            first.draw(in: CGRect(x: 0, y: 0, width: first.size.width, height: first.size.height))
            second.draw(in: CGRect(
                x: first.size.width * 0.72,
                y: first.size.height * 0.08,
                width: first.size.width * 0.75,
                height: first.size.height * 0.75
            ))
        }
    }
}

import CoreImage
import UIKit
import XCTest
@preconcurrency import Vision
@testable import TCGer

/// Temporary investigation harness for the red `ScannerFixtureTests`
/// assertions. Prints per-fixture crop geometry, gate score, and top ANN
/// candidates so the failure can be attributed to localization, the gate, or
/// retrieval.
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

        for assetName in assets {
            guard let image = UIImage(named: assetName)?.cgImage else {
                print("FIXTURE \(assetName): MISSING ASSET")
                continue
            }
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
            """)
        }
    }
}

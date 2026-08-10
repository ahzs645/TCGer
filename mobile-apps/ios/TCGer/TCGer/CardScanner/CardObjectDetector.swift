import CoreGraphics
import CoreML
import Foundation
@preconcurrency import Vision

/// Single-class Core ML detector used to localize a trading card before the
/// generic Vision document/rectangle requests refine its four corners.
nonisolated final class CardObjectDetector: @unchecked Sendable {
    static let shared = CardObjectDetector.loadBundled()

    private static let minimumConfidence: VNConfidence = 0.50
    private let visionModel: VNCoreMLModel

    init(model: MLModel) throws {
        visionModel = try VNCoreMLModel(for: model)
    }

    static func loadBundled(
        resource: String = "CardDetector",
        bundle: Bundle = .main
    ) -> CardObjectDetector? {
        guard let url = bundle.url(forResource: resource, withExtension: "mlmodelc") else {
            return nil
        }
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .all
        guard let model = try? MLModel(contentsOf: url, configuration: configuration) else {
            return nil
        }
        return try? CardObjectDetector(model: model)
    }

    func detections(in image: CGImage) throws -> [VNRecognizedObjectObservation] {
        let request = VNCoreMLRequest(model: visionModel)
        request.imageCropAndScaleOption = .scaleFit
        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        try handler.perform([request])
        return (request.results as? [VNRecognizedObjectObservation] ?? [])
            .filter { observation in
                observation.labels.contains {
                    $0.identifier.caseInsensitiveCompare("card") == .orderedSame
                        && $0.confidence >= Self.minimumConfidence
                }
            }
            .sorted { lhs, rhs in
                (lhs.labels.first?.confidence ?? 0) > (rhs.labels.first?.confidence ?? 0)
            }
    }
}

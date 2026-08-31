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
        let cards = (request.results as? [VNRecognizedObjectObservation] ?? [])
            .filter { observation in
                observation.labels.contains {
                    $0.identifier.caseInsensitiveCompare("card") == .orderedSame
                        && $0.confidence >= Self.minimumConfidence
                }
            }
            .sorted { lhs, rhs in
                (lhs.labels.first?.confidence ?? 0) > (rhs.labels.first?.confidence ?? 0)
            }
        return cards
    }

    /// Share of a box's own area that must lie inside a larger detection for
    /// the box to count as nested in it.
    static let nestedContainment: CGFloat = 0.8

    /// A card's art panel is itself a rectangle of card-like proportions, and
    /// the detector fires on it at nearly the card's confidence — 0.90–0.96 on
    /// the hand-held frames of `scan-session-20260830-171145`, out-scoring the
    /// card outright on one of them. Because every later stage is gated on
    /// agreement with the top detection, a panel that wins on confidence is
    /// cropped and embedded as if it were the card (four abstentions in that
    /// session; the card itself ranked first at 0.76–0.93 from the plain box).
    /// Cards do not contain cards, so a detection nested inside a larger
    /// detection is a panel and is dropped regardless of confidence. Boxes may
    /// be in any consistent space; the input order is preserved. Callers apply
    /// this after their own size filters: the detector also fires page-sized
    /// boxes on binder spreads, and one of those must not swallow the cards.
    static func indicesSuppressingNestedBoxes(_ boxes: [CGRect]) -> [Int] {
        boxes.indices.filter { index in
            let box = boxes[index].standardized
            let area = box.width * box.height
            guard area > 0 else { return false }
            return !boxes.indices.contains { other in
                guard other != index else { return false }
                let container = boxes[other].standardized
                guard container.width * container.height > area else { return false }
                let overlap = box.intersection(container)
                guard !overlap.isNull else { return false }
                return overlap.width * overlap.height >= area * nestedContainment
            }
        }
    }
}

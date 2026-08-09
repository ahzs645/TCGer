import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
@preconcurrency import Vision

nonisolated struct CardCropper {
    struct Configuration {
        static let maximumObservations: Int = 5
        static let minimumConfidence: Float = 0.65
        static let minimumAspectRatio: Float = 0.58
        static let maximumAspectRatio: Float = 0.9
        static let minimumSize: Float = 0.1
        static let targetSize = CGSize(width: 720, height: 1000)
    }

    private let ciContext = CIContext()
    private let detector: CardObjectDetector?

    init(detector: CardObjectDetector? = CardObjectDetector.shared) {
        self.detector = detector
    }

    func bestCrop(from image: CGImage) throws -> CGImage? {
        try preferredCrop(from: image)?.image
    }

    /// `bestCrop` plus the observation that produced it, so callers recording
    /// diagnostics can persist the chosen quad alongside the crop.
    func preferredCrop(
        from image: CGImage
    ) throws -> (image: CGImage, observation: VNRectangleObservation)? {
        let rectangles = try detectRectangles(in: image)
        guard let best = Self.preferredObservation(from: rectangles),
              let crop = makeNormalizedCrop(from: image, observation: best)
        else { return nil }
        return (crop, best)
    }

    /// Vision's rectangle detector reports confidence 1.0 for many interior
    /// rectangles at once, so confidence alone cannot rank them and `max(by:)`
    /// resolves the tie arbitrarily. Every candidate reaching this point has
    /// already been constrained to card-like proportions, so the largest one is
    /// the card and the smaller ones are panels printed on it.
    static func preferredObservation(
        from observations: [VNRectangleObservation]
    ) -> VNRectangleObservation? {
        observations.max { lhs, rhs in
            let lhsArea = normalizedArea(of: lhs)
            let rhsArea = normalizedArea(of: rhs)
            if abs(lhsArea - rhsArea) > 0.01 { return lhsArea < rhsArea }
            return lhs.confidence < rhs.confidence
        }
    }

    /// Shoelace area of the observed quadrilateral in normalized coordinates.
    /// A rotated card's `boundingBox` overstates its area; its corners do not.
    static func normalizedArea(of observation: VNRectangleObservation) -> CGFloat {
        quadrilateralArea(
            topLeft: observation.topLeft,
            topRight: observation.topRight,
            bottomRight: observation.bottomRight,
            bottomLeft: observation.bottomLeft
        )
    }

    static func quadrilateralArea(
        topLeft: CGPoint,
        topRight: CGPoint,
        bottomRight: CGPoint,
        bottomLeft: CGPoint
    ) -> CGFloat {
        let corners = [topLeft, topRight, bottomRight, bottomLeft]
        var total: CGFloat = 0
        for index in corners.indices {
            let current = corners[index]
            let next = corners[(index + 1) % corners.count]
            total += current.x * next.y - next.x * current.y
        }
        return abs(total) / 2
    }

    /// The full frame normalized exactly like a detected crop (rotated to
    /// portrait, resized to 720×1000). Used when the input image may already
    /// be a borderless card crop, where every detector fires on interior
    /// panels instead of the (invisible) card edges.
    func normalizedWholeImage(from image: CGImage) -> CGImage? {
        makeNormalizedCrop(
            from: image,
            observation: Self.rectangleObservation(for: CGRect(x: 0, y: 0, width: 1, height: 1))
        )
    }

    func detectRectangles(in image: CGImage) throws -> [VNRectangleObservation] {
        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])

        // A detector trained specifically on trading cards provides the coarse
        // location. Vision then refines the corners, but only candidates that
        // agree with the detector are allowed to suppress its fallback box.
        let detectedCard = try? detector?.detections(in: image).first

        // Primary: VNDetectDocumentSegmentationRequest — ANE-accelerated,
        // real-time, iOS 15+. Returns a VNRectangleObservation with corners, so
        // makeNormalizedCrop works unchanged. NOTE: trained on paper documents —
        // validate against glossy foils / full-art that it doesn't crop inside
        // the card edge before trusting it exclusively.
        let documentRequest = VNDetectDocumentSegmentationRequest()
        try? handler.perform([documentRequest])
        if let documents = documentRequest.results?.filter(Self.isPlausibleDocumentDetection),
           !documents.isEmpty {
            if let detectedCard {
                let agreeing = documents.filter {
                    Self.intersectionOverUnion($0.boundingBox, detectedCard.boundingBox) >= 0.45
                }
                if !agreeing.isEmpty { return agreeing }
            } else {
                return documents
            }
        }

        // Fallback: classic rectangle detector (robust on odd foils/full-art).
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = Configuration.maximumObservations
        request.minimumConfidence = Configuration.minimumConfidence
        request.minimumAspectRatio = Configuration.minimumAspectRatio
        request.maximumAspectRatio = Configuration.maximumAspectRatio
        request.minimumSize = Configuration.minimumSize

        try handler.perform([request])
        let rectangles = request.results ?? []
        guard let detectedCard else { return rectangles }
        let agreeing = rectangles.filter {
            Self.intersectionOverUnion($0.boundingBox, detectedCard.boundingBox) >= 0.35
        }
        if !agreeing.isEmpty { return agreeing }
        return [Self.rectangleObservation(for: detectedCard.boundingBox)]
    }

    /// Document segmentation is intentionally broad and can return the full
    /// camera frame (or a tiny patch of background) with zero confidence. Do
    /// not let those observations suppress the card-shaped rectangle fallback.
    static func isPlausibleDocumentDetection(_ observation: VNRectangleObservation) -> Bool {
        isPlausibleDocumentDetection(
            confidence: observation.confidence,
            bounds: observation.boundingBox
        )
            && isCardShaped(
                topLeft: observation.topLeft,
                topRight: observation.topRight,
                bottomLeft: observation.bottomLeft,
                bottomRight: observation.bottomRight
            )
    }

    static func isPlausibleDocumentDetection(confidence: Float, bounds: CGRect) -> Bool {
        let bounds = bounds.standardized
        let area = bounds.width * bounds.height
        let minimumArea = CGFloat(Configuration.minimumSize * Configuration.minimumSize)
        return confidence >= Configuration.minimumConfidence
            && area >= minimumArea
            && area <= 0.72
    }

    /// Measures the four quad edges instead of `boundingBox.width / height`.
    /// A rotated card can have a nearly-square axis-aligned bounding box, while
    /// its actual opposite edges still preserve the card's portrait ratio.
    static func isCardShaped(
        topLeft: CGPoint,
        topRight: CGPoint,
        bottomLeft: CGPoint,
        bottomRight: CGPoint
    ) -> Bool {
        let horizontal = (
            distance(topLeft, topRight) + distance(bottomLeft, bottomRight)
        ) / 2
        let vertical = (
            distance(topLeft, bottomLeft) + distance(topRight, bottomRight)
        ) / 2
        let longEdge = max(horizontal, vertical)
        guard longEdge > 0 else { return false }
        let ratio = min(horizontal, vertical) / longEdge
        return ratio >= CGFloat(Configuration.minimumAspectRatio)
            && ratio <= CGFloat(Configuration.maximumAspectRatio)
    }

    static func intersectionOverUnion(_ lhs: CGRect, _ rhs: CGRect) -> CGFloat {
        let lhs = lhs.standardized
        let rhs = rhs.standardized
        let intersection = lhs.intersection(rhs)
        guard !intersection.isNull, !intersection.isEmpty else { return 0 }
        let intersectionArea = intersection.width * intersection.height
        let unionArea = lhs.width * lhs.height + rhs.width * rhs.height - intersectionArea
        return unionArea > 0 ? intersectionArea / unionArea : 0
    }

    static func rectangleObservation(for bounds: CGRect) -> VNRectangleObservation {
        VNRectangleObservation(
            requestRevision: VNDetectRectanglesRequestRevision1,
            topLeft: CGPoint(x: bounds.minX, y: bounds.maxY),
            bottomLeft: CGPoint(x: bounds.minX, y: bounds.minY),
            bottomRight: CGPoint(x: bounds.maxX, y: bounds.minY),
            topRight: CGPoint(x: bounds.maxX, y: bounds.maxY)
        )
    }

    func makeNormalizedCrop(from image: CGImage, observation: VNRectangleObservation) -> CGImage? {
        let imageSize = CGSize(width: image.width, height: image.height)
        let ciImage = CIImage(cgImage: image)
        let perspectiveFilter = CIFilter.perspectiveCorrection()
        perspectiveFilter.inputImage = ciImage
        perspectiveFilter.topLeft = convert(observation.topLeft, in: imageSize)
        perspectiveFilter.topRight = convert(observation.topRight, in: imageSize)
        perspectiveFilter.bottomLeft = convert(observation.bottomLeft, in: imageSize)
        perspectiveFilter.bottomRight = convert(observation.bottomRight, in: imageSize)

        guard var corrected = perspectiveFilter.outputImage else {
            return nil
        }

        // Perspective correction preserves the detected orientation. The
        // recognition assets are portrait card faces, so rotate a landscape
        // result before resizing instead of stretching it into 720x1000.
        if corrected.extent.width > corrected.extent.height {
            corrected = corrected.oriented(.right)
        }

        // Core Image rotations can leave a non-zero/negative extent origin.
        // Translate to zero so the final crop never clips part of the card.
        corrected = corrected.transformed(by: CGAffineTransform(
            translationX: -corrected.extent.minX,
            y: -corrected.extent.minY
        ))

        let scaleX = Configuration.targetSize.width / corrected.extent.width
        let scaleY = Configuration.targetSize.height / corrected.extent.height
        corrected = corrected
            .transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
            .cropped(to: CGRect(origin: .zero, size: Configuration.targetSize))

        // No exposure/contrast/saturation adjustment here: the embedding index
        // and the artwork-fingerprint database are both built from unmodified
        // catalog images, so any color grade on the query crop breaks parity.
        // Contrast-style standardization is measured harmful to the embedding
        // path (see docs/scanner-model-ai-handoff.md) — keep such ops OCR-only.

        return ciContext.createCGImage(corrected, from: corrected.extent)
    }

    private func convert(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: point.x * size.width, y: point.y * size.height)
    }

    private static func distance(_ lhs: CGPoint, _ rhs: CGPoint) -> CGFloat {
        hypot(lhs.x - rhs.x, lhs.y - rhs.y)
    }
}

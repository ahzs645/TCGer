import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
@preconcurrency import Vision

final class MagicPerceptualHashScannerStrategy: ScanStrategy {
    private enum Configuration {
        static let targetSize = CGSize(width: 720, height: 1000)
        static let minimumConfidence: Float = 0.6
        static let maximumObservations: Int = 5
    }

    let kind: ScanStrategyKind = .perceptualHash
    let supportsLiveScanning: Bool = true

    private let hashLibrary: MagicCardHashLibrary
    private let ciContext = CIContext()

    init(hashLibrary: MagicCardHashLibrary = .shared) {
        self.hashLibrary = hashLibrary
    }

    func supports(_ mode: ScanMode) -> Bool {
        mode == .mtg
    }

    func scan(
        image: CGImage,
        context: CardScannerContext,
        apiService: APIService
    ) async throws -> CardScanResult? {
        guard supports(context.mode) else {
            throw CardScannerError.ineligibleMode
        }

        guard await hashLibrary.isReady() else {
            return nil
        }

        let start = Date()
        let rectangles = try detectRectangles(in: image)
        guard !rectangles.isEmpty else { return nil }

        var matches: [CardScanCandidate] = []
        matches.reserveCapacity(rectangles.count)

        for rect in rectangles {
            guard let normalized = makeNormalizedCrop(from: image, observation: rect) else {
                continue
            }

            let hash = PerceptualHash.hash(for: normalized)
            let hashMatches = await hashLibrary.bestMatches(for: hash)
            guard let bestMatch = hashMatches.first else { continue }

            let score = max(0.1, min(0.99, bestMatch.confidenceScore))
            let confidence = CardScanConfidence(
                score: score,
                reason: "pHash distance \(bestMatch.distance)"
            )

            let candidate = CardScanCandidate(
                details: bestMatch.entry.makeDetails(),
                confidence: confidence,
                originatingStrategy: kind,
                debugInfo: [
                    "distance": "\(bestMatch.distance)",
                    "hash": String(hash, radix: 16),
                    "rectAspect": String(format: "%.2f", rect.aspectRatio)
                ]
            )
            matches.append(candidate)
        }

        guard let primary = matches.max(by: { $0.confidence.score < $1.confidence.score }) else {
            return nil
        }

        let alternatives = matches
            .filter { $0.id != primary.id }
            .sorted { $0.confidence.score > $1.confidence.score }

        return CardScanResult(
            mode: context.mode,
            capturedImage: image,
            primary: primary,
            alternatives: alternatives,
            elapsed: Date().timeIntervalSince(start)
        )
    }

    private func detectRectangles(in image: CGImage) throws -> [VNRectangleObservation] {
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = Configuration.maximumObservations
        request.minimumConfidence = Configuration.minimumConfidence
        request.minimumAspectRatio = 0.6
        request.maximumAspectRatio = 0.85
        request.minimumSize = 0.12

        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        try handler.perform([request])
        return request.results ?? []
    }

    private func makeNormalizedCrop(
        from image: CGImage,
        observation: VNRectangleObservation
    ) -> CGImage? {
        let imageSize = CGSize(width: image.width, height: image.height)
        let ciImage = CIImage(cgImage: image)
        let perspectiveFilter = CIFilter.perspectiveCorrection()
        perspectiveFilter.inputImage = ciImage
        perspectiveFilter.topLeft = CIVector(cgPoint: convert(observation.topLeft, in: imageSize))
        perspectiveFilter.topRight = CIVector(cgPoint: convert(observation.topRight, in: imageSize))
        perspectiveFilter.bottomLeft = CIVector(cgPoint: convert(observation.bottomLeft, in: imageSize))
        perspectiveFilter.bottomRight = CIVector(cgPoint: convert(observation.bottomRight, in: imageSize))

        guard var corrected = perspectiveFilter.outputImage else {
            return nil
        }

        let scaleX = Configuration.targetSize.width / corrected.extent.width
        let scaleY = Configuration.targetSize.height / corrected.extent.height
        corrected = corrected
            .transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
            .cropped(to: CGRect(origin: .zero, size: Configuration.targetSize))

        corrected = corrected
            .applyingFilter("CIExposureAdjust", parameters: ["inputEV": 0.15])
            .applyingFilter("CIColorControls", parameters: [
                "inputSaturation": 1.05,
                "inputContrast": 1.15,
                "inputBrightness": -0.02
            ])

        return ciContext.createCGImage(corrected, from: corrected.extent)
    }

    private func convert(_ point: CGPoint, in imageSize: CGSize) -> CGPoint {
        CGPoint(
            x: point.x * imageSize.width,
            y: point.y * imageSize.height
        )
    }
}

private extension VNRectangleObservation {
    var aspectRatio: CGFloat {
        let width = hypot(topLeft.x - topRight.x, topLeft.y - topRight.y)
        let height = hypot(topLeft.x - bottomLeft.x, topLeft.y - bottomLeft.y)
        guard height > 0 else { return 0 }
        return width / height
    }
}

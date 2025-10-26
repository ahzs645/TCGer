import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
@preconcurrency import Vision

struct CardCropper {
    struct Configuration {
        static let maximumObservations: Int = 5
        static let minimumConfidence: Float = 0.65
        static let minimumAspectRatio: Float = 0.58
        static let maximumAspectRatio: Float = 0.9
        static let minimumSize: Float = 0.1
        static let targetSize = CGSize(width: 720, height: 1000)
    }

    private let ciContext = CIContext()

    func bestCrop(from image: CGImage) throws -> CGImage? {
        let rectangles = try detectRectangles(in: image)
        guard let best = rectangles.max(by: { $0.confidence < $1.confidence }) else {
            return nil
        }
        return makeNormalizedCrop(from: image, observation: best)
    }

    func detectRectangles(in image: CGImage) throws -> [VNRectangleObservation] {
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = Configuration.maximumObservations
        request.minimumConfidence = Configuration.minimumConfidence
        request.minimumAspectRatio = Configuration.minimumAspectRatio
        request.maximumAspectRatio = Configuration.maximumAspectRatio
        request.minimumSize = Configuration.minimumSize

        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        try handler.perform([request])
        return request.results ?? []
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

        let scaleX = Configuration.targetSize.width / corrected.extent.width
        let scaleY = Configuration.targetSize.height / corrected.extent.height
        corrected = corrected
            .transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
            .cropped(to: CGRect(origin: .zero, size: Configuration.targetSize))

        corrected = corrected
            .applyingFilter("CIExposureAdjust", parameters: ["inputEV": 0.1])
            .applyingFilter("CIColorControls", parameters: [
                "inputSaturation": 1.05,
                "inputContrast": 1.1,
                "inputBrightness": -0.02
            ])

        return ciContext.createCGImage(corrected, from: corrected.extent)
    }

    private func convert(_ point: CGPoint, in size: CGSize) -> CGPoint {
        CGPoint(x: point.x * size.width, y: point.y * size.height)
    }
}

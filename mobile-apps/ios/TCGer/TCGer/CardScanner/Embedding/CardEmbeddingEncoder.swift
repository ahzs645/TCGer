import CoreGraphics
import CoreML
import CoreVideo
import Foundation

protocol CardEmbeddingModelLoading {
    func makeModel() throws -> MLModel
}

struct CardEmbeddingEncoder {
    enum EncoderError: Error, LocalizedError {
        case modelUnavailable
        case imageConstraintUnavailable
        case featureValueCreationFailed
        case embeddingMissing

        var errorDescription: String? {
            switch self {
            case .modelUnavailable:
                return "CardEmbeddings.mlmodelc is missing from the app bundle. Generate the iOS scan resources, then rebuild and reinstall the app."
            case .imageConstraintUnavailable:
                return "CardEmbeddings.mlmodelc does not expose an image input named \"image\"."
            case .featureValueCreationFailed:
                return "Could not create the Core ML image input for CardEmbeddings.mlmodelc."
            case .embeddingMissing:
                return "CardEmbeddings.mlmodelc did not return an output named \"embedding\"."
            }
        }
    }

    private let modelLoader: CardEmbeddingModelLoading
    private let inputName: String
    private let outputName: String

    init(
        modelLoader: CardEmbeddingModelLoading = BundleCardEmbeddingModelLoader(),
        inputName: String = "image",
        outputName: String = "embedding"
    ) {
        self.modelLoader = modelLoader
        self.inputName = inputName
        self.outputName = outputName
    }

    func embedding(for image: CGImage) async throws -> [Float] {
        let model = try modelLoader.makeModel()
        guard let constraint = model.modelDescription.inputDescriptionsByName[inputName]?.imageConstraint else {
            throw EncoderError.imageConstraintUnavailable
        }

        guard let buffer = image.pixelBuffer(width: constraint.pixelsWide, height: constraint.pixelsHigh) else {
            throw EncoderError.featureValueCreationFailed
        }

        let provider = try MLDictionaryFeatureProvider(dictionary: [
            inputName: MLFeatureValue(pixelBuffer: buffer)
        ])

        let prediction = try await model.prediction(from: provider)
        guard let multiArray = prediction.featureValue(for: outputName)?.multiArrayValue else {
            throw EncoderError.embeddingMissing
        }

        return multiArray.toArray()
    }
}

struct BundleCardEmbeddingModelLoader: CardEmbeddingModelLoading {
    private let modelName: String
    private let fileExtension: String

    init(modelName: String = "CardEmbeddings", fileExtension: String = "mlmodelc") {
        self.modelName = modelName
        self.fileExtension = fileExtension
    }

    func makeModel() throws -> MLModel {
        guard let url = Bundle.main.url(forResource: modelName, withExtension: fileExtension) else {
            throw CardEmbeddingEncoder.EncoderError.modelUnavailable
        }
        return try MLModel(contentsOf: url)
    }
}

private enum DINOv2Preprocessing {
    static let resizedShortestEdge = 256
}

private extension CGImage {
    func pixelBuffer(width: Int, height: Int) -> CVPixelBuffer? {
        guard let preprocessed = centerCroppedAfterResize(
            shortestEdge: DINOv2Preprocessing.resizedShortestEdge,
            cropWidth: width,
            cropHeight: height
        ) else {
            return nil
        }
        return preprocessed.renderedPixelBuffer(width: width, height: height)
    }

    func centerCroppedAfterResize(shortestEdge: Int, cropWidth: Int, cropHeight: Int) -> CGImage? {
        guard width > 0,
              height > 0,
              shortestEdge > 0,
              cropWidth > 0,
              cropHeight > 0
        else { return nil }

        let sourceShortestEdge = min(width, height)
        let scale = max(
            CGFloat(shortestEdge) / CGFloat(sourceShortestEdge),
            CGFloat(cropWidth) / CGFloat(width),
            CGFloat(cropHeight) / CGFloat(height)
        )
        let resizedWidth = Int((CGFloat(width) * scale).rounded(.up))
        let resizedHeight = Int((CGFloat(height) * scale).rounded(.up))

        guard let resized = resized(width: resizedWidth, height: resizedHeight) else {
            return nil
        }

        let cropX = max(0, (resized.width - cropWidth) / 2)
        let cropY = max(0, (resized.height - cropHeight) / 2)
        let cropRect = CGRect(x: cropX, y: cropY, width: cropWidth, height: cropHeight)
        return resized.cropping(to: cropRect)
    }

    func resized(width: Int, height: Int) -> CGImage? {
        guard width > 0, height > 0 else { return nil }
        guard let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        ) else {
            return nil
        }
        context.interpolationQuality = .high
        context.draw(self, in: CGRect(x: 0, y: 0, width: width, height: height))
        return context.makeImage()
    }

    func renderedPixelBuffer(width: Int, height: Int) -> CVPixelBuffer? {
        var pixelBuffer: CVPixelBuffer?
        let attrs: [CFString: Any] = [
            kCVPixelBufferCGImageCompatibilityKey: true,
            kCVPixelBufferCGBitmapContextCompatibilityKey: true
        ]
        CVPixelBufferCreate(
            kCFAllocatorDefault,
            width,
            height,
            kCVPixelFormatType_32ARGB,
            attrs as CFDictionary,
            &pixelBuffer
        )

        guard let buffer = pixelBuffer else { return nil }
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }

        guard let context = CGContext(
            data: CVPixelBufferGetBaseAddress(buffer),
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        ) else {
            return nil
        }
        context.interpolationQuality = .high
        context.draw(self, in: CGRect(x: 0, y: 0, width: width, height: height))
        return buffer
    }
}

private extension MLMultiArray {
    func toArray() -> [Float] {
        (0..<count).map { self[$0].floatValue }
    }
}

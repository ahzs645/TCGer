import CoreGraphics
import CoreML
import CoreVideo
import Foundation

protocol CardEmbeddingModelLoading {
    func makeModel() throws -> MLModel
}

struct CardEmbeddingEncoder {
    enum EncoderError: Error {
        case modelUnavailable
        case imageConstraintUnavailable
        case featureValueCreationFailed
        case embeddingMissing
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

private extension CGImage {
    func pixelBuffer(width: Int, height: Int) -> CVPixelBuffer? {
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

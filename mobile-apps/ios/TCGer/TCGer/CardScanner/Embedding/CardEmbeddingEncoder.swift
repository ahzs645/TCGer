import CoreGraphics
import CoreML
import CoreVideo
import Foundation

protocol CardEmbeddingModelLoading {
    var isAvailable: Bool { get }
    func makeModel() async throws -> MLModel
}

extension CardEmbeddingModelLoading {
    var isAvailable: Bool { true }
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

    var isAvailable: Bool {
        modelLoader.isAvailable
    }

    func embedding(for image: CGImage) async throws -> [Float] {
        let model = try await modelLoader.makeModel()
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

    /// Embeds several images through one Core ML batch prediction. Batching
    /// amortizes per-request dispatch overhead — most visible on device ANE
    /// builds where each request pays a fixed scheduling cost. Results align
    /// with the input order; an image whose output is missing yields an empty
    /// embedding (mirroring how callers treat a failed single embedding).
    func embeddings(for images: [CGImage]) async throws -> [[Float]] {
        guard !images.isEmpty else { return [] }
        let model = try await modelLoader.makeModel()
        guard let constraint = model.modelDescription.inputDescriptionsByName[inputName]?.imageConstraint else {
            throw EncoderError.imageConstraintUnavailable
        }

        let providers = try images.map { image -> MLDictionaryFeatureProvider in
            guard let buffer = image.pixelBuffer(width: constraint.pixelsWide, height: constraint.pixelsHigh) else {
                throw EncoderError.featureValueCreationFailed
            }
            return try MLDictionaryFeatureProvider(dictionary: [
                inputName: MLFeatureValue(pixelBuffer: buffer)
            ])
        }

        let batch = try model.predictions(fromBatch: MLArrayBatchProvider(array: providers))
        return (0..<batch.count).map { index in
            batch.features(at: index).featureValue(for: outputName)?.multiArrayValue?.toArray() ?? []
        }
    }
}

actor BundleCardEmbeddingModelLoader: CardEmbeddingModelLoading {
    private let modelURL: URL?
    private var cachedModel: MLModel?
    private var loadingTask: Task<MLModel, Error>?
    nonisolated let isAvailable: Bool

    init(
        modelName: String = "CardEmbeddings",
        fileExtension: String = "mlmodelc",
        bundle: Bundle = .main
    ) {
        let url = bundle.url(forResource: modelName, withExtension: fileExtension)
        self.modelURL = url
        self.isAvailable = url != nil
    }

    /// Core ML model construction may compile and specialize the model for
    /// the current device. Use Core ML's asynchronous loader and share one
    /// in-flight task so warm-up and an early capture never compile it twice.
    func makeModel() async throws -> MLModel {
        if let cachedModel {
            return cachedModel
        }
        if let loadingTask {
            return try await loadingTask.value
        }

        guard let modelURL else {
            throw CardEmbeddingEncoder.EncoderError.modelUnavailable
        }

        let configuration = MLModelConfiguration()
        #if targetEnvironment(simulator)
        // Simulator GPU support varies by host OS/Xcode pairing. CPU inference
        // keeps scanner fixtures deterministic and avoids MPSGraph failures.
        configuration.computeUnits = .cpuOnly
        #else
        configuration.computeUnits = .all
        #endif

        let task = Task<MLModel, Error> {
            try await MLModel.load(contentsOf: modelURL, configuration: configuration)
        }
        loadingTask = task
        do {
            let model = try await task.value
            cachedModel = model
            loadingTask = nil
            return model
        } catch {
            loadingTask = nil
            throw error
        }
    }
}

/// Loads a compiled Core ML model installed under Application Support. Each
/// downloadable scanner pack supplies its own model/index/metadata trio, so a
/// remote game's vectors can never be paired with the bundled Pokémon model.
actor FileCardEmbeddingModelLoader: CardEmbeddingModelLoading {
    private let modelURL: URL
    private var cachedModel: MLModel?
    private var loadingTask: Task<MLModel, Error>?
    nonisolated let isAvailable: Bool

    init(modelURL: URL, fileManager: FileManager = .default) {
        self.modelURL = modelURL
        isAvailable = fileManager.fileExists(atPath: modelURL.path)
    }

    func makeModel() async throws -> MLModel {
        if let cachedModel { return cachedModel }
        if let loadingTask { return try await loadingTask.value }
        guard isAvailable else {
            throw CardEmbeddingEncoder.EncoderError.modelUnavailable
        }

        let configuration = MLModelConfiguration()
        #if targetEnvironment(simulator)
        configuration.computeUnits = .cpuOnly
        #else
        configuration.computeUnits = .all
        #endif

        let modelURL = self.modelURL
        let task = Task<MLModel, Error> {
            try await MLModel.load(contentsOf: modelURL, configuration: configuration)
        }
        loadingTask = task
        do {
            let model = try await task.value
            cachedModel = model
            loadingTask = nil
            return model
        } catch {
            loadingTask = nil
            throw error
        }
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

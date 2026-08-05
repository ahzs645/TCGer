import CoreGraphics
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
@preconcurrency import Vision

enum ScannerCaptureMode: String, CaseIterable, Identifiable, Sendable {
    case card
    case binder

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .card: return "Card"
        case .binder: return "Binder"
        }
    }

    var systemImage: String {
        switch self {
        case .card: return "rectangle.portrait"
        case .binder: return "square.grid.3x3"
        }
    }
}

nonisolated struct BinderNormalizedQuad: Sendable {
    let topLeft: CGPoint
    let topRight: CGPoint
    let bottomLeft: CGPoint
    let bottomRight: CGPoint

    init(observation: VNRectangleObservation) {
        topLeft = observation.topLeft
        topRight = observation.topRight
        bottomLeft = observation.bottomLeft
        bottomRight = observation.bottomRight
    }

    func points(in rect: CGRect) -> [CGPoint] {
        func map(_ point: CGPoint) -> CGPoint {
            CGPoint(
                x: rect.minX + point.x * rect.width,
                y: rect.minY + (1 - point.y) * rect.height
            )
        }

        return [map(topLeft), map(topRight), map(bottomRight), map(bottomLeft)]
    }
}

enum BinderCardDetectionStatus: String, Sendable {
    case matched
    case uncertain
    case unmatched
}

nonisolated struct BinderCardDetection: Identifiable, @unchecked Sendable {
    let id: UUID
    let quad: BinderNormalizedQuad
    let crop: CGImage
    let rectangleConfidence: Float
    var selectedCandidate: CardScanCandidate?
    var candidateOptions: [CardScanCandidate]
    var status: BinderCardDetectionStatus
    var isIncluded: Bool

    init(
        id: UUID = UUID(),
        quad: BinderNormalizedQuad,
        crop: CGImage,
        rectangleConfidence: Float,
        selectedCandidate: CardScanCandidate?,
        candidateOptions: [CardScanCandidate],
        status: BinderCardDetectionStatus,
        isIncluded: Bool
    ) {
        self.id = id
        self.quad = quad
        self.crop = crop
        self.rectangleConfidence = rectangleConfidence
        self.selectedCandidate = selectedCandidate
        self.candidateOptions = candidateOptions
        self.status = status
        self.isIncluded = isIncluded
    }
}

nonisolated struct BinderPageScanResult: Identifiable, @unchecked Sendable {
    let id: UUID
    let mode: ScanMode
    let capturedImage: CGImage
    let detections: [BinderCardDetection]
    let elapsed: TimeInterval

    init(
        id: UUID = UUID(),
        mode: ScanMode,
        capturedImage: CGImage,
        detections: [BinderCardDetection],
        elapsed: TimeInterval
    ) {
        self.id = id
        self.mode = mode
        self.capturedImage = capturedImage
        self.detections = detections
        self.elapsed = elapsed
    }
}

actor BinderPageScanner {
    private enum Configuration {
        static let maximumObservations = 18
        static let maximumConcurrentIdentifications = 3
        static let minimumConfidence: Float = 0.5
        static let minimumAspectRatio: Float = 0.5
        static let maximumAspectRatio: Float = 1.0
        static let minimumSize: Float = 0.08
        static let maximumBoundingBoxArea: CGFloat = 0.45
        static let duplicateIntersectionThreshold: CGFloat = 0.55
        static let matchedScore = 0.82
        static let targetSize = CGSize(width: 720, height: 1000)
    }

    private struct CropWorkItem: @unchecked Sendable {
        let index: Int
        let observation: VNRectangleObservation
        let crop: CGImage
    }

    private struct Identification: Sendable {
        let primary: CardScanCandidate
        let alternatives: [CardScanCandidate]
    }

    private let coordinator: CardScannerCoordinator
    private let ciContext = CIContext()

    init(coordinator: CardScannerCoordinator) {
        self.coordinator = coordinator
    }

    func scan(image: CGImage, context: CardScannerContext) async throws -> BinderPageScanResult {
        let start = Date()
        let observations = try detectRectangles(in: image)
        let croppedObservations = observations.compactMap { observation -> (VNRectangleObservation, CGImage)? in
            guard let crop = makeNormalizedCrop(from: image, observation: observation) else {
                return nil
            }
            return (observation, crop)
        }
        let workItems = croppedObservations.enumerated().map { index, item in
            CropWorkItem(index: index, observation: item.0, crop: item.1)
        }

        var identifications = Array<Identification?>(repeating: nil, count: workItems.count)
        await withTaskGroup(of: (Int, Identification?).self) { group in
            let initialCount = min(Configuration.maximumConcurrentIdentifications, workItems.count)
            for item in workItems.prefix(initialCount) {
                let itemIndex = item.index
                let crop = item.crop
                group.addTask { [coordinator, context] in
                    let result = await coordinator.scan(
                        image: crop,
                        context: context,
                        source: .photoCapture
                    )
                    guard case .success(let scanResult) = result else {
                        return (itemIndex, nil)
                    }
                    return (
                        itemIndex,
                        Identification(
                            primary: scanResult.primary,
                            alternatives: scanResult.alternatives
                        )
                    )
                }
            }

            var nextIndex = initialCount

            while let (index, result) = await group.next() {
                if index < identifications.count {
                    identifications[index] = result
                }
                if nextIndex < workItems.count {
                    let item = workItems[nextIndex]
                    let itemIndex = item.index
                    let crop = item.crop
                    nextIndex += 1
                    group.addTask { [coordinator, context] in
                        let result = await coordinator.scan(
                            image: crop,
                            context: context,
                            source: .photoCapture
                        )
                        guard case .success(let scanResult) = result else {
                            return (itemIndex, nil)
                        }
                        return (
                            itemIndex,
                            Identification(
                                primary: scanResult.primary,
                                alternatives: scanResult.alternatives
                            )
                        )
                    }
                }
            }
        }

        let detections = workItems.map { item -> BinderCardDetection in
            guard let result = identifications[item.index] else {
                return BinderCardDetection(
                    quad: BinderNormalizedQuad(observation: item.observation),
                    crop: item.crop,
                    rectangleConfidence: item.observation.confidence,
                    selectedCandidate: nil,
                    candidateOptions: [],
                    status: .unmatched,
                    isIncluded: false
                )
            }

            let status: BinderCardDetectionStatus = result.primary.confidence.score >= Configuration.matchedScore
                ? .matched
                : .uncertain
            return BinderCardDetection(
                quad: BinderNormalizedQuad(observation: item.observation),
                crop: item.crop,
                rectangleConfidence: item.observation.confidence,
                selectedCandidate: result.primary,
                candidateOptions: [result.primary] + result.alternatives,
                status: status,
                isIncluded: true
            )
        }

        return BinderPageScanResult(
            mode: context.mode,
            capturedImage: image,
            detections: detections,
            elapsed: Date().timeIntervalSince(start)
        )
    }

    private func detectRectangles(in image: CGImage) throws -> [VNRectangleObservation] {
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = Configuration.maximumObservations
        request.minimumConfidence = Configuration.minimumConfidence
        request.minimumAspectRatio = Configuration.minimumAspectRatio
        request.maximumAspectRatio = Configuration.maximumAspectRatio
        request.minimumSize = Configuration.minimumSize
        request.quadratureTolerance = 35

        let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
        try handler.perform([request])

        let ranked = (request.results ?? [])
            .filter { observation in
                observation.boundingBox.width * observation.boundingBox.height <=
                    Configuration.maximumBoundingBoxArea
            }
            .sorted { lhs, rhs in
            if abs(lhs.boundingBox.midY - rhs.boundingBox.midY) > 0.08 {
                return lhs.boundingBox.midY > rhs.boundingBox.midY
            }
            return lhs.boundingBox.midX < rhs.boundingBox.midX
            }

        var accepted: [VNRectangleObservation] = []
        for observation in ranked {
            let isDuplicate = accepted.contains { existing in
                intersectionOverUnion(observation.boundingBox, existing.boundingBox) >=
                    Configuration.duplicateIntersectionThreshold
            }
            if !isDuplicate {
                accepted.append(observation)
            }
        }
        return accepted
    }

    private func intersectionOverUnion(_ lhs: CGRect, _ rhs: CGRect) -> CGFloat {
        let intersection = lhs.intersection(rhs)
        guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else {
            return 0
        }
        let intersectionArea = intersection.width * intersection.height
        let unionArea = lhs.width * lhs.height + rhs.width * rhs.height - intersectionArea
        guard unionArea > 0 else { return 0 }
        return intersectionArea / unionArea
    }

    private func makeNormalizedCrop(
        from image: CGImage,
        observation: VNRectangleObservation
    ) -> CGImage? {
        let imageSize = CGSize(width: image.width, height: image.height)
        let filter = CIFilter.perspectiveCorrection()
        filter.inputImage = CIImage(cgImage: image)
        filter.topLeft = convert(observation.topLeft, in: imageSize)
        filter.topRight = convert(observation.topRight, in: imageSize)
        filter.bottomLeft = convert(observation.bottomLeft, in: imageSize)
        filter.bottomRight = convert(observation.bottomRight, in: imageSize)

        guard var corrected = filter.outputImage,
              corrected.extent.width > 0,
              corrected.extent.height > 0
        else { return nil }

        let scaleX = Configuration.targetSize.width / corrected.extent.width
        let scaleY = Configuration.targetSize.height / corrected.extent.height
        corrected = corrected
            .transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
            .cropped(to: CGRect(origin: .zero, size: Configuration.targetSize))
            .applyingFilter("CIExposureAdjust", parameters: ["inputEV": 0.1])
            .applyingFilter("CIColorControls", parameters: [
                "inputSaturation": 1.05,
                "inputContrast": 1.1,
                "inputBrightness": -0.02
            ])

        return ciContext.createCGImage(corrected, from: corrected.extent)
    }

    private func convert(_ point: CGPoint, in imageSize: CGSize) -> CGPoint {
        CGPoint(x: point.x * imageSize.width, y: point.y * imageSize.height)
    }
}

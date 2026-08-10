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

/// Controls whether a single card is recognized continuously from the camera
/// preview or only after the user deliberately presses the shutter.
enum ScannerTriggerMode: String, CaseIterable, Identifiable, Sendable {
    case automatic
    case manual

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .automatic: return "Auto-scan"
        case .manual: return "Tap Shutter"
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

nonisolated enum BinderCardExclusionReason: String, CaseIterable, Codable, Identifiable, Sendable {
    case backCard
    case notACard
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .backCard: return "Back card"
        case .notACard: return "Not a card"
        case .other: return "Other"
        }
    }

    var systemImage: String {
        switch self {
        case .backCard: return "rectangle.on.rectangle.slash"
        case .notACard: return "nosign"
        case .other: return "xmark.circle"
        }
    }
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
    var exclusionReason: BinderCardExclusionReason?

    init(
        id: UUID = UUID(),
        quad: BinderNormalizedQuad,
        crop: CGImage,
        rectangleConfidence: Float,
        selectedCandidate: CardScanCandidate?,
        candidateOptions: [CardScanCandidate],
        status: BinderCardDetectionStatus,
        isIncluded: Bool,
        exclusionReason: BinderCardExclusionReason? = nil
    ) {
        self.id = id
        self.quad = quad
        self.crop = crop
        self.rectangleConfidence = rectangleConfidence
        self.selectedCandidate = selectedCandidate
        self.candidateOptions = candidateOptions
        self.status = status
        self.isIncluded = isIncluded
        self.exclusionReason = exclusionReason
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

nonisolated struct BinderPageRecord: Identifiable, @unchecked Sendable {
    let result: BinderPageScanResult
    var detections: [BinderCardDetection]
    var addedDetectionIDs: Set<UUID>
    let scannedAt: Date
    let pageNumber: Int

    var id: UUID { result.id }

    init(
        result: BinderPageScanResult,
        scannedAt: Date = Date(),
        pageNumber: Int
    ) {
        self.result = result
        self.detections = result.detections
        self.addedDetectionIDs = []
        self.scannedAt = scannedAt
        self.pageNumber = pageNumber
    }
}

nonisolated struct BinderReviewPresentation: Identifiable, Sendable {
    let id: UUID
    let initialPageIndex: Int

    init(id: UUID = UUID(), initialPageIndex: Int) {
        self.id = id
        self.initialPageIndex = initialPageIndex
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
        /// A top edge that strongly disagrees with the rest of the binder page
        /// is measured evidence that corner refinement latched onto interior
        /// artwork/text instead of the card border. Preserve the detector box
        /// and let the per-card coordinator localize it again.
        static let maximumRefinedAngleDeviationDegrees: CGFloat = 15
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
    private let cropper = CardCropper()

    init(coordinator: CardScannerCoordinator) {
        self.coordinator = coordinator
    }

    func scan(image: CGImage, context: CardScannerContext) async throws -> BinderPageScanResult {
        let start = Date()
        let observations = try detectCardQuads(in: image)
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

    /// Detector-first multi-card localization. The generic rectangle detector
    /// harvests attack text boxes, card backs behind pockets, and sleeve
    /// fabric on real binder photos (measured 52/77 detections retrieving
    /// nothing on the first device dev-mode binder session); the trained
    /// card detector finds the actual cards, and per-box corner refinement
    /// rectifies each one. The rectangle path remains as fallback when the
    /// detector asset is unavailable or fires on nothing.
    private func detectCardQuads(in image: CGImage) throws -> [VNRectangleObservation] {
        if let detector = CardObjectDetector.shared {
            let boxes = ((try? detector.detections(in: image)) ?? [])
                .map { $0.boundingBox.standardized }
                .filter { box in
                    let area = box.width * box.height
                    return area >= CGFloat(Configuration.minimumSize * Configuration.minimumSize)
                        && area <= Configuration.maximumBoundingBoxArea
                }
            if !boxes.isEmpty {
                let imageSize = CGSize(width: image.width, height: image.height)
                let refinements = boxes.map { box in
                    (box, cropper.refinedQuad(in: image, around: box))
                }
                let refinedAngles = refinements.compactMap {
                    $0.1.flatMap { Self.refinedTopEdgeAngleDegrees($0, imageSize: imageSize) }
                }.sorted()
                let pageAngle = refinedAngles.isEmpty
                    ? nil
                    : refinedAngles[refinedAngles.count / 2]
                let quads = refinements.map { box, refined in
                    guard let refined,
                          !Self.shouldUseDetectorBox(
                              insteadOf: refined,
                              imageSize: imageSize,
                              pageAngleDegrees: pageAngle
                          )
                    else {
                        return CardCropper.rectangleObservation(for: box)
                    }
                    return refined
                }
                return Array(orderedAndDeduplicated(quads).prefix(Configuration.maximumObservations))
            }
        }
        return try detectRectangles(in: image)
    }

    nonisolated static func shouldUseDetectorBox(
        insteadOf refined: VNRectangleObservation,
        imageSize: CGSize,
        pageAngleDegrees: CGFloat?
    ) -> Bool {
        guard let angle = refinedTopEdgeAngleDegrees(refined, imageSize: imageSize) else {
            return true
        }
        guard let pageAngleDegrees else { return false }
        var deviation = abs(angle - pageAngleDegrees)
        if deviation > 90 { deviation = 180 - deviation }
        return deviation > Configuration.maximumRefinedAngleDeviationDegrees
    }

    nonisolated static func refinedTopEdgeAngleDegrees(
        _ refined: VNRectangleObservation,
        imageSize: CGSize
    ) -> CGFloat? {
        let dx = (refined.topRight.x - refined.topLeft.x) * imageSize.width
        let dy = (refined.topRight.y - refined.topLeft.y) * imageSize.height
        guard dx != 0 || dy != 0 else { return nil }
        var angle = abs(atan2(dy, dx) * 180 / .pi)
        if angle > 90 { angle = 180 - angle }
        return dy < 0 ? -angle : angle
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

        let filtered = (request.results ?? [])
            .filter { observation in
                observation.boundingBox.width * observation.boundingBox.height <=
                    Configuration.maximumBoundingBoxArea
            }
        return orderedAndDeduplicated(filtered)
    }

    /// Reading order (rows top-to-bottom, then left-to-right) with duplicate
    /// suppression. Cards in binder pockets physically cannot overlap, so any
    /// heavily-overlapping pair is the same card localized twice. Overlap is
    /// measured against the SMALLER box, not IoU: the classic duplicate is a
    /// text-box or art-panel fragment nested inside the full-card quad, and a
    /// contained small box has near-total overlap but tiny IoU. Larger quads
    /// win, so the full card survives and its fragments are dropped.
    private func orderedAndDeduplicated(
        _ observations: [VNRectangleObservation]
    ) -> [VNRectangleObservation] {
        let byArea = observations.sorted {
            CardCropper.normalizedArea(of: $0) > CardCropper.normalizedArea(of: $1)
        }
        var accepted: [VNRectangleObservation] = []
        for observation in byArea {
            let isDuplicate = accepted.contains { existing in
                overlapOverSmallerArea(observation.boundingBox, existing.boundingBox) >=
                    Configuration.duplicateIntersectionThreshold
            }
            if !isDuplicate {
                accepted.append(observation)
            }
        }
        return accepted.sorted { lhs, rhs in
            if abs(lhs.boundingBox.midY - rhs.boundingBox.midY) > 0.08 {
                return lhs.boundingBox.midY > rhs.boundingBox.midY
            }
            return lhs.boundingBox.midX < rhs.boundingBox.midX
        }
    }

    private func overlapOverSmallerArea(_ lhs: CGRect, _ rhs: CGRect) -> CGFloat {
        let intersection = lhs.intersection(rhs)
        guard !intersection.isNull, intersection.width > 0, intersection.height > 0 else {
            return 0
        }
        let smallerArea = min(lhs.width * lhs.height, rhs.width * rhs.height)
        guard smallerArea > 0 else { return 0 }
        return (intersection.width * intersection.height) / smallerArea
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
        // No color grade: these crops feed the same recognition strategies as
        // CardCropper output, and the reference indexes are built from
        // unmodified catalog images (parity — see docs/scanner-model-ai-handoff.md).

        return ciContext.createCGImage(corrected, from: corrected.extent)
    }

    private func convert(_ point: CGPoint, in imageSize: CGSize) -> CGPoint {
        CGPoint(x: point.x * imageSize.width, y: point.y * imageSize.height)
    }
}

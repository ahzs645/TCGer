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

    var systemImage: String {
        switch self {
        case .automatic: return "viewfinder"
        case .manual: return "camera.aperture"
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

    init(topLeft: CGPoint, topRight: CGPoint, bottomLeft: CGPoint, bottomRight: CGPoint) {
        self.topLeft = topLeft
        self.topRight = topRight
        self.bottomLeft = bottomLeft
        self.bottomRight = bottomRight
    }

    /// Re-expresses the quad relative to a sub-rect of its coordinate space
    /// (both in Vision-normalized coordinates), for when the page image is
    /// re-cropped after detection.
    func remapped(into rect: CGRect) -> BinderNormalizedQuad {
        func map(_ point: CGPoint) -> CGPoint {
            CGPoint(
                x: (point.x - rect.minX) / rect.width,
                y: (point.y - rect.minY) / rect.height
            )
        }
        return BinderNormalizedQuad(
            topLeft: map(topLeft),
            topRight: map(topRight),
            bottomLeft: map(bottomLeft),
            bottomRight: map(bottomRight)
        )
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
        /// Breathing room kept around the detected cards when the page image
        /// is re-fitted to them, as a fraction of the frame per side.
        static let pageFitMargin: CGFloat = 0.02
        /// A fit that barely trims the frame isn't worth a recrop.
        static let pageFitMinimumTrim: CGFloat = 0.97
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
        let nativeCropPixelWidth: Int
        let nativeCropPixelHeight: Int
        let rotationDegreesApplied: Int
    }

    private struct Identification: Sendable {
        let primary: CardScanCandidate
        let alternatives: [CardScanCandidate]
    }

    private struct PocketRecognition: Sendable {
        let identification: Identification?
        let diagnostics: ScanDiagnostics?
    }

    private struct NormalizedCrop: @unchecked Sendable {
        let image: CGImage
        let nativePixelWidth: Int
        let nativePixelHeight: Int
        let rotationDegreesApplied: Int
    }

    private let coordinator: CardScannerCoordinator
    private static let ciContext = CIContext()
    private let cropper = CardCropper()

    init(coordinator: CardScannerCoordinator) {
        self.coordinator = coordinator
    }

    /// `protectedRect` is the framing guide in the scanned image's
    /// Vision-normalized space; the retained page image never trims inside
    /// it (see `pageFitRect(for:protecting:)`). Nil for imports and replays,
    /// which have no guide.
    func scan(
        image: CGImage,
        context: CardScannerContext,
        protectedRect: CGRect? = nil
    ) async throws -> BinderPageScanResult {
        let start = Date()
        let observations = try detectCardQuads(
            in: image,
            intrinsics: context.cameraIntrinsics
        )
        let croppedObservations = observations.compactMap { observation -> (VNRectangleObservation, NormalizedCrop)? in
            guard let crop = makeNormalizedCrop(from: image, observation: observation) else {
                return nil
            }
            return (observation, crop)
        }
        let workItems = croppedObservations.enumerated().map { index, item in
            CropWorkItem(
                index: index,
                observation: item.0,
                crop: item.1.image,
                nativeCropPixelWidth: item.1.nativePixelWidth,
                nativeCropPixelHeight: item.1.nativePixelHeight,
                rotationDegreesApplied: item.1.rotationDegreesApplied
            )
        }

        var recognitions = Array<PocketRecognition?>(repeating: nil, count: workItems.count)
        await withTaskGroup(of: (Int, PocketRecognition).self) { group in
            let initialCount = min(Configuration.maximumConcurrentIdentifications, workItems.count)
            for item in workItems.prefix(initialCount) {
                let itemIndex = item.index
                let crop = item.crop
                group.addTask { [coordinator, context] in
                    var pocketContext = context
                    let pocketDiagnostics = context.diagnostics.map { _ in ScanDiagnostics() }
                    pocketContext.diagnostics = pocketDiagnostics
                    let result = await coordinator.scan(
                        image: crop,
                        context: pocketContext,
                        source: .photoCapture
                    )
                    guard case .success(let scanResult) = result else {
                        return (
                            itemIndex,
                            PocketRecognition(identification: nil, diagnostics: pocketDiagnostics)
                        )
                    }
                    return (
                        itemIndex,
                        PocketRecognition(
                            identification: Identification(
                                primary: scanResult.primary,
                                alternatives: scanResult.alternatives
                            ),
                            diagnostics: pocketDiagnostics
                        )
                    )
                }
            }

            var nextIndex = initialCount

            while let (index, result) = await group.next() {
                if index < recognitions.count {
                    recognitions[index] = result
                }
                if nextIndex < workItems.count {
                    let item = workItems[nextIndex]
                    let itemIndex = item.index
                    let crop = item.crop
                    nextIndex += 1
                    group.addTask { [coordinator, context] in
                        var pocketContext = context
                        let pocketDiagnostics = context.diagnostics.map { _ in ScanDiagnostics() }
                        pocketContext.diagnostics = pocketDiagnostics
                        let result = await coordinator.scan(
                            image: crop,
                            context: pocketContext,
                            source: .photoCapture
                        )
                        guard case .success(let scanResult) = result else {
                            return (
                                itemIndex,
                                PocketRecognition(identification: nil, diagnostics: pocketDiagnostics)
                            )
                        }
                        return (
                            itemIndex,
                            PocketRecognition(
                                identification: Identification(
                                    primary: scanResult.primary,
                                    alternatives: scanResult.alternatives
                                ),
                                diagnostics: pocketDiagnostics
                            )
                        )
                    }
                }
            }
        }

        // Fit the page image to the detected cards: the capture often carries
        // extra surroundings (and, on device, everything visible on screen),
        // so the retained page tightens to the union of the card quads with a
        // small margin instead of showing cards cut off at the frame edge.
        var pageImage = image
        var pageFitRect: CGRect?
        if let candidate = Self.pageFitRect(
            for: workItems.map { BinderNormalizedQuad(observation: $0.observation) },
            protecting: protectedRect
        ), let cropped = Self.crop(image, toNormalizedRect: candidate) {
            pageImage = cropped
            pageFitRect = candidate
        }

        let detections = workItems.map { item -> BinderCardDetection in
            let baseQuad = BinderNormalizedQuad(observation: item.observation)
            let quad = pageFitRect.map { baseQuad.remapped(into: $0) } ?? baseQuad
            let recognition = recognitions[item.index]
            let result = recognition?.identification
            let detection: BinderCardDetection
            if let result {
                let status: BinderCardDetectionStatus = result.primary.confidence.score >= Configuration.matchedScore
                    ? .matched
                    : .uncertain
                detection = BinderCardDetection(
                    quad: quad,
                    crop: item.crop,
                    rectangleConfidence: item.observation.confidence,
                    selectedCandidate: result.primary,
                    candidateOptions: [result.primary] + result.alternatives,
                    status: status,
                    isIncluded: Self.shouldIncludeByDefault(status: status)
                )
            } else {
                detection = BinderCardDetection(
                    quad: quad,
                    crop: item.crop,
                    rectangleConfidence: item.observation.confidence,
                    selectedCandidate: nil,
                    candidateOptions: [],
                    status: .unmatched,
                    isIncluded: false
                )
            }

            if let pageDiagnostics = context.diagnostics,
               let pocketDiagnostics = recognition?.diagnostics {
                let pageQuad = [
                    quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft,
                ].map { [Double($0.x), Double($0.y)] }
                let captureQuality = ScannerCaptureQualityAnalyzer.analyze(image: item.crop)
                let metadata = ScanDiagnostics.BinderMetadata(
                    pocketIndex: item.index,
                    status: detection.status,
                    includedByDefault: detection.isIncluded,
                    policyReason: Self.binderPolicyReason(status: detection.status),
                    sourceCropPixelWidth: item.crop.width,
                    sourceCropPixelHeight: item.crop.height,
                    nativeCropPixelWidth: item.nativeCropPixelWidth,
                    nativeCropPixelHeight: item.nativeCropPixelHeight,
                    rotationDegreesApplied: item.rotationDegreesApplied,
                    captureQuality: captureQuality,
                    pageQuad: pageQuad
                )
                // Custom/test strategies may not emit diagnostics. Retain one
                // explicit summary in that case; production strategies keep
                // all of their real gate, shortlist, title, and footer data.
                if pocketDiagnostics.attempts.isEmpty {
                    let imageIndex = pocketDiagnostics.registerAttemptImage(item.crop)
                    pocketDiagnostics.record(ScanDiagnostics.Attempt(
                        kind: .detectedCrop,
                        quad: nil,
                        gateScore: nil,
                        gateThreshold: nil,
                        topCandidates: detection.candidateOptions.prefix(5).map {
                            ScanDiagnostics.Candidate(
                                cardID: $0.details.identity.id,
                                name: $0.details.identity.name,
                                similarity: $0.confidence.score
                            )
                        },
                        titleMatchedName: nil,
                        titlePrintingCount: nil,
                        footerPairNumbers: [],
                        ocrVerifiedCollectorNumber: nil,
                        outcome: detection.status == .matched ? .accepted :
                            (detection.status == .uncertain ? .printingAmbiguous : .noCandidates),
                        imageIndex: imageIndex
                    ))
                }
                pageDiagnostics.mergeBinderPocket(from: pocketDiagnostics, metadata: metadata)
            }
            return detection
        }

        return BinderPageScanResult(
            mode: context.mode,
            capturedImage: pageImage,
            detections: detections,
            elapsed: Date().timeIntervalSince(start)
        )
    }

    /// Union of every detected card corner, padded by `pageFitMargin` and
    /// clamped to the frame — in Vision-normalized coordinates. Nil when there
    /// is nothing to fit to, the fit is degenerate, or it would barely trim.
    ///
    /// `protecting` is the framing guide expressed in the scanned image's
    /// normalized space: the area the user deliberately declared as the page.
    /// The fit never trims inside it, because the union of DETECTED quads
    /// under-covers the physical page — the card detector does not fire on
    /// card backs (measured: 7 detections for 7 face-up cards and 0 for the
    /// two backs on the 223944 binder session's frame-0009), and any face
    /// card the detector misses would otherwise vanish from the retained
    /// page image with no visual trace.
    nonisolated static func pageFitRect(
        for quads: [BinderNormalizedQuad],
        protecting protectedRect: CGRect? = nil
    ) -> CGRect? {
        let points = quads.flatMap { [$0.topLeft, $0.topRight, $0.bottomLeft, $0.bottomRight] }
        guard !points.isEmpty else { return nil }

        let minX = points.map(\.x).min()!
        let maxX = points.map(\.x).max()!
        let minY = points.map(\.y).min()!
        let maxY = points.map(\.y).max()!

        var union = CGRect(x: minX, y: minY, width: maxX - minX, height: maxY - minY)
        if let protectedRect, !protectedRect.isNull, !protectedRect.isEmpty {
            union = union.union(protectedRect.standardized)
        }
        let rect = union
            .insetBy(dx: -Configuration.pageFitMargin, dy: -Configuration.pageFitMargin)
            .intersection(CGRect(x: 0, y: 0, width: 1, height: 1))
        guard !rect.isNull, rect.width > 0.05, rect.height > 0.05 else { return nil }
        guard rect.width < Configuration.pageFitMinimumTrim
            || rect.height < Configuration.pageFitMinimumTrim
        else { return nil }
        return rect
    }

    /// Crops using a Vision-normalized rect (origin bottom-left).
    nonisolated static func crop(_ image: CGImage, toNormalizedRect rect: CGRect) -> CGImage? {
        let width = CGFloat(image.width)
        let height = CGFloat(image.height)
        let pixelRect = CGRect(
            x: rect.minX * width,
            y: (1 - rect.maxY) * height,
            width: rect.width * width,
            height: rect.height * height
        ).integral
        guard pixelRect.width > 1, pixelRect.height > 1 else { return nil }
        return image.cropping(to: pixelRect)
    }

    /// Detector-first multi-card localization. The generic rectangle detector
    /// harvests attack text boxes, card backs behind pockets, and sleeve
    /// fabric on real binder photos (measured 52/77 detections retrieving
    /// nothing on the first device dev-mode binder session); the trained
    /// card detector finds the actual cards, and per-box corner refinement
    /// rectifies each one. The rectangle path remains as fallback when the
    /// detector asset is unavailable or fires on nothing.
    // Internal (not private) so the replay/fit experiment harnesses can score
    // localization and page-fit geometry without running recognition.
    func detectCardQuads(
        in image: CGImage,
        intrinsics: ScannerCameraIntrinsics? = nil
    ) throws -> [VNRectangleObservation] {
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
                    (
                        box,
                        cropper.refinedQuad(
                            in: image,
                            around: box,
                            intrinsics: intrinsics
                        )
                    )
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

    /// Only high-confidence matches are selected for the add batch initially.
    /// Uncertain suggestions remain attached to their detections so review can
    /// show the proposed identity and alternatives, but require an explicit
    /// user selection before import. Unmatched regions remain visible and
    /// excluded as well.
    nonisolated static func shouldIncludeByDefault(
        status: BinderCardDetectionStatus
    ) -> Bool {
        status == .matched
    }

    nonisolated static func binderPolicyReason(
        status: BinderCardDetectionStatus
    ) -> ScanDiagnostics.BinderPolicyReason {
        switch status {
        case .matched: return .matchedThreshold
        case .uncertain: return .uncertainReviewRequired
        case .unmatched: return .noCoordinatorMatch
        }
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
    ) -> NormalizedCrop? {
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

        let nativePixelWidth = Int(corrected.extent.width.rounded())
        let nativePixelHeight = Int(corrected.extent.height.rounded())

        let scaleX = Configuration.targetSize.width / corrected.extent.width
        let scaleY = Configuration.targetSize.height / corrected.extent.height
        corrected = corrected
            .transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))
            .cropped(to: CGRect(origin: .zero, size: Configuration.targetSize))
        // No color grade: these crops feed the same recognition strategies as
        // CardCropper output, and the reference indexes are built from
        // unmodified catalog images (parity — see docs/scanner-model-ai-handoff.md).

        guard let output = Self.ciContext.createCGImage(corrected, from: corrected.extent) else {
            return nil
        }
        return NormalizedCrop(
            image: output,
            nativePixelWidth: nativePixelWidth,
            nativePixelHeight: nativePixelHeight,
            rotationDegreesApplied: 0
        )
    }

    private func convert(_ point: CGPoint, in imageSize: CGSize) -> CGPoint {
        CGPoint(x: point.x * imageSize.width, y: point.y * imageSize.height)
    }
}

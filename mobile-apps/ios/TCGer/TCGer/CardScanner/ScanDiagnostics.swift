import CoreGraphics
import Foundation

/// Collects per-stage evidence while a scan runs, for dev-mode recording.
///
/// A scan's final result (or silent no-match) hides which stage decided it: a
/// bad crop and a bad retrieval look identical from the outside, and an
/// abstention never says whether the gate, a threshold, or the ambiguity
/// margin fired. When a collector is attached to `CardScannerContext`,
/// strategies append one entry per crop attempt with the evidence they
/// actually used, so a recorded scan can be re-diagnosed — or relabeled and
/// fed back into training — months later without re-running anything.
///
/// Reference-type on purpose: the context is a `Sendable` value passed down
/// through the strategy chain, and the collector must accumulate across it.
/// Access is serialized with a lock.
nonisolated final class ScanDiagnostics: @unchecked Sendable {
    struct Candidate: Codable, Sendable {
        let cardID: String
        let name: String
        let similarity: Double
    }

    enum AttemptKind: String, Codable, Sendable {
        /// Perspective-corrected crop of the detector/rectangle localization.
        case detectedCrop
        /// The full frame normalized like a crop (importedPhoto fallback).
        case wholeFrame
        /// Raw image embedded as-is because no candidate localization existed.
        case rawImage
        /// User-adjusted perspective crop retried after a failed or poor crop.
        case manualCrop
    }

    enum AttemptOutcome: String, Codable, Sendable {
        case accepted
        /// Open-set rejection: gate said non-card and OCR could not override.
        case rejectedInput
        case noCandidates
        case belowAcceptanceThreshold
        case printingAmbiguous
        case titlePrintingUnresolved
        case indexUnavailable
    }

    /// Semantic orientation is deliberately separate from pixel orientation.
    /// All scanner `CGImage` inputs are in an upright pixel coordinate space,
    /// but geometry alone cannot tell whether the printed card is upside down.
    enum SemanticOrientation: String, Codable, Sendable {
        case unverified
        case upright
        case upsideDown
        case sideways
    }

    enum BinderPolicyReason: String, Codable, Sendable {
        case matchedThreshold
        case uncertainOCRVerified
        case uncertainSeparatedCandidates
        case uncertainNearTieExcluded
        case uncertainReviewRequired
        case noCoordinatorMatch
    }

    struct BinderMetadata: Sendable {
        let pocketIndex: Int
        let status: BinderCardDetectionStatus
        let includedByDefault: Bool
        let policyReason: BinderPolicyReason
        let sourceCropPixelWidth: Int
        let sourceCropPixelHeight: Int
        let nativeCropPixelWidth: Int
        let nativeCropPixelHeight: Int
        let rotationDegreesApplied: Int
        let captureQuality: ScannerCaptureQualityReport?
        let pageQuad: [[Double]]
        /// Axis-aligned page-result crop in the scanner input's Vision space:
        /// `[minX, minY, width, height]`. Nil when no page fit was applied.
        let pageFitRect: [Double]?
    }

    struct Attempt: Codable, Sendable {
        let kind: AttemptKind
        /// Detected quad in normalized image coordinates (Vision space,
        /// origin bottom-left), when the attempt came from a localization.
        let quad: [[Double]]?
        let gateScore: Double?
        let gateThreshold: Double?
        let topCandidates: [Candidate]
        let titleMatchedName: String?
        let titlePrintingCount: Int?
        let footerPairNumbers: [String]
        let ocrVerifiedCollectorNumber: String?
        let outcome: AttemptOutcome
        /// Index into the recorded attempt images (`imageFile` naming is the
        /// recorder's concern; the collector only numbers them).
        let imageIndex: Int

        /// Binder-only correlation and final review-policy evidence. Optional
        /// so pre-schema recordings and single-card attempts decode unchanged.
        let pocketIndex: Int?
        let binderStatus: String?
        let binderIncludedByDefault: Bool?
        let binderPolicyReason: BinderPolicyReason?

        /// Pixel and semantic-orientation evidence for diagnosing resize and
        /// upside-down failures. `nativeCrop*` is the perspective-corrected
        /// binder crop before its 720x1000 recognition resize.
        let sourceCropPixelWidth: Int?
        let sourceCropPixelHeight: Int?
        let nativeCropPixelWidth: Int?
        let nativeCropPixelHeight: Int?
        let rotationDegreesApplied: Int?
        let semanticOrientation: SemanticOrientation?
        let captureQuality: ScannerCaptureQualityReport?
        /// Binder page-result crop in the original scanner input's Vision
        /// coordinate space. This lets review tools draw page and pocket
        /// geometry on the untouched photo without reconstructing the crop.
        let binderPageFitRect: [Double]?
        /// Binder attempts keep `quad` in page coordinates for compatibility;
        /// this preserves the coordinator's localization inside the pocket.
        let coordinatorQuad: [[Double]]?

        /// Per-stage wall time for this attempt, in milliseconds. Optional so
        /// pre-instrumentation recordings decode unchanged. `embedMs` covers
        /// the Core ML embedding (both preprocessing and inference), `annMs`
        /// every ANN query the attempt issued, and the OCR fields the
        /// `.accurate` Vision passes — the numbers that separate "the model
        /// is slow" from "OCR is slow" when a frame's total looks bad.
        let embedMs: Double?
        let annMs: Double?
        let titleOCRMs: Double?
        let footerOCRMs: Double?

        init(
            kind: AttemptKind,
            quad: [[Double]]?,
            gateScore: Double?,
            gateThreshold: Double?,
            topCandidates: [Candidate],
            titleMatchedName: String?,
            titlePrintingCount: Int?,
            footerPairNumbers: [String],
            ocrVerifiedCollectorNumber: String?,
            outcome: AttemptOutcome,
            imageIndex: Int,
            pocketIndex: Int? = nil,
            binderStatus: String? = nil,
            binderIncludedByDefault: Bool? = nil,
            binderPolicyReason: BinderPolicyReason? = nil,
            sourceCropPixelWidth: Int? = nil,
            sourceCropPixelHeight: Int? = nil,
            nativeCropPixelWidth: Int? = nil,
            nativeCropPixelHeight: Int? = nil,
            rotationDegreesApplied: Int? = nil,
            semanticOrientation: SemanticOrientation? = nil,
            captureQuality: ScannerCaptureQualityReport? = nil,
            binderPageFitRect: [Double]? = nil,
            coordinatorQuad: [[Double]]? = nil,
            embedMs: Double? = nil,
            annMs: Double? = nil,
            titleOCRMs: Double? = nil,
            footerOCRMs: Double? = nil
        ) {
            self.kind = kind
            self.quad = quad
            self.gateScore = gateScore
            self.gateThreshold = gateThreshold
            self.topCandidates = topCandidates
            self.titleMatchedName = titleMatchedName
            self.titlePrintingCount = titlePrintingCount
            self.footerPairNumbers = footerPairNumbers
            self.ocrVerifiedCollectorNumber = ocrVerifiedCollectorNumber
            self.outcome = outcome
            self.imageIndex = imageIndex
            self.pocketIndex = pocketIndex
            self.binderStatus = binderStatus
            self.binderIncludedByDefault = binderIncludedByDefault
            self.binderPolicyReason = binderPolicyReason
            self.sourceCropPixelWidth = sourceCropPixelWidth
            self.sourceCropPixelHeight = sourceCropPixelHeight
            self.nativeCropPixelWidth = nativeCropPixelWidth
            self.nativeCropPixelHeight = nativeCropPixelHeight
            self.rotationDegreesApplied = rotationDegreesApplied
            self.semanticOrientation = semanticOrientation
            self.captureQuality = captureQuality
            self.binderPageFitRect = binderPageFitRect
            self.coordinatorQuad = coordinatorQuad
            self.embedMs = embedMs
            self.annMs = annMs
            self.titleOCRMs = titleOCRMs
            self.footerOCRMs = footerOCRMs
        }

        func taggedForBinder(_ metadata: BinderMetadata, imageIndex: Int) -> Attempt {
            Attempt(
                kind: kind,
                quad: metadata.pageQuad,
                gateScore: gateScore,
                gateThreshold: gateThreshold,
                topCandidates: topCandidates,
                titleMatchedName: titleMatchedName,
                titlePrintingCount: titlePrintingCount,
                footerPairNumbers: footerPairNumbers,
                ocrVerifiedCollectorNumber: ocrVerifiedCollectorNumber,
                outcome: outcome,
                imageIndex: imageIndex,
                pocketIndex: metadata.pocketIndex,
                binderStatus: metadata.status.rawValue,
                binderIncludedByDefault: metadata.includedByDefault,
                binderPolicyReason: metadata.policyReason,
                sourceCropPixelWidth: metadata.sourceCropPixelWidth,
                sourceCropPixelHeight: metadata.sourceCropPixelHeight,
                nativeCropPixelWidth: metadata.nativeCropPixelWidth,
                nativeCropPixelHeight: metadata.nativeCropPixelHeight,
                rotationDegreesApplied: metadata.rotationDegreesApplied,
                semanticOrientation: .unverified,
                captureQuality: metadata.captureQuality,
                binderPageFitRect: metadata.pageFitRect,
                coordinatorQuad: quad,
                embedMs: embedMs,
                annMs: annMs,
                titleOCRMs: titleOCRMs,
                footerOCRMs: footerOCRMs
            )
        }
    }

    private let lock = NSLock()
    private var storedAttempts: [Attempt] = []
    private var storedImages: [CGImage] = []
    private var storedStageTimings: [String: Double] = [:]

    /// Accumulates frame-level stage time (e.g. "detect" for the rectangle /
    /// document-segmentation pass that runs once per frame, before any
    /// attempt exists to hang a number on). Repeated calls sum, so binder
    /// pocket merges and multi-pass frames report totals.
    func addStageTime(_ stage: String, milliseconds: Double) {
        lock.lock()
        defer { lock.unlock() }
        storedStageTimings[stage, default: 0] += milliseconds
    }

    var stageTimings: [String: Double] {
        lock.lock()
        defer { lock.unlock() }
        return storedStageTimings
    }

    /// Registers the attempt's input image and returns the index to reference
    /// from the `Attempt` entry recorded after the outcome is known.
    func registerAttemptImage(_ image: CGImage) -> Int {
        lock.lock()
        defer { lock.unlock() }
        storedImages.append(image)
        return storedImages.count - 1
    }

    func record(_ attempt: Attempt) {
        lock.lock()
        defer { lock.unlock() }
        storedAttempts.append(attempt)
    }

    /// Merges one pocket's isolated coordinator collector into the page
    /// collector while remapping its image indices. Pocket collectors avoid
    /// interleaving evidence when binder recognitions run concurrently.
    func mergeBinderPocket(from pocket: ScanDiagnostics, metadata: BinderMetadata) {
        let snapshot = pocket.snapshot()
        lock.lock()
        defer { lock.unlock() }
        for (stage, milliseconds) in snapshot.stageTimings {
            storedStageTimings[stage, default: 0] += milliseconds
        }
        let imageOffset = storedImages.count
        storedImages.append(contentsOf: snapshot.images)
        storedAttempts.append(contentsOf: snapshot.attempts.map { attempt in
            let remappedIndex = attempt.imageIndex >= 0 && attempt.imageIndex < snapshot.images.count
                ? imageOffset + attempt.imageIndex
                : -1
            return attempt.taggedForBinder(metadata, imageIndex: remappedIndex)
        })
    }

    private func snapshot() -> (
        attempts: [Attempt],
        images: [CGImage],
        stageTimings: [String: Double]
    ) {
        lock.lock()
        defer { lock.unlock() }
        return (storedAttempts, storedImages, storedStageTimings)
    }

    var attempts: [Attempt] {
        lock.lock()
        defer { lock.unlock() }
        return storedAttempts
    }

    var attemptImages: [CGImage] {
        lock.lock()
        defer { lock.unlock() }
        return storedImages
    }
}

/// The per-frame evidence document persisted next to `results.json`. Keyed by
/// the frame's image file name so entries stay joined to the schema the
/// replay/browser tools already read, without touching that schema.
nonisolated struct ScanEvidenceRecord: Codable {
    let imageFile: String
    /// The unprocessed sensor photo for camera captures, saved alongside the
    /// guide-cropped pipeline input so the guide-cropping stage itself stays
    /// inspectable. Nil for imports/live frames, where `imageFile` already is
    /// the original.
    let originalImageFile: String?
    let source: String
    let mode: String
    let elapsedMs: Double
    let outcome: String
    let attempts: [ScanDiagnostics.Attempt]
    let attemptImageFiles: [String]
    /// Objective capture conditions measured before recognition. Optional so
    /// recordings made before this sidecar field remain replay-compatible.
    let captureQuality: ScannerCaptureQualityReport?
    /// Human review applied to one binder detection after the page scan.
    /// Kept separate from `expectedNoMatch`: a back card is valid card input,
    /// but it does not belong to the currently reviewed binder page.
    let binderExclusion: BinderDetectionExclusionEvidence?
    /// Pixel dimensions and orientation contract for the saved page/frame.
    /// Optional for backward compatibility with older exports.
    let imageMetadata: ScanImageMetadata?
    let originalImageMetadata: ScanImageMetadata?
    /// Frame-level stage totals in milliseconds (e.g. "detect"). Attempts
    /// carry their own per-stage fields; this holds the once-per-frame work.
    /// Optional so pre-instrumentation recordings decode unchanged.
    let stageTimingsMs: [String: Double]?
}

nonisolated struct ScanImageMetadata: Codable, Equatable, Sendable {
    let pixelWidth: Int
    let pixelHeight: Int
    /// `CGImage` has no EXIF orientation. Scanner inputs are decoded with the
    /// Image I/O transform baked into their pixels and are then treated as up.
    let pixelOrientation: String
    /// Content orientation remains unknown until a semantic verifier exists.
    let semanticOrientation: ScanDiagnostics.SemanticOrientation
}

nonisolated struct BinderDetectionExclusionEvidence: Codable, Equatable {
    let reason: BinderCardExclusionReason
    let pageNumber: Int
    let detectionIndex: Int
    let predictedCardID: String?
    let predictedCardName: String?
}

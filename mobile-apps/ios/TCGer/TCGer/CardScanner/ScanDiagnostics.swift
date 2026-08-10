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
    struct Candidate: Codable {
        let cardID: String
        let name: String
        let similarity: Double
    }

    enum AttemptKind: String, Codable {
        /// Perspective-corrected crop of the detector/rectangle localization.
        case detectedCrop
        /// The full frame normalized like a crop (importedPhoto fallback).
        case wholeFrame
        /// Raw image embedded as-is because no candidate localization existed.
        case rawImage
    }

    enum AttemptOutcome: String, Codable {
        case accepted
        /// Open-set rejection: gate said non-card and OCR could not override.
        case rejectedInput
        case noCandidates
        case belowAcceptanceThreshold
        case printingAmbiguous
        case titlePrintingUnresolved
        case indexUnavailable
    }

    struct Attempt: Codable {
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
    }

    private let lock = NSLock()
    private var storedAttempts: [Attempt] = []
    private var storedImages: [CGImage] = []

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
    /// Human review applied to one binder detection after the page scan.
    /// Kept separate from `expectedNoMatch`: a back card is valid card input,
    /// but it does not belong to the currently reviewed binder page.
    let binderExclusion: BinderDetectionExclusionEvidence?
}

nonisolated struct BinderDetectionExclusionEvidence: Codable, Equatable {
    let reason: BinderCardExclusionReason
    let pageNumber: Int
    let detectionIndex: Int
    let predictedCardID: String?
    let predictedCardName: String?
}

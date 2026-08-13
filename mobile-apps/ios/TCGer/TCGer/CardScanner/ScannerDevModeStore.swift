import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Main-actor UI models are flattened before crossing into the recording
/// actor so manual labels remain Swift-concurrency safe.
nonisolated struct ScannerManualCorrection: Sendable {
    let previousCardId: String?
    let previousCardName: String?
    let previousSetCode: String?
    let previousSetName: String?
    let previousConfidence: Double?
    let previousStrategy: String?
    let correctedCardId: String?
}

nonisolated struct ScannerBinderDetectionExclusion: Sendable {
    let reason: BinderCardExclusionReason
    let pageNumber: Int
    let detectionIndex: Int
    let predictedCardId: String?
    let predictedCardName: String?
    let predictedSetCode: String?
    let predictedSetName: String?
    let predictedConfidence: Double?
    let predictedStrategy: String?
}

/// Dev-mode scan recorder: when enabled, every scan that goes through the
/// production coordinator — live frames, shutter captures, photo imports —
/// is persisted with its raw input image, every crop attempt, and the
/// per-stage evidence collected by `ScanDiagnostics`.
///
/// Sessions are written in the device-recording shape (`results.json` +
/// frame JPEGs) that the reference browser, `CardScannerReplayRunner`, and
/// `scripts/export_scanner_recording_labels.py` already consume, so a
/// recorded session can be browsed, replayed against a future model build,
/// labeled, and converted into training data with the existing tools. The
/// richer per-attempt evidence lives in a sidecar `evidence.json` keyed by
/// frame image file, leaving the shared schema untouched.
///
/// `results.json`/`evidence.json` are rewritten atomically after every scan,
/// so a crash never loses the session recorded so far.
actor ScannerDevModeStore {
    static let shared = ScannerDevModeStore()

    static let enabledDefaultsKey = "scannerDevModeEnabled"

    /// Cheap main-thread check used by callers to avoid any recording work
    /// (including JPEG encoding) when dev mode is off.
    nonisolated static var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: enabledDefaultsKey)
    }

    nonisolated static func setEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: enabledDefaultsKey)
    }

    struct SessionInfo: Identifiable, Sendable {
        let url: URL
        let frameCount: Int
        let sizeBytes: Int64
        var id: String { url.lastPathComponent }
    }

    enum SessionDeletionError: LocalizedError {
        case invalidLocation

        var errorDescription: String? {
            switch self {
            case .invalidLocation:
                return "The selected recording is outside the recordings folder."
            }
        }
    }

    private enum Limits {
        /// Matches the live-debug recorder's cap so one session cannot fill
        /// the disk; oldest frames are dropped first.
        static let maxFramesPerSession = 400
        /// Across all dev-mode sessions; oldest whole sessions are pruned.
        static let maxTotalBytes: Int64 = 1_500_000_000
        static let jpegQuality: Double = 0.85
    }

    private var sessionDirectory: URL?
    private var frames: [RecordedScanFrame] = []
    private var evidence: [ScanEvidenceRecord] = []
    private var sessionStart = Date()
    private var frameIndex = 0
    private var sessionMode = "pokemon"

    static func rootDirectory() -> URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ScannerDevMode", isDirectory: true)
    }

    // MARK: Recording

    @discardableResult
    func record(
        image: CGImage,
        source: ScanInvocationKind,
        mode: ScanMode,
        elapsedMs: Double,
        result: Result<CardScanResult, CardScannerError>?,
        diagnostics: ScanDiagnostics?,
        originalImage: CGImage? = nil,
        outcomeLabel: String? = nil,
        expectedCardId: String? = nil,
        expectedNoMatch: Bool? = nil,
        manualCorrection: ScannerManualCorrection? = nil,
        binderExclusion: ScannerBinderDetectionExclusion? = nil,
        captureQuality: ScannerCaptureQualityReport? = nil
    ) -> Bool {
        guard Self.isEnabled else { return false }
        let directory: URL
        do {
            directory = try ensureSession(mode: mode)
        } catch {
            return false
        }

        let index = frameIndex
        frameIndex += 1
        let imageFile = String(format: "frame-%04d.jpg", index)
        guard write(image: image, to: directory.appendingPathComponent(imageFile)) else { return false }

        var originalFile: String?
        if let originalImage {
            let name = String(format: "frame-%04d-original.jpg", index)
            if write(image: originalImage, to: directory.appendingPathComponent(name)) {
                originalFile = name
            }
        }

        let attempts = diagnostics?.attempts ?? []
        let attemptImages = diagnostics?.attemptImages ?? []
        var attemptFiles: [String] = []
        for (offset, attemptImage) in attemptImages.enumerated() {
            let name = String(format: "frame-%04d-attempt-%d.jpg", index, offset)
            if write(image: attemptImage, to: directory.appendingPathComponent(name)) {
                attemptFiles.append(name)
            }
        }

        var identified = false
        var name: String?
        var cardID: String?
        var setCode: String?
        var setName: String?
        var confidence: Double?
        var strategy: String?
        var alternatives: [String] = []
        var alternativeIDs: [String] = []
        var outcome = "noResult"
        switch result {
        case .success(let scan):
            identified = true
            outcome = "accepted"
            name = scan.primary.details.identity.name
            cardID = scan.primary.details.identity.id
            setCode = scan.primary.details.identity.setCode
            setName = scan.primary.details.identity.setName
            confidence = scan.primary.confidence.score
            strategy = scan.primary.originatingStrategy.displayName
            alternatives = scan.alternatives.prefix(5).map { $0.details.identity.name }
            alternativeIDs = scan.alternatives.prefix(5).map { $0.details.identity.id }
        case .failure(let failure):
            outcome = String(describing: failure)
        case nil:
            break
        }
        if let manualCorrection {
            identified = manualCorrection.previousCardId != nil
            name = manualCorrection.previousCardName
            cardID = manualCorrection.previousCardId
            setCode = manualCorrection.previousSetCode
            setName = manualCorrection.previousSetName
            confidence = manualCorrection.previousConfidence
            strategy = manualCorrection.previousStrategy
        }
        if let binderExclusion {
            identified = binderExclusion.predictedCardId != nil
            name = binderExclusion.predictedCardName
            cardID = binderExclusion.predictedCardId
            setCode = binderExclusion.predictedSetCode
            setName = binderExclusion.predictedSetName
            confidence = binderExclusion.predictedConfidence
            strategy = binderExclusion.predictedStrategy
        }
        if let outcomeLabel {
            outcome = outcomeLabel
        }

        // Prefer the accepted attempt's localization; otherwise the first
        // attempt that had one, so the browser can always draw the crop.
        let quad = attempts.first { $0.outcome == .accepted }?.quad
            ?? attempts.first { $0.quad != nil }?.quad

        frames.append(RecordedScanFrame(
            index: index,
            timestampSeconds: Date().timeIntervalSince(sessionStart),
            mode: mode.rawValue,
            pipeline: "dev-mode \(sourceLabel(source))",
            elapsedMs: elapsedMs,
            detectedCount: manualCorrection == nil && binderExclusion == nil ? attempts.count : 1,
            segmentationConfidence: nil,
            quad: quad,
            identified: identified,
            bestMatchName: name,
            bestMatchCardId: cardID,
            bestMatchSetCode: setCode,
            bestMatchSetName: setName,
            confidence: confidence,
            strategy: strategy,
            alternatives: alternatives,
            alternativeCardIds: alternativeIDs,
            expectedCardId: expectedCardId,
            expectedNoMatch: expectedNoMatch,
            imageFile: imageFile
        ))
        evidence.append(ScanEvidenceRecord(
            imageFile: imageFile,
            originalImageFile: originalFile,
            source: sourceLabel(source),
            mode: mode.rawValue,
            elapsedMs: elapsedMs,
            outcome: outcome,
            attempts: attempts,
            attemptImageFiles: attemptFiles,
            captureQuality: captureQuality,
            binderExclusion: binderExclusion.map {
                BinderDetectionExclusionEvidence(
                    reason: $0.reason,
                    pageNumber: $0.pageNumber,
                    detectionIndex: $0.detectionIndex,
                    predictedCardID: $0.predictedCardId,
                    predictedCardName: $0.predictedCardName
                )
            }
        ))

        trimSessionIfNeeded(directory: directory)
        persistManifests(to: directory)
        return true
    }

    /// Persists a human-reviewed binder crop as labeled training data while
    /// retaining the scanner's previous choice as the regression baseline.
    /// A nil corrected card is an explicit human-reviewed no-match label.
    @discardableResult
    func recordManualCorrection(
        image: CGImage,
        mode: ScanMode,
        correction: ScannerManualCorrection
    ) -> Bool {
        guard Self.isEnabled else { return false }
        let outcomeLabel = correction.correctedCardId.map {
            "manualCorrection: \($0)"
        } ?? "manualCorrection: no match"

        return record(
            image: image,
            source: .photoCapture,
            mode: mode,
            elapsedMs: 0,
            result: nil,
            diagnostics: nil,
            outcomeLabel: outcomeLabel,
            expectedCardId: correction.correctedCardId,
            expectedNoMatch: correction.correctedCardId == nil,
            manualCorrection: correction
        )
    }

    /// Records why a human excluded one localized region from a binder page.
    /// Only `notACard` is emitted as open-set no-match ground truth; a visible
    /// card from the page behind is still valid card imagery.
    @discardableResult
    func recordBinderDetectionExclusion(
        image: CGImage,
        mode: ScanMode,
        exclusion: ScannerBinderDetectionExclusion
    ) -> Bool {
        guard Self.isEnabled else { return false }
        return record(
            image: image,
            source: .photoCapture,
            mode: mode,
            elapsedMs: 0,
            result: nil,
            diagnostics: nil,
            outcomeLabel: "binderExclusion: \(exclusion.reason.rawValue)",
            expectedNoMatch: exclusion.reason == .notACard ? true : nil,
            binderExclusion: exclusion
        )
    }

    // MARK: Sessions

    nonisolated static func listSessions() -> [SessionInfo] {
        let root = rootDirectory()
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        return contents
            .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
            .map { url in
                SessionInfo(
                    url: url,
                    frameCount: frameCount(in: url),
                    sizeBytes: directorySize(url)
                )
            }
            .sorted { $0.url.lastPathComponent > $1.url.lastPathComponent }
    }

    nonisolated static func deleteSession(at url: URL) throws {
        let root = rootDirectory().standardizedFileURL
        let session = url.standardizedFileURL
        guard session.deletingLastPathComponent() == root else {
            throw SessionDeletionError.invalidLocation
        }
        try FileManager.default.removeItem(at: session)
    }

    nonisolated static func deleteAllSessions() throws {
        for session in listSessions() {
            try deleteSession(at: session.url)
        }
    }

    // MARK: Internals

    private func ensureSession(mode: ScanMode) throws -> URL {
        if let sessionDirectory,
           FileManager.default.fileExists(atPath: sessionDirectory.path) {
            return sessionDirectory
        }
        // Either the first scan this launch, or the active session folder was
        // deleted underneath us (session row deleted in the UI, tests cleaning
        // up). Drop the in-memory tail and start a fresh session rather than
        // silently failing every subsequent write.
        sessionDirectory = nil
        frames.removeAll()
        evidence.removeAll()
        frameIndex = 0
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        formatter.locale = Locale(identifier: "en_US_POSIX")
        sessionStart = Date()
        sessionMode = mode.rawValue
        let directory = Self.rootDirectory()
            .appendingPathComponent("scan-session-\(formatter.string(from: sessionStart))", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        sessionDirectory = directory
        pruneOldSessions(keeping: directory)
        return directory
    }

    private func persistManifests(to directory: URL) {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let bundle = RecordedScanBundle(
            summary: RecordedScanBundle.Summary(
                capturedAt: ISO8601DateFormatter().string(from: sessionStart),
                frameCount: frames.count,
                mode: sessionMode,
                pipeline: "dev-mode full pipeline",
                app: "TCGer iOS Scanner Dev Mode"
            ),
            frames: frames
        )
        if let data = try? encoder.encode(bundle) {
            try? data.write(to: directory.appendingPathComponent("results.json"), options: .atomic)
        }
        if let data = try? encoder.encode(evidence) {
            try? data.write(to: directory.appendingPathComponent("evidence.json"), options: .atomic)
        }
    }

    private func trimSessionIfNeeded(directory: URL) {
        while frames.count > Limits.maxFramesPerSession {
            let dropped = frames.removeFirst()
            let droppedEvidence = evidence.removeFirst()
            try? FileManager.default.removeItem(
                at: directory.appendingPathComponent(dropped.imageFile)
            )
            if let original = droppedEvidence.originalImageFile {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent(original))
            }
            for file in droppedEvidence.attemptImageFiles {
                try? FileManager.default.removeItem(at: directory.appendingPathComponent(file))
            }
        }
    }

    private func pruneOldSessions(keeping current: URL) {
        var sessions = Self.listSessions().filter { $0.url != current }
        var total = sessions.reduce(Int64(0)) { $0 + $1.sizeBytes }
        // Oldest first (list is newest-first by name).
        while total > Limits.maxTotalBytes, let oldest = sessions.last {
            try? Self.deleteSession(at: oldest.url)
            total -= oldest.sizeBytes
            sessions.removeLast()
        }
    }

    private func sourceLabel(_ source: ScanInvocationKind) -> String {
        switch source {
        case .livePreview: return "livePreview"
        case .photoCapture: return "photoCapture"
        case .importedPhoto: return "importedPhoto"
        }
    }

    private func write(image: CGImage, to url: URL) -> Bool {
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else { return false }
        CGImageDestinationAddImage(destination, image, [
            kCGImageDestinationLossyCompressionQuality: Limits.jpegQuality,
        ] as CFDictionary)
        return CGImageDestinationFinalize(destination)
    }

    private nonisolated static func frameCount(in url: URL) -> Int {
        guard let data = try? Data(contentsOf: url.appendingPathComponent("results.json")),
              let bundle = try? JSONDecoder().decode(RecordedScanBundle.self, from: data)
        else { return 0 }
        return bundle.frames.count
    }

    private nonisolated static func directorySize(_ url: URL) -> Int64 {
        let files = FileManager.default.enumerator(
            at: url,
            includingPropertiesForKeys: [.fileSizeKey]
        )?.allObjects as? [URL] ?? []
        return files.reduce(Int64(0)) { total, file in
            total + Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
        }
    }
}

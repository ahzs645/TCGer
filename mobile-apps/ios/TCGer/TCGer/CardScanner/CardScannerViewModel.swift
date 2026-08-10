import AVFoundation
import Combine
import Foundation
import ImageIO
import SwiftUI
import VideoToolbox

@MainActor
final class CardScannerViewModel: ObservableObject {
    enum BinderDestinationMode: String, CaseIterable, Identifiable {
        case oneBinder
        case pageByPage

        var id: Self { self }

        var displayName: String {
            switch self {
            case .oneBinder: return "One Binder"
            case .pageByPage: return "Page by Page"
            }
        }
    }

    enum ViewState {
        case idle
        case ready
        case processing
        case result(CardScanResult)
        case error(String)
        case unauthorized
    }

    @Published var state: ViewState = .idle
    @Published var selectedMode: ScanMode = .pokemon {
        didSet {
            normalizeSelectedEngine()
            rebuildContext()
        }
    }
    @Published var selectedEngine: ScanEnginePreference = .automatic {
        didSet {
            normalizeSelectedEngine()
            rebuildContext()
        }
    }
    @Published var captureMode: ScannerCaptureMode = .card {
        didSet {
            lastAnalysisDate = .distantPast
            liveConsensus.reset()
            resetLiveConfirmation()
        }
    }
    @Published var triggerMode: ScannerTriggerMode = .manual {
        didSet {
            lastAnalysisDate = .distantPast
            liveConsensus.reset()
            resetLiveConfirmation()
        }
    }
    @Published var latestResult: CardScanResult?
    @Published var binderPages: [BinderPageRecord] = []
    @Published var binderReviewPresentation: BinderReviewPresentation?
    @Published var selectedBinderID: String?
    @Published var binderDestinationMode: BinderDestinationMode = .oneBinder
    @Published private(set) var binderPageDestinationIDs: [Int: String] = [:]
    @Published var errorMessage: String?
    @Published var isProcessingPhoto = false
    @Published var isAnalyzingFrame = false
    @Published private(set) var sessionResults: [CardScanResult] = []
    @Published private(set) var addedSessionResultIDs: Set<CardScanResult.ID> = []
    @Published private(set) var liveCandidateName: String?
    @Published private(set) var liveConfirmationCount = 0
    @Published private(set) var liveConfirmationRequired = 2
    @Published private(set) var nextBinderPageNumber = 1
    // Off by default: debug captures upload the scan image + crops for training.
    // Opt-in via the testing tools rather than silently shipping every scan.
    @Published var saveDebugCapture = false {
        didSet { rebuildContext() }
    }
    @Published var captureNotes = "" {
        didSet { rebuildContext() }
    }
    private(set) var scanScope: CardScanScope?

    let cameraController = CardScannerCameraController()
    private let coordinator: CardScannerCoordinator
    private let binderPageScanner: BinderPageScanner
    private var environmentStore: EnvironmentStore?
    private var context: CardScannerContext?
    private let isSimulator: Bool
    private var lastAnalysisDate: Date = .distantPast
    private let analysisInterval: TimeInterval = 1.0
    private var previewFrame: CGRect?
    private var guideFrame: CGRect?
    private var liveConsensus = LiveScanConsensus()
    private var automaticallyPresentsResults = false
    private var isPhotoImportActive = false

    var binderPagesScanned: Int { binderPages.count }

    var binderCardsScanned: Int {
        binderPages.reduce(0) { $0 + $1.detections.count }
    }

    var binderCardsSelected: Int {
        binderPages.reduce(0) { count, page in
            count + page.detections.filter { $0.isIncluded && $0.selectedCandidate != nil }.count
        }
    }

    var binderCardsAdded: Int {
        binderPages.reduce(0) { $0 + $1.addedDetectionIDs.count }
    }

    init(coordinator: CardScannerCoordinator? = nil) {
#if targetEnvironment(simulator)
        isSimulator = true
#else
        isSimulator = false
#endif
        let resolvedCoordinator = coordinator ?? CardScannerCoordinator.makeDefault()
        self.coordinator = resolvedCoordinator
        self.binderPageScanner = BinderPageScanner(coordinator: resolvedCoordinator)
        cameraController.onPhotoCapture = { [weak self] photo in
            Task { await self?.handleCapturedPhoto(photo) }
        }
        cameraController.onPhotoCaptureError = { [weak self] error in
            Task { await self?.handleCaptureFailure(error) }
        }
        cameraController.onSampleBuffer = { [weak self] sampleBuffer in
            guard let self else { return }
            Task {
                await self.handleSampleBuffer(sampleBuffer)
            }
        }
        cameraController.onPreviewFrameChange = { [weak self] frame in
            Task { @MainActor in
                self?.previewFrame = frame
            }
        }
    }

    func updateGuideFrame(_ frame: CGRect) {
        guideFrame = frame
    }

    func setAutomaticallyPresentsResults(_ enabled: Bool) {
        automaticallyPresentsResults = enabled
    }

    func setPhotoImportActive(_ active: Bool) {
        isPhotoImportActive = active
    }

    func updateEnvironment(_ environment: EnvironmentStore) {
        environmentStore = environment
        // Recognition routing is an implementation detail for regular scans:
        // stay fully on-device in phone-only mode, otherwise use the local-first
        // automatic chain. Developer tools can still override this afterward.
        selectedEngine = environment.serverConfiguration.isOnDevice ? .localOnly : .automatic
        rebuildContext()
        prepareCameraIfPossible()
    }

    func updateScope(_ scope: CardScanScope?) {
        scanScope = scope
        if let mode = scope?.scanMode {
            selectedMode = mode
        }
        rebuildContext()
    }

    func prepareCameraIfPossible() {
        if isSimulator {
            state = .error("Card scanning requires a device with a camera. Please run TCGer on real hardware.")
            return
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            cameraController.configureIfNeeded()
            cameraController.startRunning()
            state = .ready
        case .notDetermined:
            requestCameraPermission()
        case .denied, .restricted:
            state = .unauthorized
        @unknown default:
            state = .unauthorized
        }
    }

    func requestCameraPermission() {
        if isSimulator {
            state = .error("Card scanning requires a device with a camera. Please run TCGer on real hardware.")
            return
        }

        AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
            DispatchQueue.main.async {
                guard let self else { return }
                if granted {
                    self.cameraController.configureIfNeeded()
                    self.cameraController.startRunning()
                    self.state = .ready
                } else {
                    self.state = .unauthorized
                }
            }
        }
    }

    func capturePhoto() {
        if isSimulator {
            state = .error("Card scanning is not supported in the iOS Simulator.")
            return
        }

        guard case .ready = state else { return }
        guard captureMode == .binder || triggerMode == .manual else { return }
        guard isModeSupported(selectedMode) else {
            var message = "\(selectedMode.displayName) scanning is not available yet."
            if let hint = ScannerAssetDiagnostics.missingAssetHint(for: selectedMode) {
                message = hint
            }
            state = .error(message)
            return
        }
        // Local mode needs no auth token; only require it when a backend is in use.
        if context?.serverConfiguration.isOnDevice != true, context?.authToken == nil {
            state = .error(CardScannerError.missingAuthToken.errorDescription ?? "Not authenticated")
            return
        }

        guard cameraController.canCapturePhoto() else {
            state = .error("Camera is not ready yet. Please try again in a moment.")
            return
        }

        isProcessingPhoto = true
        state = .processing
        cameraController.capturePhoto()
    }

    /// Runs the production recognition pipeline on an already-decoded image.
    /// This is deliberately camera-independent so Simulator, fixtures, and
    /// imported recordings exercise the same coordinator as a real capture.
    /// The default source is `.importedPhoto` because every caller except the
    /// camera shutter supplies an image that never saw the guide crop; the
    /// shutter path passes `.photoCapture` explicitly.
    func scan(
        image: CGImage,
        source: ScanInvocationKind = .importedPhoto,
        originalImage: CGImage? = nil
    ) async {
        guard let context else {
            state = .error("Scanner context unavailable.")
            return
        }
        if !context.serverConfiguration.isOnDevice, context.authToken == nil {
            state = .error(CardScannerError.missingAuthToken.errorDescription ?? "Not authenticated")
            return
        }

        isProcessingPhoto = true
        state = .processing
        defer { isProcessingPhoto = false }

        var scanContext = context
        let diagnostics = ScannerDevModeStore.isEnabled ? ScanDiagnostics() : nil
        scanContext.diagnostics = diagnostics
        let started = Date()
        let result = await coordinator.scan(image: image, context: scanContext, source: source)
        if diagnostics != nil {
            let elapsedMs = Date().timeIntervalSince(started) * 1_000
            let mode = scanContext.mode
            Task.detached(priority: .utility) {
                await ScannerDevModeStore.shared.record(
                    image: image,
                    source: source,
                    mode: mode,
                    elapsedMs: elapsedMs,
                    result: result,
                    diagnostics: diagnostics,
                    originalImage: originalImage
                )
            }
        }
        apply(result)
    }

    func scan(
        imageData: Data,
        source: ScanInvocationKind = .importedPhoto,
        presentsBinderReview: Bool = true
    ) async {
        guard let image = Self.makeCGImage(from: imageData) else {
            state = .error("Unable to decode the selected scanner image.")
            return
        }
        if captureMode == .binder {
            await scanBinderPage(image: image, presentsReview: presentsBinderReview)
        } else {
            await scan(image: image, source: source)
        }
    }

    func scanCurrentCaptureMode(image: CGImage) async {
        if captureMode == .binder {
            await scanBinderPage(image: image)
        } else {
            await scan(image: image)
        }
    }

    func scanBinderPage(
        image: CGImage,
        presentsReview: Bool = true,
        source: ScanInvocationKind = .importedPhoto,
        originalImage: CGImage? = nil
    ) async {
        guard let context else {
            state = .error("Scanner context unavailable.")
            return
        }
        if !context.serverConfiguration.isOnDevice, context.authToken == nil {
            state = .error(CardScannerError.missingAuthToken.errorDescription ?? "Not authenticated")
            return
        }

        isProcessingPhoto = true
        state = .processing
        defer { isProcessingPhoto = false }

        do {
            let result = try await binderPageScanner.scan(image: image, context: context)
            recordBinderPageForDevMode(
                page: image,
                original: originalImage,
                result: result,
                error: nil,
                source: source,
                mode: context.mode
            )
            let scannedPageNumber = nextBinderPageNumber
            let record = BinderPageRecord(result: result, pageNumber: scannedPageNumber)
            if let existingIndex = binderPages.firstIndex(where: { $0.pageNumber == scannedPageNumber }) {
                binderPages[existingIndex] = record
            } else {
                binderPages.append(record)
                binderPages.sort { $0.pageNumber < $1.pageNumber }
            }
            nextBinderPageNumber = max(
                scannedPageNumber + 1,
                (binderPages.map(\.pageNumber).max() ?? 0) + 1
            )
            if binderPages.count > 30 {
                // Full-resolution captures are session-only; bound retained memory by
                // dropping the oldest page after 30 scans.
                binderPages.removeFirst(binderPages.count - 30)
            }
            if presentsReview {
                binderReviewPresentation = BinderReviewPresentation(
                    initialPageIndex: binderPages.firstIndex(where: { $0.pageNumber == scannedPageNumber }) ?? 0
                )
            }
            state = .ready
            if !isSimulator { HapticManager.notification(.success) }
        } catch {
            recordBinderPageForDevMode(
                page: image,
                original: originalImage,
                result: nil,
                error: error,
                source: source,
                mode: context.mode
            )
            errorMessage = error.localizedDescription
            state = .ready
            if !isSimulator { HapticManager.notification(.error) }
        }
    }

    /// Dev-mode capture of a binder page: the raw page image plus one
    /// evidence attempt per detected card — its quad, crop image, and
    /// candidate list — so binder pages are full multi-card training data,
    /// not just an unlabeled photo.
    private func recordBinderPageForDevMode(
        page: CGImage,
        original: CGImage?,
        result: BinderPageScanResult?,
        error: Error?,
        source: ScanInvocationKind,
        mode: ScanMode
    ) {
        guard ScannerDevModeStore.isEnabled else { return }
        let diagnostics = ScanDiagnostics()
        for detection in result?.detections ?? [] {
            let imageIndex = diagnostics.registerAttemptImage(detection.crop)
            let quad = [
                detection.quad.topLeft, detection.quad.topRight,
                detection.quad.bottomRight, detection.quad.bottomLeft,
            ].map { [Double($0.x), Double($0.y)] }
            let outcome: ScanDiagnostics.AttemptOutcome
            switch detection.status {
            case .matched: outcome = .accepted
            case .uncertain: outcome = .printingAmbiguous
            case .unmatched: outcome = .noCandidates
            }
            diagnostics.record(ScanDiagnostics.Attempt(
                kind: .detectedCrop,
                quad: quad,
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
                outcome: outcome,
                imageIndex: imageIndex
            ))
        }
        let label: String
        if let result {
            let matched = result.detections.filter { $0.status == .matched }.count
            label = "binderPage: \(result.detections.count) detections, \(matched) matched"
        } else {
            label = "binderPage error: \(error.map(String.init(describing:)) ?? "unknown")"
        }
        let elapsedMs = (result?.elapsed ?? 0) * 1_000
        Task.detached(priority: .utility) {
            await ScannerDevModeStore.shared.record(
                image: page,
                source: source,
                mode: mode,
                elapsedMs: elapsedMs,
                result: nil,
                diagnostics: diagnostics,
                originalImage: original,
                outcomeLabel: label
            )
        }
    }

    func clearResult() {
        latestResult = nil
        errorMessage = nil
        if isSimulator {
            state = .error("Card scanning is not supported in the iOS Simulator.")
        } else if AVCaptureDevice.authorizationStatus(for: .video) == .authorized {
            state = .ready
        } else {
            state = .idle
        }
        lastAnalysisDate = .distantPast
    }

    func finishBinderPageReview() {
        binderReviewPresentation = nil
        errorMessage = nil
        if isSimulator {
            state = .error("Card scanning is not supported in the iOS Simulator.")
        } else if AVCaptureDevice.authorizationStatus(for: .video) == .authorized {
            state = .ready
        } else {
            state = .idle
        }
    }

    func reopenBinderReview() {
        guard !binderPages.isEmpty else { return }
        binderReviewPresentation = BinderReviewPresentation(
            initialPageIndex: binderPages.count - 1
        )
    }

    func prepareToRescanBinderPage(_ pageNumber: Int) {
        nextBinderPageNumber = max(1, pageNumber)
        binderReviewPresentation = nil
    }

    func setNextBinderPageNumber(_ pageNumber: Int) {
        nextBinderPageNumber = max(1, min(10_000, pageNumber))
    }

    func binderDestinationID(forPageNumber pageNumber: Int) -> String? {
        switch binderDestinationMode {
        case .oneBinder:
            return selectedBinderID
        case .pageByPage:
            return binderPageDestinationIDs[pageNumber] ?? selectedBinderID
        }
    }

    func setBinderDestinationID(_ binderID: String, forPageNumber pageNumber: Int) {
        binderPageDestinationIDs[pageNumber] = binderID
    }

    func clearBinderSession() {
        binderReviewPresentation = nil
        binderPages.removeAll()
        selectedBinderID = nil
        binderDestinationMode = .oneBinder
        binderPageDestinationIDs.removeAll()
        nextBinderPageNumber = 1
    }

    func presentSessionResult(_ result: CardScanResult) {
        latestResult = result
        state = .result(result)
    }

    func removeSessionResult(id: CardScanResult.ID) {
        sessionResults.removeAll { $0.id == id }
        addedSessionResultIDs.remove(id)
        if latestResult?.id == id {
            clearResult()
        }
    }

    func clearSession() {
        sessionResults.removeAll()
        addedSessionResultIDs.removeAll()
        liveConsensus.reset()
        resetLiveConfirmation()
    }

    func selectCandidate(_ candidate: CardScanCandidate, for resultID: CardScanResult.ID) {
        guard let index = sessionResults.firstIndex(where: { $0.id == resultID }) else { return }
        let result = sessionResults[index]
        guard result.primary.id != candidate.id else { return }

        var alternatives = [result.primary]
        alternatives.append(contentsOf: result.alternatives.filter { $0.id != candidate.id })
        let updatedResult = CardScanResult(
            id: result.id,
            mode: result.mode,
            capturedImage: result.capturedImage,
            primary: candidate,
            alternatives: alternatives,
            elapsed: result.elapsed,
            debugCapture: result.debugCapture,
            debugCaptureError: result.debugCaptureError
        )
        sessionResults[index] = updatedResult

        if latestResult?.id == resultID {
            latestResult = updatedResult
            state = .result(updatedResult)
        }
    }

    func markSessionResultsAdded(_ resultIDs: Set<CardScanResult.ID>) {
        addedSessionResultIDs.formUnion(resultIDs)
    }

    private func rebuildContext() {
        guard let environmentStore else { return }
        context = CardScannerContext(
            mode: selectedMode,
            enginePreference: selectedEngine,
            serverConfiguration: environmentStore.serverConfiguration,
            authToken: environmentStore.authToken,
            showPricing: environmentStore.showPricing,
            saveDebugCapture: saveDebugCapture,
            captureNotes: captureNotes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : captureNotes.trimmingCharacters(in: .whitespacesAndNewlines),
            setCode: scanScope?.setCode
        )
        lastAnalysisDate = .distantPast
        liveConsensus.reset()
        resetLiveConfirmation()
    }

    private func handleCapturedPhoto(_ photo: AVCapturePhoto) async {
        defer { isProcessingPhoto = false }
        guard let cgImage = makeCGImage(from: photo) else {
            state = .error("Unable to process captured photo.")
            return
        }
        if captureMode == .binder {
            // The framing guide says "Fit the full binder page" — honor it.
            // Processing the raw sensor frame made the scanner (and the
            // review screen) see far more than the user framed: surroundings
            // ate detector capacity and every card shrank relative to the
            // frame. The uncropped photo is still preserved for dev mode.
            await scanBinderPage(
                image: guideCroppedImage(from: cgImage),
                source: .photoCapture,
                originalImage: cgImage
            )
        } else {
            await scan(
                image: guideCroppedImage(from: cgImage),
                source: .photoCapture,
                originalImage: cgImage
            )
        }
    }

    private func apply(_ result: Result<CardScanResult, CardScannerError>) {
        switch result {
        case .success(let scanResult):
            appendToSession(scanResult)
            if automaticallyPresentsResults {
                latestResult = scanResult
                state = .result(scanResult)
            } else if isSimulator {
                state = .error("Card scanning is not supported in the iOS Simulator.")
            } else {
                state = .ready
            }
            if !isSimulator { HapticManager.notification(.success) }
        case .failure(let error):
            errorMessage = error.errorDescription ?? error.localizedDescription
            state = .ready
            if !isSimulator { HapticManager.notification(.error) }
        }
    }

    private func handleCaptureFailure(_ error: Error) async {
        isProcessingPhoto = false
        errorMessage = error.localizedDescription
        if !isSimulator, AVCaptureDevice.authorizationStatus(for: .video) == .authorized {
            state = .ready
        } else {
            state = .idle
        }
    }

    private func handleSampleBuffer(_ sampleBuffer: CMSampleBuffer) async {
        guard !isSimulator else { return }
        guard !isPhotoImportActive else { return }
        guard captureMode == .card else { return }
        guard triggerMode == .automatic else { return }
        guard case .ready = state else { return }
        guard !isAnalyzingFrame else { return }
        guard !isProcessingPhoto else { return }
        guard latestResult == nil else { return }
        guard let context else { return }
        if !context.serverConfiguration.isOnDevice, context.authToken == nil { return }
        guard coordinator.supportsLiveScanning(for: context.mode, preferredEngine: context.enginePreference) else { return }

        let now = Date()
        guard now.timeIntervalSince(lastAnalysisDate) >= analysisInterval else { return }

        isAnalyzingFrame = true
        lastAnalysisDate = now
        let coordinator = self.coordinator
        let guideGeometry = scannerGuideGeometry

        Task.detached(priority: .userInitiated) { [weak self, context, guideGeometry] in
            guard let self else { return }
            guard let cgImage = CardScannerViewModel.makeCGImage(from: sampleBuffer) else {
                await MainActor.run {
                    self.isAnalyzingFrame = false
                }
                return
            }

            let framedImage = guideGeometry.flatMap {
                ScannerGuideCropper().crop(cgImage, using: $0)
            } ?? cgImage
            var scanContext = context
            let diagnostics = ScannerDevModeStore.isEnabled ? ScanDiagnostics() : nil
            scanContext.diagnostics = diagnostics
            let scanStarted = Date()
            let result = await coordinator.scan(image: framedImage, context: scanContext, source: .livePreview)
            if diagnostics != nil {
                let elapsedMs = Date().timeIntervalSince(scanStarted) * 1_000
                await ScannerDevModeStore.shared.record(
                    image: framedImage,
                    source: .livePreview,
                    mode: scanContext.mode,
                    elapsedMs: elapsedMs,
                    result: result,
                    diagnostics: diagnostics
                )
            }

            await MainActor.run {
                self.isAnalyzingFrame = false
                guard self.captureMode == .card else {
                    return
                }
                switch result {
                case .success(let scanResult):
                    self.handleLiveSuccess(scanResult)
                case .failure(let error):
                    switch error {
                    case .noMatch:
                        _ = self.liveConsensus.observeNoMatch()
                        self.resetLiveConfirmation()
                        break
                    default:
                        // Keep live scanning failures non-blocking to avoid locking the scanner UI.
                        self.resetLiveConfirmation()
                        self.state = .ready
                    }
                }
            }
        }
    }

    func isModeSupported(_ mode: ScanMode) -> Bool {
        coordinator.canScan(mode: mode, preferredEngine: selectedEngine)
    }

    func supportsLivePreview(_ mode: ScanMode) -> Bool {
        guard captureMode == .card else { return false }
        guard triggerMode == .automatic else { return false }
        return coordinator.supportsLiveScanning(for: mode, preferredEngine: selectedEngine)
    }

    private func normalizeSelectedEngine() {
        guard !selectedEngine.supports(selectedMode) else { return }
        if selectedEngine != .automatic {
            selectedEngine = .automatic
        }
    }

    private func makeCGImage(from photo: AVCapturePhoto) -> CGImage? {
        guard let data = photo.fileDataRepresentation() else { return nil }
        return Self.makeCGImage(from: data)
    }

    private var scannerGuideGeometry: ScannerGuideGeometry? {
        guard let previewFrame, let guideFrame else { return nil }
        return ScannerGuideGeometry(previewFrame: previewFrame, guideFrame: guideFrame)
    }

    private func guideCroppedImage(from image: CGImage) -> CGImage {
        guard let scannerGuideGeometry else { return image }
        return ScannerGuideCropper().crop(image, using: scannerGuideGeometry) ?? image
    }

    private func handleLiveSuccess(_ result: CardScanResult) {
        let identity = result.primary.details.identity
        let key = "\(identity.game.rawValue):\(identity.id)"

        switch liveConsensus.observe(key: key) {
        case .pending(let count, let required):
            liveCandidateName = identity.name
            liveConfirmationCount = count
            liveConfirmationRequired = required
            state = .ready
        case .accepted:
            appendToSession(result)
            resetLiveConfirmation()
            state = .ready
            if !isSimulator { HapticManager.notification(.success) }
        case .duplicateSuppressed, .cleared:
            resetLiveConfirmation()
            state = .ready
        }
    }

    private func appendToSession(_ result: CardScanResult) {
        sessionResults.append(result)
        if sessionResults.count > 100 {
            let removedIDs = Set(sessionResults.prefix(sessionResults.count - 100).map(\.id))
            sessionResults.removeFirst(sessionResults.count - 100)
            addedSessionResultIDs.subtract(removedIDs)
        }
    }

    private func resetLiveConfirmation() {
        liveCandidateName = nil
        liveConfirmationCount = 0
        liveConfirmationRequired = 2
    }

    nonisolated private static func makeCGImage(from data: Data) -> CGImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: 2_048
        ]
        return CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    }

    nonisolated private static func makeCGImage(from sampleBuffer: CMSampleBuffer) -> CGImage? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
        var cgImage: CGImage?
        let status = VTCreateCGImageFromCVPixelBuffer(pixelBuffer, options: nil, imageOut: &cgImage)
        if status == kCVReturnSuccess, let cgImage {
            return cgImage
        }
        return nil
    }
}

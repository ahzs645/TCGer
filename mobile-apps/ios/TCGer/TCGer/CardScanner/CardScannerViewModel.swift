import AVFoundation
import Combine
import CoreVideo
import Foundation
import ImageIO
import SwiftUI
import VideoToolbox
import Vision

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
            lastQualityAnalysisDate = .distantPast
            latestCaptureQuality = nil
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
    @Published var latestResult: CardScanResult? {
        didSet { syncCameraOverlayState() }
    }
    @Published var binderPages: [BinderPageRecord] = []
    @Published var binderReviewPresentation: BinderReviewPresentation? {
        didSet { syncCameraOverlayState() }
    }
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
    @Published private(set) var latestCaptureQuality: ScannerCaptureQualityReport?
    @Published private(set) var hasCompletedScanInCurrentSession = false
    @Published var cropRescueRequest: ScannerCropRescueRequest? {
        didSet { syncCameraOverlayState() }
    }
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
    private var lastQualityAnalysisDate: Date = .distantPast
    private let qualityAnalysisInterval: TimeInterval = 0.45
    private var cameraThrottle = ScannerCameraThrottle()
    private var frameConsumerTask: Task<Void, Never>?
    private var previewFrame: CGRect?
    private var guideFrame: CGRect?
    private var liveConsensus = LiveScanConsensus()
    private var automaticallyPresentsResults = false
    private var isPhotoImportActive = false
    private var detectorPreparationStarted = false
    private var rescueSources: [CardScanResult.ID: ScannerCropRescueRequest] = [:]

    var binderPagesScanned: Int { binderPages.count }

    /// True when the current capture mode holds scan results that a mode
    /// switch would discard — used to gate the switch behind a confirmation.
    var hasPendingScanWork: Bool {
        switch captureMode {
        case .binder: return !binderPages.isEmpty
        case .card: return !sessionResults.isEmpty
        }
    }

    /// Switches capture mode, discarding the previous mode's session so the
    /// scanner never carries hidden state across modes.
    func switchCaptureMode(to mode: ScannerCaptureMode) {
        guard mode != captureMode else { return }
        clearSession()
        clearBinderSession()
        captureMode = mode
    }

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
        cameraController.onPreviewFrameChange = { [weak self] frame in
            Task { @MainActor in
                self?.previewFrame = frame
            }
        }
        startFrameConsumer()
        restoreStagedSession()
    }

    private var isOverlayCoveringPreview: Bool {
        latestResult != nil || binderReviewPresentation != nil || cropRescueRequest != nil
    }

    /// Pushes the overlay state into the camera the moment it changes, so
    /// analysis delivery idles for the whole time a sheet is up and resumes
    /// the instant it dismisses. The sensor itself is never touched — a
    /// device-level rate change shows up on screen as a freeze or exposure
    /// ramp during the sheet transition itself.
    private func syncCameraOverlayState() {
        cameraController.setIdle(cameraThrottle.noteOverlay(isOverlayCoveringPreview))
    }

    /// The staging tray is persistent: the view model dies with the scanner
    /// sheet, but staged scans live in `ScannerStagingStore` until the user
    /// adds or discards them — reopening the scanner (or relaunching the app)
    /// restores them here.
    private func restoreStagedSession() {
        Task { [weak self] in
            let restored = await ScannerStagingStore.shared.restore()
            guard let self, !restored.isEmpty else { return }
            let existingIDs = Set(self.sessionResults.map(\.id))
            let fresh = restored.filter { !existingIDs.contains($0.result.id) }
            guard !fresh.isEmpty else { return }
            self.sessionResults = fresh.map(\.result) + self.sessionResults
            self.hasCompletedScanInCurrentSession = true
            self.addedSessionResultIDs.formUnion(
                fresh.filter(\.addedToCollection).map(\.result.id)
            )
        }
    }

    deinit {
        frameConsumerTask?.cancel()
    }

    /// One serial consumer over the camera's newest-1 frame stream. While an
    /// analysis is in flight the loop is suspended, so incoming frames collapse
    /// into the stream's single buffered slot instead of each allocating a Task
    /// and queueing a main-actor hop — the back-pressure lives in the stream,
    /// not in an unbounded actor mailbox.
    private func startFrameConsumer() {
        frameConsumerTask?.cancel()
        let stream = cameraController.makeFrameStream()
        frameConsumerTask = Task { [weak self] in
            for await pixelBuffer in stream {
                guard let self, !Task.isCancelled else { return }
                await self.consumeLiveFrame(pixelBuffer)
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
            prepareDetectorAfterPresentation()
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
                    self.prepareDetectorAfterPresentation()
                    self.state = .ready
                } else {
                    self.state = .unauthorized
                }
            }
        }
    }

    /// The detector is needed by every local scanner, but loading its compiled
    /// Core ML model during view-model construction stalls the scanner's opening
    /// transition. Give the camera UI time to present, then warm the process-wide
    /// model on a utility executor so the first capture does not pay that cost.
    private func prepareDetectorAfterPresentation() {
        guard !detectorPreparationStarted else { return }
        detectorPreparationStarted = true
        Task.detached(priority: .utility) {
            try? await Task.sleep(for: .milliseconds(350))
            guard !Task.isCancelled else { return }
            _ = CardObjectDetector.shared
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
        originalImage: CGImage? = nil,
        cameraIntrinsics: ScannerCameraIntrinsics? = nil,
        allowsCropRescue: Bool = true,
        manualCropQuad: ScannerCropQuad? = nil
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

        let captureQuality = await Self.captureQuality(
            image: image,
            intrinsics: cameraIntrinsics
        )
        latestCaptureQuality = captureQuality

        var scanContext = context
        let diagnostics = ScannerDevModeStore.isEnabled ? ScanDiagnostics() : nil
        scanContext.diagnostics = diagnostics
        scanContext.cameraIntrinsics = cameraIntrinsics
        let started = Date()
        let result = await coordinator.scan(image: image, context: scanContext, source: source)
        if let diagnostics, let manualCropQuad {
            let imageIndex = diagnostics.registerAttemptImage(image)
            let candidates: [ScanDiagnostics.Candidate]
            let outcome: ScanDiagnostics.AttemptOutcome
            switch result {
            case .success(let result):
                candidates = ([result.primary] + result.alternatives).prefix(5).map {
                    ScanDiagnostics.Candidate(
                        cardID: $0.details.identity.id,
                        name: $0.details.identity.name,
                        similarity: $0.confidence.score
                    )
                }
                outcome = .accepted
            case .failure(.rejectedInput):
                candidates = []
                outcome = .rejectedInput
            case .failure:
                candidates = []
                outcome = .noCandidates
            }
            diagnostics.record(ScanDiagnostics.Attempt(
                kind: .manualCrop,
                quad: manualCropQuad.visionObservationCorners,
                gateScore: nil,
                gateThreshold: nil,
                topCandidates: candidates,
                titleMatchedName: nil,
                titlePrintingCount: nil,
                footerPairNumbers: [],
                ocrVerifiedCollectorNumber: nil,
                outcome: outcome,
                imageIndex: imageIndex
            ))
        }
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
                    originalImage: originalImage,
                    captureQuality: captureQuality
                )
            }
        }
        apply(
            result,
            rescueInput: allowsCropRescue
                && source != .livePreview
                && ScannerDevModeStore.isCropRescueEnabled
                ? await Self.makeCropRescueRequest(image: image, sourceResultID: nil)
                : nil
        )
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
        originalImage: CGImage? = nil,
        protectedRect: CGRect? = nil,
        cameraIntrinsics: ScannerCameraIntrinsics? = nil
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
        scanContext.cameraIntrinsics = cameraIntrinsics
        let captureQuality = diagnostics.map { _ in
            ScannerCaptureQualityAnalyzer.analyze(image: image, intrinsics: cameraIntrinsics)
        }
        do {
            let result = try await binderPageScanner.scan(
                image: image,
                context: scanContext,
                protectedRect: protectedRect
            )
            recordBinderPageForDevMode(
                page: image,
                original: originalImage,
                result: result,
                error: nil,
                source: source,
                mode: scanContext.mode,
                diagnostics: diagnostics,
                captureQuality: captureQuality
            )
            let scannedPageNumber = nextBinderPageNumber
            let record = BinderPageRecord(result: result, pageNumber: scannedPageNumber)
            if let existingIndex = binderPages.firstIndex(where: { $0.pageNumber == scannedPageNumber }) {
                binderPages[existingIndex] = record
            } else {
                binderPages.append(record)
                binderPages.sort { $0.pageNumber < $1.pageNumber }
            }
            hasCompletedScanInCurrentSession = true
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
                mode: context.mode,
                diagnostics: diagnostics,
                captureQuality: captureQuality
            )
            errorMessage = error.localizedDescription
            state = .ready
            if !isSimulator { HapticManager.notification(.error) }
        }
    }

    /// Dev-mode capture of a binder page. `BinderPageScanner` has already
    /// merged each pocket's isolated coordinator collector into `diagnostics`,
    /// retaining the real gate, retrieval, OCR, and final inclusion evidence.
    private func recordBinderPageForDevMode(
        page: CGImage,
        original: CGImage?,
        result: BinderPageScanResult?,
        error: Error?,
        source: ScanInvocationKind,
        mode: ScanMode,
        diagnostics: ScanDiagnostics?,
        captureQuality: ScannerCaptureQualityReport?
    ) {
        guard ScannerDevModeStore.isEnabled else { return }
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
                outcomeLabel: label,
                captureQuality: captureQuality
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
        hasCompletedScanInCurrentSession = false
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
        rescueSources.removeValue(forKey: id)
        if latestResult?.id == id {
            clearResult()
        }
        Task.detached(priority: .utility) {
            await ScannerStagingStore.shared.remove(id: id)
        }
    }

    func clearSession() {
        sessionResults.removeAll()
        hasCompletedScanInCurrentSession = false
        addedSessionResultIDs.removeAll()
        rescueSources.removeAll()
        liveConsensus.reset()
        resetLiveConfirmation()
        Task.detached(priority: .utility) {
            await ScannerStagingStore.shared.clear()
        }
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
        Task.detached(priority: .utility) {
            await ScannerStagingStore.shared.update(updatedResult)
        }
    }

    func markSessionResultsAdded(_ resultIDs: Set<CardScanResult.ID>) {
        addedSessionResultIDs.formUnion(resultIDs)
        Task.detached(priority: .utility) {
            await ScannerStagingStore.shared.markAdded(resultIDs)
        }
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
        let fullIntrinsics = Self.cameraIntrinsics(
            from: photo,
            imageSize: CGSize(width: cgImage.width, height: cgImage.height)
        )
        if captureMode == .binder {
            // Crop to what the user could actually see, not just the guide:
            // pocket cards routinely peek past the guide edges and a hard
            // guide crop cut them off. BinderPageScanner re-fits the retained
            // page image to the detected cards afterward, so the extra
            // viewport context doesn't survive into review. Off-screen sensor
            // pixels stay excluded — the raw frame previously fed the
            // detector surroundings the user never framed. The uncropped
            // photo is still preserved for dev mode.
            let cropped = croppedImageAndIntrinsics(
                from: cgImage,
                geometry: previewFrame.map {
                    ScannerGuideGeometry(previewFrame: $0, guideFrame: $0)
                },
                intrinsics: fullIntrinsics
            )
            await scanBinderPage(
                image: cropped.image,
                source: .photoCapture,
                originalImage: cgImage,
                protectedRect: guideRectInViewportNormalized,
                cameraIntrinsics: cropped.intrinsics
            )
        } else {
            let cropped = croppedImageAndIntrinsics(
                from: cgImage,
                geometry: scannerGuideGeometry,
                intrinsics: fullIntrinsics
            )
            await scan(
                image: cropped.image,
                source: .photoCapture,
                originalImage: cgImage,
                cameraIntrinsics: cropped.intrinsics
            )
        }
    }

    private func apply(
        _ result: Result<CardScanResult, CardScannerError>,
        rescueInput: ScannerCropRescueRequest? = nil
    ) {
        switch result {
        case .success(let scanResult):
            if let rescueInput {
                rescueSources[scanResult.id] = ScannerCropRescueRequest(
                    image: rescueInput.image,
                    initialQuad: rescueInput.initialQuad,
                    sourceResultID: scanResult.id
                )
            }
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
            let canRescue: Bool
            switch error {
            case .noMatch, .rejectedInput: canRescue = true
            default: canRescue = false
            }
            if let rescueInput,
               canRescue,
               ScannerDevModeStore.isCropRescueEnabled {
                errorMessage = nil
                cropRescueRequest = rescueInput
                state = .ready
                if !isSimulator { HapticManager.notification(.warning) }
                return
            }
            errorMessage = error.errorDescription ?? error.localizedDescription
            state = .ready
            if !isSimulator { HapticManager.notification(.error) }
        }
    }

    func prepareCropRescue(for resultID: CardScanResult.ID) {
        guard ScannerDevModeStore.isCropRescueEnabled,
              let request = rescueSources[resultID] else { return }
        latestResult = nil
        state = .ready
        cropRescueRequest = request
    }

    func canRescueCrop(for resultID: CardScanResult.ID) -> Bool {
        ScannerDevModeStore.isCropRescueEnabled && rescueSources[resultID] != nil
    }

    func cancelCropRescue() {
        cropRescueRequest = nil
    }

    func retryCropRescue(_ request: ScannerCropRescueRequest, quad: ScannerCropQuad) async {
        guard quad.isValid,
              let crop = CardCropper(detector: nil).makeNormalizedCrop(
                from: request.image,
                observation: quad.visionObservation
              )
        else {
            errorMessage = "The adjusted corners overlap or do not enclose enough of the card."
            return
        }

        cropRescueRequest = nil
        if let sourceResultID = request.sourceResultID {
            removeSessionResult(id: sourceResultID)
        }
        await scan(
            image: crop,
            source: .importedPhoto,
            originalImage: request.image,
            allowsCropRescue: false,
            manualCropQuad: quad
        )
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

    private func consumeLiveFrame(_ pixelBuffer: CVPixelBuffer) async {
        guard !isSimulator else { return }

        // A presented result or binder review covers the preview — idle
        // analysis delivery for its duration. The overlay properties' didSet
        // also syncs this event-driven; the per-frame call here is the
        // belt-and-braces path.
        let overlayCovered = isOverlayCoveringPreview
        cameraController.setIdle(cameraThrottle.noteOverlay(overlayCovered))
        if overlayCovered { return }

        guard !isPhotoImportActive else { return }
        guard captureMode == .card else { return }
        guard case .ready = state else { return }
        guard !isAnalyzingFrame else { return }
        guard !isProcessingPhoto else { return }

        let liveContext: CardScannerContext?
        if triggerMode == .automatic,
           let context,
           context.serverConfiguration.isOnDevice || context.authToken != nil,
           coordinator.supportsLiveScanning(
               for: context.mode,
               preferredEngine: context.enginePreference
           ) {
            liveContext = context
        } else {
            liveContext = nil
        }

        let now = Date()
        let schedule = ScannerFrameAnalysisSchedule.decide(
            automaticRecognitionAvailable: liveContext != nil,
            secondsSinceQuality: now.timeIntervalSince(lastQualityAnalysisDate),
            secondsSinceRecognition: now.timeIntervalSince(lastAnalysisDate),
            qualityInterval: qualityAnalysisInterval,
            recognitionInterval: analysisInterval
        )
        if schedule.analyzesQualityOnly {
            lastQualityAnalysisDate = now
            if let quality = await Self.analyzeLiveQuality(
                pixelBuffer,
                guideGeometry: scannerGuideGeometry
            ) {
                latestCaptureQuality = quality
            }
        }

        guard schedule.runsRecognition, let context = liveContext else { return }

        isAnalyzingFrame = true
        lastAnalysisDate = now
        // The full recognition path also returns capture quality, so it
        // satisfies both clocks without a redundant quality-only pass.
        lastQualityAnalysisDate = now
        defer { isAnalyzingFrame = false }

        var scanContext = context
        let diagnostics = ScannerDevModeStore.isEnabled ? ScanDiagnostics() : nil
        scanContext.diagnostics = diagnostics

        // Awaited, not detached-and-forgotten: the consumer loop stays
        // suspended here, which is what lets the camera stream shed frames.
        let analysis = await Self.analyzeLiveFrame(
            pixelBuffer,
            context: scanContext,
            guideGeometry: scannerGuideGeometry,
            coordinator: coordinator,
            recordsDevMode: diagnostics != nil
        )
        guard let analysis else { return }
        latestCaptureQuality = analysis.captureQuality
        guard captureMode == .card else { return }

        switch analysis.result {
        case .success(let scanResult):
            cameraController.setIdle(cameraThrottle.noteAnalysis(cardVisible: true))
            handleLiveSuccess(scanResult)
        case .failure(let error):
            cameraController.setIdle(cameraThrottle.noteAnalysis(cardVisible: analysis.cardPresent))
            switch error {
            case .noMatch:
                _ = liveConsensus.observeNoMatch()
                resetLiveConfirmation()
            default:
                // Keep live scanning failures non-blocking to avoid locking the scanner UI.
                resetLiveConfirmation()
                state = .ready
            }
        }
    }

    private struct LiveFrameAnalysis {
        let result: Result<CardScanResult, CardScannerError>
        let captureQuality: ScannerCaptureQualityReport
        /// Whether anything card-shaped was in the frame — a no-match on an
        /// unrecognized card must not idle the camera under the user's hands.
        let cardPresent: Bool
    }

    /// Decode + crop + scan off the main actor (nonisolated async runs on the
    /// global executor). Returns nil when the pixel buffer can't be decoded.
    nonisolated private static func analyzeLiveFrame(
        _ pixelBuffer: CVPixelBuffer,
        context: CardScannerContext,
        guideGeometry: ScannerGuideGeometry?,
        coordinator: CardScannerCoordinator,
        recordsDevMode: Bool
    ) async -> LiveFrameAnalysis? {
        guard let cgImage = makeCGImage(from: pixelBuffer) else { return nil }
        let framedImage = guideGeometry.flatMap {
            ScannerGuideCropper().crop(cgImage, using: $0)
        } ?? cgImage
        let captureQuality = ScannerCaptureQualityAnalyzer.analyze(image: framedImage)
        let scanStarted = Date()
        let result = await coordinator.scan(image: framedImage, context: context, source: .livePreview)
        if recordsDevMode {
            let elapsedMs = Date().timeIntervalSince(scanStarted) * 1_000
            await ScannerDevModeStore.shared.record(
                image: framedImage,
                source: .livePreview,
                mode: context.mode,
                elapsedMs: elapsedMs,
                result: result,
                diagnostics: context.diagnostics,
                captureQuality: captureQuality
            )
        }
        let cardPresent: Bool
        switch result {
        case .success:
            cardPresent = true
        case .failure(.noMatch):
            // Reuse the rectangle already found by capture-quality analysis.
            // Only pay for the presence-only Vision request when that pass
            // could not find a plausible card boundary.
            cardPresent = captureQuality.fillRatio != nil || cardLikelyPresent(in: framedImage)
        case .failure:
            // Transient errors say nothing about the viewfinder; don't let
            // them accumulate toward idling the camera.
            cardPresent = true
        }
        return LiveFrameAnalysis(
            result: result,
            captureQuality: captureQuality,
            cardPresent: cardPresent
        )
    }

    nonisolated private static func analyzeLiveQuality(
        _ pixelBuffer: CVPixelBuffer,
        guideGeometry: ScannerGuideGeometry?
    ) async -> ScannerCaptureQualityReport? {
        guard let image = makeCGImage(from: pixelBuffer) else { return nil }
        let framed = guideGeometry.flatMap { ScannerGuideCropper().crop(image, using: $0) } ?? image
        return ScannerCaptureQualityAnalyzer.analyze(image: framed)
    }

    /// Cheap presence-only check (~5ms document segmentation): is anything
    /// card-shaped in the frame at all? Feeds the idle throttle, never the
    /// recognition pipeline.
    nonisolated private static func cardLikelyPresent(in image: CGImage) -> Bool {
        let request = VNDetectDocumentSegmentationRequest()
        try? VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        return (request.results ?? []).contains { $0.confidence >= 0.3 }
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

    private func croppedImageAndIntrinsics(
        from image: CGImage,
        geometry: ScannerGuideGeometry?,
        intrinsics: ScannerCameraIntrinsics?
    ) -> (image: CGImage, intrinsics: ScannerCameraIntrinsics?) {
        guard let geometry,
              let rect = ScannerGuideCropper().imageCropRect(
                imageSize: CGSize(width: image.width, height: image.height),
                geometry: geometry
              ),
              let cropped = image.cropping(to: rect)
        else { return (image, intrinsics) }
        let adjusted = intrinsics.map {
            ScannerCameraIntrinsics(
                fx: $0.fx,
                fy: $0.fy,
                cx: $0.cx - rect.minX,
                cy: $0.cy - rect.minY
            )
        }
        return (cropped, adjusted)
    }

    /// Crops the sensor image to the full visible preview instead of the
    /// guide, by treating the viewport itself as the guide rect.
    private func viewportCroppedImage(from image: CGImage) -> CGImage {
        guard let previewFrame else { return image }
        let geometry = ScannerGuideGeometry(previewFrame: previewFrame, guideFrame: previewFrame)
        return ScannerGuideCropper().crop(image, using: geometry) ?? image
    }

    /// The framing guide expressed in the viewport-cropped image's
    /// Vision-normalized space (bottom-left origin). The viewport crop is
    /// exactly the preview's visible content, so view-space fractions map
    /// linearly onto it. Nil when either frame is unknown.
    private var guideRectInViewportNormalized: CGRect? {
        guard let previewFrame, let guideFrame,
              previewFrame.width > 0, previewFrame.height > 0
        else { return nil }
        let visible = guideFrame.intersection(previewFrame)
        guard !visible.isNull, visible.width > 1, visible.height > 1 else { return nil }
        let x = (visible.minX - previewFrame.minX) / previewFrame.width
        let topY = (visible.minY - previewFrame.minY) / previewFrame.height
        let width = visible.width / previewFrame.width
        let height = visible.height / previewFrame.height
        return CGRect(x: x, y: 1 - topY - height, width: width, height: height)
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
        hasCompletedScanInCurrentSession = true
        if sessionResults.count > 100 {
            let removedIDs = Set(sessionResults.prefix(sessionResults.count - 100).map(\.id))
            sessionResults.removeFirst(sessionResults.count - 100)
            addedSessionResultIDs.subtract(removedIDs)
        }
        // The store applies the same 100-scan cap on its side.
        Task.detached(priority: .utility) {
            await ScannerStagingStore.shared.stage(result)
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

    nonisolated private static func captureQuality(
        image: CGImage,
        intrinsics: ScannerCameraIntrinsics?
    ) async -> ScannerCaptureQualityReport {
        ScannerCaptureQualityAnalyzer.analyze(image: image, intrinsics: intrinsics)
    }

    nonisolated private static func makeCropRescueRequest(
        image: CGImage,
        sourceResultID: CardScanResult.ID?
    ) async -> ScannerCropRescueRequest {
        let observations = try? CardCropper(detector: nil).detectRectangles(in: image)
        let observation = observations.flatMap {
            CardCropper.preferredObservation(from: $0)
        }
        let quad = observation.map(ScannerCropQuad.init(observation:))
            ?? ScannerCropQuad.centered(
                in: CGSize(width: image.width, height: image.height)
            )
        return ScannerCropRescueRequest(
            image: image,
            initialQuad: quad,
            sourceResultID: sourceResultID
        )
    }

    nonisolated private static func cameraIntrinsics(
        from photo: AVCapturePhoto,
        imageSize: CGSize
    ) -> ScannerCameraIntrinsics? {
        guard let calibration = photo.cameraCalibrationData else { return nil }
        let reference = calibration.intrinsicMatrixReferenceDimensions
        guard reference.width > 0, reference.height > 0 else { return nil }
        let matrix = calibration.intrinsicMatrix
        let raw = ScannerCameraIntrinsics(
            fx: CGFloat(matrix.columns.0.x),
            fy: CGFloat(matrix.columns.1.y),
            cx: CGFloat(matrix.columns.2.x),
            cy: CGFloat(matrix.columns.2.y)
        )
        let orientationRaw = (photo.metadata[String(kCGImagePropertyOrientation)] as? NSNumber)?.uint32Value
        let orientation = orientationRaw.flatMap(CGImagePropertyOrientation.init(rawValue:)) ?? .up
        let oriented: (intrinsics: ScannerCameraIntrinsics, size: CGSize)
        switch orientation {
        case .up:
            oriented = (raw, reference)
        case .down:
            oriented = (
                ScannerCameraIntrinsics(
                    fx: raw.fx,
                    fy: raw.fy,
                    cx: reference.width - raw.cx,
                    cy: reference.height - raw.cy
                ),
                reference
            )
        case .right:
            oriented = (
                ScannerCameraIntrinsics(
                    fx: raw.fy,
                    fy: raw.fx,
                    cx: reference.height - raw.cy,
                    cy: raw.cx
                ),
                CGSize(width: reference.height, height: reference.width)
            )
        case .left:
            oriented = (
                ScannerCameraIntrinsics(
                    fx: raw.fy,
                    fy: raw.fx,
                    cx: raw.cy,
                    cy: reference.width - raw.cx
                ),
                CGSize(width: reference.height, height: reference.width)
            )
        default:
            // Back-camera stills are not mirrored. Avoid applying an
            // unverified mirrored calibration if a future capture route is.
            return nil
        }
        let scaleX = imageSize.width / oriented.size.width
        let scaleY = imageSize.height / oriented.size.height
        let intrinsics = ScannerCameraIntrinsics(
            fx: oriented.intrinsics.fx * scaleX,
            fy: oriented.intrinsics.fy * scaleY,
            cx: oriented.intrinsics.cx * scaleX,
            cy: oriented.intrinsics.cy * scaleY
        )
        return intrinsics.isUsable ? intrinsics : nil
    }

    nonisolated private static func makeCGImage(from sampleBuffer: CMSampleBuffer) -> CGImage? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
        return makeCGImage(from: pixelBuffer)
    }

    nonisolated private static func makeCGImage(from pixelBuffer: CVPixelBuffer) -> CGImage? {
        var cgImage: CGImage?
        let status = VTCreateCGImageFromCVPixelBuffer(pixelBuffer, options: nil, imageOut: &cgImage)
        if status == kCVReturnSuccess, let cgImage {
            return cgImage
        }
        return nil
    }
}

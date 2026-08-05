import AVFoundation
import Combine
import Foundation
import ImageIO
import SwiftUI
import VideoToolbox

@MainActor
final class CardScannerViewModel: ObservableObject {
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
    @Published var latestResult: CardScanResult?
    @Published var latestBinderPageResult: BinderPageScanResult?
    @Published var errorMessage: String?
    @Published var isProcessingPhoto = false
    @Published var isAnalyzingFrame = false
    @Published private(set) var sessionResults: [CardScanResult] = []
    @Published private(set) var liveCandidateName: String?
    @Published private(set) var liveConfirmationCount = 0
    @Published private(set) var liveConfirmationRequired = 2
    @Published private(set) var binderPagesScanned = 0
    @Published private(set) var binderCardsScanned = 0
    @Published private(set) var binderCardsAdded = 0
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

    func updateEnvironment(_ environment: EnvironmentStore) {
        environmentStore = environment
        // In phone-only mode there is no backend, so fall back to the fully
        // on-device engine — both for the default and for a server matcher
        // carried over from a previous server connection.
        if environment.serverConfiguration.isOnDevice,
           selectedEngine == .automatic || selectedEngine.requiresServerOnlyFlow {
            selectedEngine = .localOnly
        }
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
        guard isModeSupported(selectedMode) else {
            state = .error("\(selectedMode.displayName) scanning is not available yet.")
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
    func scan(image: CGImage, source: ScanInvocationKind = .photoCapture) async {
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

        let result = await coordinator.scan(image: image, context: context, source: source)
        apply(result)
    }

    func scan(imageData: Data, source: ScanInvocationKind = .photoCapture) async {
        guard let image = Self.makeCGImage(from: imageData) else {
            state = .error("Unable to decode the selected scanner image.")
            return
        }
        if captureMode == .binder {
            await scanBinderPage(image: image)
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

    func scanBinderPage(image: CGImage) async {
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
            binderPagesScanned += 1
            binderCardsScanned += result.detections.count
            latestBinderPageResult = result
            state = .ready
            if !isSimulator { HapticManager.notification(.success) }
        } catch {
            errorMessage = error.localizedDescription
            state = .ready
            if !isSimulator { HapticManager.notification(.error) }
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
        latestBinderPageResult = nil
        errorMessage = nil
        if isSimulator {
            state = .error("Card scanning is not supported in the iOS Simulator.")
        } else if AVCaptureDevice.authorizationStatus(for: .video) == .authorized {
            state = .ready
        } else {
            state = .idle
        }
    }

    func recordBinderCardsAdded(_ count: Int) {
        binderCardsAdded += max(0, count)
    }

    func clearBinderSession() {
        binderPagesScanned = 0
        binderCardsScanned = 0
        binderCardsAdded = 0
    }

    func presentSessionResult(_ result: CardScanResult) {
        latestResult = result
        state = .result(result)
    }

    func removeSessionResult(id: CardScanResult.ID) {
        sessionResults.removeAll { $0.id == id }
        if latestResult?.id == id {
            clearResult()
        }
    }

    func clearSession() {
        sessionResults.removeAll()
        liveConsensus.reset()
        resetLiveConfirmation()
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
            await scanBinderPage(image: cgImage)
        } else {
            await scan(image: guideCroppedImage(from: cgImage))
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
        guard captureMode == .card else { return }
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
            let result = await coordinator.scan(image: framedImage, context: context, source: .livePreview)

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
            sessionResults.removeFirst(sessionResults.count - 100)
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

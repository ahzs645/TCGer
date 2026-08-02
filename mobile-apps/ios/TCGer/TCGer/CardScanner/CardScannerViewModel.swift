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
    @Published var latestResult: CardScanResult?
    @Published var errorMessage: String?
    @Published var isProcessingPhoto = false
    @Published var isAnalyzingFrame = false
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
    private var environmentStore: EnvironmentStore?
    private var context: CardScannerContext?
    private let isSimulator: Bool
    private var lastAnalysisDate: Date = .distantPast
    private let analysisInterval: TimeInterval = 1.0

    init(coordinator: CardScannerCoordinator? = nil) {
#if targetEnvironment(simulator)
        isSimulator = true
#else
        isSimulator = false
#endif
        self.coordinator = coordinator ?? CardScannerCoordinator.makeDefault()
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
        await scan(image: image, source: source)
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
    }

    private func handleCapturedPhoto(_ photo: AVCapturePhoto) async {
        defer { isProcessingPhoto = false }
        guard let cgImage = makeCGImage(from: photo) else {
            state = .error("Unable to process captured photo.")
            return
        }
        await scan(image: cgImage)
    }

    private func apply(_ result: Result<CardScanResult, CardScannerError>) {
        switch result {
        case .success(let scanResult):
            latestResult = scanResult
            state = .result(scanResult)
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

        Task.detached(priority: .userInitiated) { [weak self, context] in
            guard let self else { return }
            guard let cgImage = CardScannerViewModel.makeCGImage(from: sampleBuffer) else {
                await MainActor.run {
                    self.isAnalyzingFrame = false
                }
                return
            }

            let result = await coordinator.scan(image: cgImage, context: context, source: .livePreview)

            await MainActor.run {
                self.isAnalyzingFrame = false
                switch result {
                case .success(let scanResult):
                    self.latestResult = scanResult
                    self.state = .result(scanResult)
                case .failure(let error):
                    switch error {
                    case .noMatch:
                        break
                    default:
                        // Keep live scanning failures non-blocking to avoid locking the scanner UI.
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
        coordinator.supportsLiveScanning(for: mode, preferredEngine: selectedEngine)
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

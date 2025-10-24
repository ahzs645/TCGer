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
        didSet { rebuildContext() }
    }
    @Published var latestResult: CardScanResult?
    @Published var errorMessage: String?
    @Published var isProcessingPhoto = false
    @Published var isAnalyzingFrame = false

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
        cameraController.onSampleBuffer = { [weak self] sampleBuffer in
            guard let self else { return }
            Task {
                await self.handleSampleBuffer(sampleBuffer)
            }
        }
    }

    func updateEnvironment(_ environment: EnvironmentStore) {
        environmentStore = environment
        rebuildContext()
        prepareCameraIfPossible()
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
        guard context?.authToken != nil else {
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
            serverConfiguration: environmentStore.serverConfiguration,
            authToken: environmentStore.authToken,
            showPricing: environmentStore.showPricing
        )
        lastAnalysisDate = .distantPast
    }

    private func handleCapturedPhoto(_ photo: AVCapturePhoto) async {
        defer { isProcessingPhoto = false }

        if isSimulator {
            state = .error("Card scanning is not supported in the iOS Simulator.")
            return
        }

        guard let cgImage = makeCGImage(from: photo) else {
            state = .error("Unable to process captured photo.")
            return
        }

        guard let context else {
            state = .error("Scanner context unavailable.")
            return
        }

        let result = await coordinator.scan(image: cgImage, context: context)

        switch result {
        case .success(let scanResult):
            latestResult = scanResult
            state = .result(scanResult)
        case .failure(let error):
            errorMessage = error.errorDescription ?? error.localizedDescription
            state = .error(errorMessage ?? "Scan failed.")
        }
    }

    private func handleSampleBuffer(_ sampleBuffer: CMSampleBuffer) async {
        guard !isSimulator else { return }
        guard case .ready = state else { return }
        guard !isAnalyzingFrame else { return }
        guard !isProcessingPhoto else { return }
        guard latestResult == nil else { return }
        guard let context, context.authToken != nil else { return }
        guard context.mode == .pokemon else { return }

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

            let result = await coordinator.scan(image: cgImage, context: context)

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
                    case .ineligibleMode:
                        self.state = .error("Live scanning for this mode is not available yet.")
                    case .missingAuthToken:
                        self.state = .error(CardScannerError.missingAuthToken.errorDescription ?? "Not authenticated")
                    default:
                        self.errorMessage = error.errorDescription ?? error.localizedDescription
                        self.state = .error(self.errorMessage ?? "Scan failed.")
                    }
                }
            }
        }
    }

    private func makeCGImage(from photo: AVCapturePhoto) -> CGImage? {
        guard let data = photo.fileDataRepresentation() else { return nil }
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
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

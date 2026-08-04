import AVFoundation
import Combine
import CoreMedia
import SwiftUI

final class CardScannerCameraController: NSObject, ObservableObject {
    @Published private(set) var isTorchAvailable = false
    @Published private(set) var isTorchEnabled = false

    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "card.scanner.session.queue")
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let videoOutputQueue = DispatchQueue(label: "card.scanner.video.queue")
    private var isConfigured = false
    private var videoDevice: AVCaptureDevice?

    var onPhotoCapture: ((AVCapturePhoto) -> Void)?
    var onPhotoCaptureError: ((Error) -> Void)?
    var onSampleBuffer: ((CMSampleBuffer) -> Void)?
    var onPreviewFrameChange: ((CGRect) -> Void)?

    override init() {
        super.init()
        session.sessionPreset = .photo
    }

    func configureIfNeeded() {
        guard !isConfigured else { return }
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.configureSession()
        }
        isConfigured = true
    }

    private func configureSession() {
        session.beginConfiguration()

        defer { session.commitConfiguration() }

        session.inputs.forEach { session.removeInput($0) }
        session.outputs.forEach { session.removeOutput($0) }

        guard
            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            let deviceInput = try? AVCaptureDeviceInput(device: device),
            session.canAddInput(deviceInput)
        else {
            return
        }

        session.addInput(deviceInput)
        videoDevice = device
        publishTorchState(available: device.hasTorch, enabled: device.torchMode == .on)

        if session.canAddOutput(photoOutput) {
            session.addOutput(photoOutput)
        }

        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        videoOutput.setSampleBufferDelegate(self, queue: videoOutputQueue)
        if session.canAddOutput(videoOutput) {
            session.addOutput(videoOutput)
        }

        if let connection = videoOutput.connection(with: .video) {
            if connection.isVideoRotationAngleSupported(90) {
                connection.videoRotationAngle = 90
            }
        }
    }

    func startRunning() {
        sessionQueue.async { [weak self] in
            guard let self, !self.session.isRunning else { return }
            self.session.startRunning()
        }
    }

    func stopRunning() {
        sessionQueue.async { [weak self] in
            guard let self, self.session.isRunning else { return }
            self.setTorchEnabledOnSessionQueue(false)
            self.session.stopRunning()
        }
    }

    func capturePhoto() {
        let settings = AVCapturePhotoSettings()
        settings.flashMode = .off
        photoOutput.capturePhoto(with: settings, delegate: self)
    }

    func canCapturePhoto() -> Bool {
        photoOutput.connection(with: .video) != nil
    }

    func previewFrameDidChange(_ frame: CGRect) {
        onPreviewFrameChange?(frame)
    }

    func toggleTorch() {
        setTorchEnabled(!isTorchEnabled)
    }

    func setTorchEnabled(_ enabled: Bool) {
        sessionQueue.async { [weak self] in
            self?.setTorchEnabledOnSessionQueue(enabled)
        }
    }

    func focus(at devicePoint: CGPoint) {
        sessionQueue.async { [weak self] in
            guard let device = self?.videoDevice else { return }
            do {
                try device.lockForConfiguration()
                defer { device.unlockForConfiguration() }

                if device.isFocusPointOfInterestSupported {
                    device.focusPointOfInterest = devicePoint
                }
                if device.isFocusModeSupported(.autoFocus) {
                    device.focusMode = .autoFocus
                }
                if device.isExposurePointOfInterestSupported {
                    device.exposurePointOfInterest = devicePoint
                }
                if device.isExposureModeSupported(.continuousAutoExposure) {
                    device.exposureMode = .continuousAutoExposure
                }
            } catch {
                return
            }
        }
    }

    private func setTorchEnabledOnSessionQueue(_ enabled: Bool) {
        guard let device = videoDevice, device.hasTorch else {
            publishTorchState(available: false, enabled: false)
            return
        }
        do {
            try device.lockForConfiguration()
            defer { device.unlockForConfiguration() }
            if enabled {
                try device.setTorchModeOn(level: min(0.5, AVCaptureDevice.maxAvailableTorchLevel))
            } else {
                device.torchMode = .off
            }
            publishTorchState(available: true, enabled: enabled)
        } catch {
            publishTorchState(available: true, enabled: device.torchMode == .on)
        }
    }

    private func publishTorchState(available: Bool, enabled: Bool) {
        DispatchQueue.main.async { [weak self] in
            self?.isTorchAvailable = available
            self?.isTorchEnabled = enabled
        }
    }
}

extension CardScannerCameraController: AVCapturePhotoCaptureDelegate {
    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        if let error {
            onPhotoCaptureError?(error)
            return
        }
        onPhotoCapture?(photo)
    }
}

extension CardScannerCameraController: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        onSampleBuffer?(sampleBuffer)
    }
}

final class CameraPreviewView: UIView {
    override class var layerClass: AnyClass {
        AVCaptureVideoPreviewLayer.self
    }

    var previewLayer: AVCaptureVideoPreviewLayer {
        guard let layer = layer as? AVCaptureVideoPreviewLayer else {
            fatalError("Layer is not AVCaptureVideoPreviewLayer")
        }
        layer.videoGravity = .resizeAspectFill
        return layer
    }
}

struct CardScannerCameraPreview: UIViewControllerRepresentable {
    let controller: CardScannerCameraController

    func makeUIViewController(context: Context) -> CameraPreviewController {
        CameraPreviewController(controller: controller)
    }

    func updateUIViewController(_ uiViewController: CameraPreviewController, context: Context) {
        // No-op
    }
}

final class CameraPreviewController: UIViewController {
    private let controller: CardScannerCameraController
    private let previewView = CameraPreviewView()

    init(controller: CardScannerCameraController) {
        self.controller = controller
        super.init(nibName: nil, bundle: nil)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view = previewView
        previewView.previewLayer.session = controller.session
        previewView.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(focusCamera(_:))))
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        controller.configureIfNeeded()
        controller.startRunning()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        controller.previewFrameDidChange(view.convert(view.bounds, to: nil))
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        controller.stopRunning()
    }

    @objc private func focusCamera(_ gesture: UITapGestureRecognizer) {
        let point = gesture.location(in: previewView)
        let devicePoint = previewView.previewLayer.captureDevicePointConverted(fromLayerPoint: point)
        controller.focus(at: devicePoint)
        showFocusIndicator(at: point)
    }

    private func showFocusIndicator(at point: CGPoint) {
        let indicator = UIView(frame: CGRect(x: 0, y: 0, width: 64, height: 64))
        indicator.center = point
        indicator.layer.borderColor = UIColor.systemYellow.cgColor
        indicator.layer.borderWidth = 2
        indicator.layer.cornerRadius = 12
        indicator.alpha = 0
        indicator.isUserInteractionEnabled = false
        previewView.addSubview(indicator)

        UIView.animate(withDuration: 0.15, animations: {
            indicator.alpha = 1
            indicator.transform = CGAffineTransform(scaleX: 0.82, y: 0.82)
        }) { _ in
            UIView.animate(withDuration: 0.35, delay: 0.45, options: [.curveEaseOut]) {
                indicator.alpha = 0
                indicator.transform = .identity
            } completion: { _ in
                indicator.removeFromSuperview()
            }
        }
    }
}

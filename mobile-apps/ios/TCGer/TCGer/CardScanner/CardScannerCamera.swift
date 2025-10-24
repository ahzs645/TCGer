import AVFoundation
import Combine
import CoreMedia
import SwiftUI

final class CardScannerCameraController: NSObject, ObservableObject {
    let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "card.scanner.session.queue")
    private let photoOutput = AVCapturePhotoOutput()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let videoOutputQueue = DispatchQueue(label: "card.scanner.video.queue")
    private var isConfigured = false

    var onPhotoCapture: ((AVCapturePhoto) -> Void)?
    var onSampleBuffer: ((CMSampleBuffer) -> Void)?

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

        if let connection = videoOutput.connection(with: .video), connection.isVideoOrientationSupported {
            connection.videoOrientation = .portrait
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
}

extension CardScannerCameraController: AVCapturePhotoCaptureDelegate {
    func photoOutput(
        _ output: AVCapturePhotoOutput,
        didFinishProcessingPhoto photo: AVCapturePhoto,
        error: Error?
    ) {
        guard error == nil else { return }
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
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        controller.configureIfNeeded()
        controller.startRunning()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        controller.stopRunning()
    }
}

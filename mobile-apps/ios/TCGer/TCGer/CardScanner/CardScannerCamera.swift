import AVFoundation
import Combine
import CoreMedia
import QuartzCore
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

    /// The preview layer renders straight from the capture device, so any
    /// device-level frame-rate cap makes the on-screen viewfinder choppy.
    /// The sensor therefore runs at its native rate whenever the preview is
    /// visible, and "idle" throttles only what reaches the analysis stream —
    /// frames are dropped on the video queue before they cost anything. The
    /// device-level cap is reserved for a fully covered preview (result
    /// sheet / binder review up), where smoothness is invisible and the
    /// sensor can actually cool down. Only `activeVideoMinFrameDuration` is
    /// ever capped, never `max`: capping the maximum duration would also cap
    /// exposure time, and a card under indoor light needs the long exposures
    /// the camera chooses for itself.
    private static let occludedFPS = 2.0
    /// Seconds between yields into the analysis stream. The consumer analyzes
    /// at most once a second, so scanning delivery at 15/s already halves the
    /// wake-ups a 30fps sensor would cause without adding meaningful latency,
    /// and idle delivery at 2/s keeps card-appears wake-up latency low while
    /// shedding the per-frame hops an empty viewfinder doesn't need.
    private static let scanningYieldInterval: CFTimeInterval = 1.0 / 15.0
    private static let idleYieldInterval: CFTimeInterval = 0.5
    // Touched only on videoOutputQueue (delegate callbacks) or via its .async.
    private var frameContinuation: AsyncStream<CVPixelBuffer>.Continuation?
    private var minYieldInterval: CFTimeInterval = CardScannerCameraController.scanningYieldInterval
    private var lastYieldAt: CFTimeInterval = 0
    private(set) var droppedFrameCount = 0
    // Touched only on sessionQueue.
    private var isPreviewOccluded = false

    var onPhotoCapture: ((AVCapturePhoto) -> Void)?
    var onPhotoCaptureError: ((Error) -> Void)?
    var onPreviewFrameChange: ((CGRect) -> Void)?

    override init() {
        super.init()
        // This scanner captures video and still images only. Prevent
        // AVCaptureSession from changing the app-wide audio session, which
        // would otherwise interrupt music, podcasts, and other media when the
        // camera starts running.
        session.automaticallyConfiguresApplicationAudioSession = false
        session.sessionPreset = .photo
    }

    /// The live-analysis frame conduit. `.bufferingNewest(1)` is the actual
    /// back-pressure valve: `captureOutput` yields and returns instantly, so
    /// `alwaysDiscardsLateVideoFrames` never engages (AVFoundation sees a
    /// delegate that is never late) — without this policy the stream's default
    /// unbounded FIFO would accumulate pool-owned pixel buffers while the
    /// consumer is mid-analysis, starving the capture pool and handing the
    /// pipeline the OLDEST held frame. Newest-1 means: drop stale frames,
    /// always work on a recent one, hold at most one buffer beyond the one in
    /// flight. Making a new stream finishes the previous one.
    func makeFrameStream() -> AsyncStream<CVPixelBuffer> {
        let (stream, continuation) = AsyncStream.makeStream(
            of: CVPixelBuffer.self,
            bufferingPolicy: .bufferingNewest(1)
        )
        videoOutputQueue.async { [weak self] in
            guard let self else {
                continuation.finish()
                return
            }
            self.frameContinuation?.finish()
            self.frameContinuation = continuation
        }
        return stream
    }

    /// Idle throttles the ANALYSIS STREAM only — the sensor (and therefore
    /// the on-screen preview) keeps its native rate. Called per frame by the
    /// consumer; repeat states are harmless (a single scalar write).
    func setIdle(_ idle: Bool) {
        videoOutputQueue.async { [weak self] in
            self?.minYieldInterval = idle ? Self.idleYieldInterval : Self.scanningYieldInterval
        }
    }

    /// A presented sheet fully covers the preview, so smoothness is invisible
    /// and the sensor can drop to a trickle. Repeats of the current state are
    /// ignored so only transitions pay for a device configuration lock.
    func setPreviewOccluded(_ occluded: Bool) {
        sessionQueue.async { [weak self] in
            guard let self, occluded != self.isPreviewOccluded else { return }
            self.isPreviewOccluded = occluded
            self.applyPreviewOcclusionOnSessionQueue()
        }
    }

    private func applyPreviewOcclusionOnSessionQueue() {
        guard let device = videoDevice, (try? device.lockForConfiguration()) != nil else { return }
        // `.invalid` restores the format's default (uncapped) frame duration.
        device.activeVideoMinFrameDuration = isPreviewOccluded
            ? Self.frameDuration(capping: Self.occludedFPS, on: device)
            : .invalid
        device.unlockForConfiguration()
    }

    private static func frameDuration(capping fps: Double, on device: AVCaptureDevice) -> CMTime {
        let ranges = device.activeFormat.videoSupportedFrameRateRanges
        let lo = ranges.map(\.minFrameRate).min() ?? fps
        let hi = ranges.map(\.maxFrameRate).max() ?? fps
        return CMTime(seconds: 1 / min(max(fps, lo), hi), preferredTimescale: 600)
    }

    func configureIfNeeded() {
        guard !isConfigured else { return }
        sessionQueue.async { [weak self] in
            guard let self else { return }
            self.configureSession()
            // AFTER commitConfiguration, not inside it: setting a session
            // preset resets the frame-duration properties, so an occlusion
            // cap applied before the preset lands would be a no-op.
            if self.isPreviewOccluded {
                self.applyPreviewOcclusionOnSessionQueue()
            }
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
        if photoOutput.isCameraCalibrationDataDeliverySupported {
            settings.isCameraCalibrationDataDeliveryEnabled = true
        }
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
        // Yield the bare pixel buffer, not the sample buffer: the stream's
        // newest-1 slot may hold it across the consumer's analysis, and a
        // retained CMSampleBuffer would pin capture-pool metadata with it.
        // While idle, drop frames right here — before they cost a consumer
        // hop — so the preview keeps every frame the sensor produces.
        if let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) {
            let now = CACurrentMediaTime()
            if minYieldInterval == 0 || now - lastYieldAt >= minYieldInterval {
                lastYieldAt = now
                frameContinuation?.yield(pixelBuffer)
            }
        }
    }

    func captureOutput(
        _ output: AVCaptureOutput,
        didDrop sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        droppedFrameCount += 1
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

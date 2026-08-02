//
//  ScannerDebugView.swift
//  TCGer
//
//  Developer tool: open the live camera and watch the recognition pipeline
//  run in real time — card segmentation outline, the current identification,
//  per-frame timings, and a scrolling event log. Start/stop controlled by the
//  user. Reuses the production camera controller, cropper, and coordinator so
//  what you see here matches the real live-scan path.
//

import AVFoundation
import Combine
import CoreMedia
import SwiftUI
import UIKit
import VideoToolbox
@preconcurrency import Vision

// MARK: - Recording model (exportable run for later re-analysis)

/// One analyzed frame: the pipeline's decision plus a reference to the saved
/// image, so a recorded run can be re-opened and reviewed off-device.
struct RecordedScanFrame: Codable {
    let index: Int
    let timestampSeconds: Double
    let mode: String
    let pipeline: String
    let elapsedMs: Double
    let detectedCount: Int
    let segmentationConfidence: Double?
    /// Four normalized corners (Vision space, origin bottom-left): TL, TR, BR, BL.
    let quad: [[Double]]?
    let identified: Bool
    let bestMatchName: String?
    let bestMatchCardId: String?
    let bestMatchSetCode: String?
    let bestMatchSetName: String?
    let confidence: Double?
    let strategy: String?
    let alternatives: [String]
    let imageFile: String
}

struct RecordedScanBundle: Codable {
    struct Summary: Codable {
        let capturedAt: String
        let frameCount: Int
        let mode: String
        let pipeline: String
        let app: String
    }
    let summary: Summary
    let frames: [RecordedScanFrame]
}

// MARK: - Log model

enum DebugLogLevel {
    case info, success, warn, error

    var color: Color {
        switch self {
        case .info: return .secondary
        case .success: return .green
        case .warn: return .orange
        case .error: return .red
        }
    }
}

struct DebugLogEntry: Identifiable {
    let id = UUID()
    let time: Date
    let level: DebugLogLevel
    let message: String
}

// MARK: - Detected quad (normalized Vision corners, origin bottom-left)

struct DetectedQuad {
    let topLeft: CGPoint
    let topRight: CGPoint
    let bottomLeft: CGPoint
    let bottomRight: CGPoint
    let confidence: Float

    init(observation: VNRectangleObservation) {
        topLeft = observation.topLeft
        topRight = observation.topRight
        bottomLeft = observation.bottomLeft
        bottomRight = observation.bottomRight
        confidence = observation.confidence
    }

    /// Map normalized (origin bottom-left) corners into SwiftUI view space
    /// (origin top-left). NOTE: the preview uses `.resizeAspectFill`, so when the
    /// camera aspect ratio differs from the view this is approximate (the fill
    /// crops overflow). Good enough to confirm the model is locking onto the
    /// card; fine-tune the mapping on-device if you need pixel accuracy.
    func points(in size: CGSize) -> [CGPoint] {
        func map(_ p: CGPoint) -> CGPoint {
            CGPoint(x: p.x * size.width, y: (1 - p.y) * size.height)
        }
        return [map(topLeft), map(topRight), map(bottomRight), map(bottomLeft)]
    }
}

// MARK: - View model

@MainActor
final class ScannerDebugViewModel: ObservableObject {
    let cameraController = CardScannerCameraController()
    /// Full local-first pipeline (artwork → embedding → pHash → server fallback).
    private let fullCoordinator = CardScannerCoordinator.makeDefault()
    /// On-device DINOv2 embedding ONLY — CoreML encoder + bundled vector index +
    /// collector-number OCR. No server, no auth. This is the "new embedding model"
    /// running fully offline.
    private let embeddingCoordinator = CardScannerCoordinator(
        strategies: [BoardCardEmbeddingScannerStrategy()],
        apiService: APIService()
    )
    /// `.automatic` keeps the local-first flow (server engines are photo-only).
    private let engine: ScanEnginePreference = .automatic

    @Published var isRunning = false
    @Published var quad: DetectedQuad?
    @Published var latestResult: CardScanResult?
    @Published var logs: [DebugLogEntry] = []
    @Published var frameCount = 0
    @Published var lastFrameMs: Double = 0
    @Published var statusMessage = "Idle — press Start to run the pipeline."
    @Published var mode: ScanMode = .pokemon { didSet { quad = nil } }
    /// On by default: showcase the on-device DINOv2 embedding model, server-free.
    @Published var embeddingOnly = true
    @Published var throttle: Double = 0.7

    // ---- recording (exportable run) ----
    @Published var isRecording = false
    @Published var recordedFrameCount = 0

    private var recordedFrames: [RecordedScanFrame] = []
    private var recordingSessionDir: URL?
    private var recordingStart = Date()
    /// Cap retained frames so a long session can't fill disk.
    private let maxRecordedFrames = 400

    private weak var environmentStore: EnvironmentStore?
    private var lastAnalysis = Date.distantPast
    private var isAnalyzing = false
    private let isSimulator: Bool

    private let maxLogs = 200

    init() {
#if targetEnvironment(simulator)
        isSimulator = true
#else
        isSimulator = false
#endif
        cameraController.onSampleBuffer = { [weak self] sampleBuffer in
            Task { await self?.handle(sampleBuffer) }
        }
    }

    func configure(environment: EnvironmentStore) {
        environmentStore = environment
    }

    func start() {
        guard !isSimulator else {
            statusMessage = "Camera is unavailable in the Simulator — run on a device."
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            beginRunning()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    guard let self else { return }
                    if granted { self.beginRunning() }
                    else { self.statusMessage = "Camera access denied. Enable it in Settings." }
                }
            }
        case .denied, .restricted:
            statusMessage = "Camera access denied. Enable it in Settings."
        @unknown default:
            statusMessage = "Camera access unavailable."
        }
    }

    private func beginRunning() {
        cameraController.configureIfNeeded()
        cameraController.startRunning()
        isRunning = true
        let path = embeddingOnly ? "on-device embedding (no server)" : "full pipeline"
        statusMessage = "Running — \(mode.displayName) · \(path)"
        log(.info, "Started · mode=\(mode.displayName) · \(path)")
    }

    func stop() {
        guard isRunning else { return }
        cameraController.stopRunning()
        isRunning = false
        statusMessage = "Stopped."
        log(.info, "Stopped after \(frameCount) frames")
    }

    func clearLogs() {
        logs.removeAll()
        frameCount = 0
    }

    // MARK: - Recording

    func setRecording(_ on: Bool) {
        isRecording = on
        if on {
            startNewRecordingSession()
            log(.info, "Recording started — analyzed frames will be saved for export.")
        } else {
            log(.info, "Recording paused (\(recordedFrames.count) frames kept).")
        }
    }

    func clearRecording() {
        recordedFrames.removeAll()
        recordedFrameCount = 0
        if let dir = recordingSessionDir {
            try? FileManager.default.removeItem(at: dir)
        }
        recordingSessionDir = nil
    }

    private func startNewRecordingSession() {
        clearRecording()
        recordingStart = Date()
        _ = ensureRecordingSessionDir()
    }

    private func ensureRecordingSessionDir() -> URL? {
        if let dir = recordingSessionDir { return dir }
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("scan-debug-\(UUID().uuidString)", isDirectory: true)
        let frames = base.appendingPathComponent("frames", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: frames, withIntermediateDirectories: true)
            recordingSessionDir = base
            return base
        } catch {
            log(.error, "Could not create recording folder: \(error.localizedDescription)")
            return nil
        }
    }

    private func appendRecordedFrame(
        jpeg: Data,
        scan: Result<CardScanResult, CardScannerError>,
        quad: DetectedQuad?,
        detectedCount: Int,
        segmentationConfidence: Float?,
        elapsedMs: Double,
        mode: String,
        pipeline: String
    ) {
        guard recordedFrames.count < maxRecordedFrames else { return }
        guard let dir = ensureRecordingSessionDir() else { return }

        let index = recordedFrames.count + 1
        let fileName = String(format: "frames/frame-%04d.jpg", index)
        do {
            try jpeg.write(to: dir.appendingPathComponent(fileName))
        } catch {
            log(.error, "Failed to save frame image: \(error.localizedDescription)")
            return
        }

        var identified = false
        var name: String?
        var cardId: String?
        var setCode: String?
        var setName: String?
        var confidence: Double?
        var strategy: String?
        var alternatives: [String] = []
        if case .success(let result) = scan {
            identified = true
            let candidate = result.primary
            name = candidate.details.identity.name
            cardId = candidate.details.identity.id
            setCode = candidate.details.identity.setCode
            setName = candidate.details.identity.setName
            confidence = candidate.confidence.score
            strategy = candidate.originatingStrategy.displayName
            alternatives = result.alternatives.prefix(5).map { $0.details.identity.name }
        }

        let quadPoints: [[Double]]? = quad.map { q in
            [
                [Double(q.topLeft.x), Double(q.topLeft.y)],
                [Double(q.topRight.x), Double(q.topRight.y)],
                [Double(q.bottomRight.x), Double(q.bottomRight.y)],
                [Double(q.bottomLeft.x), Double(q.bottomLeft.y)],
            ]
        }

        recordedFrames.append(
            RecordedScanFrame(
                index: index,
                timestampSeconds: Date().timeIntervalSince(recordingStart),
                mode: mode,
                pipeline: pipeline,
                elapsedMs: elapsedMs,
                detectedCount: detectedCount,
                segmentationConfidence: segmentationConfidence.map(Double.init),
                quad: quadPoints,
                identified: identified,
                bestMatchName: name,
                bestMatchCardId: cardId,
                bestMatchSetCode: setCode,
                bestMatchSetName: setName,
                confidence: confidence,
                strategy: strategy,
                alternatives: alternatives,
                imageFile: fileName
            )
        )
        recordedFrameCount = recordedFrames.count
    }

    /// Write `results.json` into the session folder and zip the whole thing for
    /// sharing. The returned URL is a `.zip` in the temporary directory.
    func buildRecordingExport() throws -> URL {
        guard !recordedFrames.isEmpty, let dir = recordingSessionDir else {
            throw NSError(
                domain: "ScannerDebug", code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Nothing recorded yet — start recording and run the scanner first."]
            )
        }

        let bundle = RecordedScanBundle(
            summary: RecordedScanBundle.Summary(
                capturedAt: ISO8601DateFormatter().string(from: recordingStart),
                frameCount: recordedFrames.count,
                mode: mode.displayName,
                pipeline: embeddingOnly ? "embedding-only (DINOv2 + OCR)" : "full local-first",
                app: "TCGer iOS Scanner Debug"
            ),
            frames: recordedFrames
        )

        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let jsonData = try encoder.encode(bundle)
        try jsonData.write(to: dir.appendingPathComponent("results.json"))

        return try ScannerDebugViewModel.zipDirectory(dir)
    }

    /// Zip a directory into a single `.zip` using the OS file coordinator.
    nonisolated private static func zipDirectory(_ directory: URL) throws -> URL {
        let coordinator = NSFileCoordinator()
        var coordinatorError: NSError?
        var result: Result<URL, Error>?

        coordinator.coordinate(
            readingItemAt: directory,
            options: [.forUploading],
            error: &coordinatorError
        ) { zippedURL in
            let destination = FileManager.default.temporaryDirectory
                .appendingPathComponent("\(directory.lastPathComponent).zip")
            do {
                try? FileManager.default.removeItem(at: destination)
                try FileManager.default.copyItem(at: zippedURL, to: destination)
                result = .success(destination)
            } catch {
                result = .failure(error)
            }
        }

        if let coordinatorError { throw coordinatorError }
        switch result {
        case .success(let url): return url
        case .failure(let error): throw error
        case .none:
            throw NSError(
                domain: "ScannerDebug", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Failed to package the recording."]
            )
        }
    }

    /// Encode a frame as JPEG, downscaled so exports stay reasonable in size.
    nonisolated static func makeJPEG(
        from cgImage: CGImage,
        maxDimension: Int = 1280,
        quality: CGFloat = 0.6
    ) -> Data? {
        let longest = max(cgImage.width, cgImage.height)
        guard longest > maxDimension else {
            return UIImage(cgImage: cgImage).jpegData(compressionQuality: quality)
        }
        let scale = CGFloat(maxDimension) / CGFloat(longest)
        let width = Int(CGFloat(cgImage.width) * scale)
        let height = Int(CGFloat(cgImage.height) * scale)
        guard
            let context = CGContext(
                data: nil,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: 0,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            )
        else {
            return UIImage(cgImage: cgImage).jpegData(compressionQuality: quality)
        }
        context.interpolationQuality = .medium
        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let scaled = context.makeImage() else {
            return UIImage(cgImage: cgImage).jpegData(compressionQuality: quality)
        }
        return UIImage(cgImage: scaled).jpegData(compressionQuality: quality)
    }

    func log(_ level: DebugLogLevel, _ message: String) {
        logs.append(DebugLogEntry(time: Date(), level: level, message: message))
        if logs.count > maxLogs {
            logs.removeFirst(logs.count - maxLogs)
        }
    }

    private func handle(_ sampleBuffer: CMSampleBuffer) async {
        guard isRunning, !isSimulator, !isAnalyzing else { return }
        let now = Date()
        guard now.timeIntervalSince(lastAnalysis) >= throttle else { return }
        guard let environmentStore else { return }

        isAnalyzing = true
        lastAnalysis = now

        let context = CardScannerContext(
            mode: mode,
            enginePreference: engine,
            serverConfiguration: environmentStore.serverConfiguration,
            authToken: environmentStore.authToken,
            showPricing: environmentStore.showPricing,
            saveDebugCapture: false,
            captureNotes: nil,
            setCode: nil
        )
        let coordinator = embeddingOnly ? embeddingCoordinator : fullCoordinator
        let started = Date()
        let recording = isRecording
        let modeName = mode.displayName
        let pipelineName = embeddingOnly ? "embedding-only (DINOv2 + OCR)" : "full local-first"

        Task.detached(priority: .userInitiated) { [weak self] in
            guard let cgImage = ScannerDebugViewModel.makeCGImage(from: sampleBuffer) else {
                await MainActor.run { self?.isAnalyzing = false }
                return
            }

            // 1. Segmentation (same detector the strategies use for cropping).
            let cropper = CardCropper()
            let observations = (try? cropper.detectRectangles(in: cgImage)) ?? []
            let best = observations.max(by: { $0.confidence < $1.confidence })
            let quad = best.map(DetectedQuad.init(observation:))
            let detectedCount = observations.count
            let bestConfidence = best?.confidence

            // 2. Identification (the real live-scan path).
            let scan = await coordinator.scan(image: cgImage, context: context, source: .livePreview)
            let elapsed = Date().timeIntervalSince(started)

            let jpegData = recording ? ScannerDebugViewModel.makeJPEG(from: cgImage) : nil

            await MainActor.run {
                guard let self else { return }
                self.quad = quad
                self.frameCount += 1
                self.lastFrameMs = elapsed * 1000

                if let bestConfidence {
                    self.log(.info, String(format: "seg %.0f%% · %d found", bestConfidence * 100, detectedCount))
                } else {
                    self.log(.warn, "no card segmented")
                }

                switch scan {
                case .success(let result):
                    self.latestResult = result
                    let candidate = result.primary
                    self.log(
                        .success,
                        String(
                            format: "%@ @%.0f%% · %@ · %.0fms",
                            candidate.details.identity.name,
                            candidate.confidence.score * 100,
                            candidate.originatingStrategy.displayName,
                            result.elapsed * 1000
                        )
                    )
                case .failure(let error):
                    if case .noMatch = error {
                        self.log(.warn, "no match")
                    } else {
                        self.log(.error, error.errorDescription ?? error.localizedDescription)
                    }
                }

                if recording, let jpegData {
                    self.appendRecordedFrame(
                        jpeg: jpegData,
                        scan: scan,
                        quad: quad,
                        detectedCount: detectedCount,
                        segmentationConfidence: bestConfidence,
                        elapsedMs: elapsed * 1000,
                        mode: modeName,
                        pipeline: pipelineName
                    )
                }

                self.isAnalyzing = false
            }
        }
    }

    nonisolated private static func makeCGImage(from sampleBuffer: CMSampleBuffer) -> CGImage? {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }
        var cgImage: CGImage?
        let status = VTCreateCGImageFromCVPixelBuffer(pixelBuffer, options: nil, imageOut: &cgImage)
        if status == kCVReturnSuccess, let cgImage { return cgImage }
        return nil
    }
}

// MARK: - View

struct ScannerDebugView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @StateObject private var viewModel = ScannerDebugViewModel()

    @State private var exportURL: URL?
    @State private var showingExport = false
    @State private var exportError: String?

    var body: some View {
        VStack(spacing: 0) {
            cameraPane
            controls
            Divider()
            identificationPane
            Divider()
            logPane
        }
        .navigationTitle("Scanner Debug")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { viewModel.configure(environment: environmentStore) }
        .onDisappear { viewModel.stop() }
        .sheet(isPresented: $showingExport) {
            if let url = exportURL {
                ScanDebugShareSheet(url: url)
            }
        }
        .alert(
            "Export Failed",
            isPresented: Binding(
                get: { exportError != nil },
                set: { if !$0 { exportError = nil } }
            )
        ) {
            Button("OK", role: .cancel) { exportError = nil }
        } message: {
            Text(exportError ?? "")
        }
    }

    private var cameraPane: some View {
        ZStack {
            Color.black
            CardScannerCameraPreview(controller: viewModel.cameraController)
            GeometryReader { geo in
                if let quad = viewModel.quad {
                    Path { path in
                        let pts = quad.points(in: geo.size)
                        guard let first = pts.first else { return }
                        path.move(to: first)
                        for pt in pts.dropFirst() { path.addLine(to: pt) }
                        path.closeSubpath()
                    }
                    .stroke(Color.green, lineWidth: 2)
                }
            }
            .allowsHitTesting(false)

            VStack {
                HStack {
                    Text(viewModel.isRunning ? "● LIVE" : "○ IDLE")
                        .font(.caption.weight(.bold))
                        .foregroundColor(viewModel.isRunning ? .green : .white.opacity(0.7))
                    Spacer()
                    Text("\(viewModel.frameCount) frames · \(Int(viewModel.lastFrameMs))ms")
                        .font(.caption.monospacedDigit())
                        .foregroundColor(.white.opacity(0.8))
                }
                .padding(8)
                .background(Color.black.opacity(0.35))
                Spacer()
            }
        }
        .frame(height: 320)
        .clipped()
    }

    private var controls: some View {
        VStack(spacing: 10) {
            HStack {
                Button {
                    viewModel.isRunning ? viewModel.stop() : viewModel.start()
                } label: {
                    Label(
                        viewModel.isRunning ? "Stop" : "Start",
                        systemImage: viewModel.isRunning ? "stop.fill" : "play.fill"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(viewModel.isRunning ? .red : .green)
            }

            Picker("Mode", selection: $viewModel.mode) {
                ForEach(ScanMode.allCases) { Text($0.displayName).tag($0) }
            }
            .pickerStyle(.segmented)

            Toggle(isOn: $viewModel.embeddingOnly) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("On-device embedding only")
                        .font(.subheadline)
                    Text("DINOv2 + OCR, fully offline (no server). Off = full local-first pipeline.")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            HStack {
                Text("Throttle")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Slider(value: $viewModel.throttle, in: 0.2...2.0, step: 0.1)
                Text(String(format: "%.1fs", viewModel.throttle))
                    .font(.caption.monospacedDigit())
                    .frame(width: 36, alignment: .trailing)
            }

            recordingControls

            Text(viewModel.statusMessage)
                .font(.caption)
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
    }

    private var recordingControls: some View {
        VStack(spacing: 8) {
            HStack {
                Button {
                    viewModel.setRecording(!viewModel.isRecording)
                } label: {
                    Label(
                        viewModel.isRecording ? "Recording" : "Record",
                        systemImage: viewModel.isRecording ? "record.circle.fill" : "record.circle"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .tint(viewModel.isRecording ? .red : .accentColor)

                Button {
                    exportRecording()
                } label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.recordedFrameCount == 0)
            }

            HStack {
                Text(viewModel.recordedFrameCount > 0
                    ? "\(viewModel.recordedFrameCount) frame\(viewModel.recordedFrameCount == 1 ? "" : "s") saved · images + results"
                    : "Record to save each analyzed frame and its result for later re-analysis.")
                    .font(.caption2)
                    .foregroundColor(.secondary)
                Spacer()
                if viewModel.recordedFrameCount > 0 {
                    Button("Clear") { viewModel.clearRecording() }
                        .font(.caption2)
                }
            }
        }
    }

    private func exportRecording() {
        do {
            exportURL = try viewModel.buildRecordingExport()
            showingExport = true
        } catch {
            exportError = error.localizedDescription
        }
    }

    private var identificationPane: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Identification")
                .font(.caption.weight(.semibold))
                .foregroundColor(.secondary)
            if let result = viewModel.latestResult {
                let candidate = result.primary
                HStack {
                    Text(candidate.details.identity.name)
                        .font(.subheadline.weight(.semibold))
                    Spacer()
                    Text(String(format: "%.0f%%", candidate.confidence.score * 100))
                        .font(.subheadline.monospacedDigit())
                        .foregroundColor(.green)
                }
                Text("\(candidate.originatingStrategy.displayName) · \(candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "—")")
                    .font(.caption)
                    .foregroundColor(.secondary)
                if !result.alternatives.isEmpty {
                    Text("Alts: " + result.alternatives.prefix(3).map { $0.details.identity.name }.joined(separator: ", "))
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }
            } else {
                Text("No identification yet.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }

    private var logPane: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Log")
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.secondary)
                Spacer()
                Button("Clear") { viewModel.clearLogs() }
                    .font(.caption)
            }
            .padding(.horizontal, 12)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(viewModel.logs) { entry in
                            HStack(alignment: .top, spacing: 6) {
                                Text(Self.timeFormatter.string(from: entry.time))
                                    .foregroundColor(.secondary)
                                Text(entry.message)
                                    .foregroundColor(entry.level.color)
                            }
                            .font(.system(.caption2, design: .monospaced))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id(entry.id)
                        }
                    }
                    .padding(.horizontal, 12)
                }
                .onChange(of: viewModel.logs.count) {
                    if let last = viewModel.logs.last {
                        withAnimation { proxy.scrollTo(last.id, anchor: .bottom) }
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
        .padding(.vertical, 8)
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()
}

// MARK: - Share sheet

/// Presents a recorded-run `.zip` via the system share sheet so it can be saved
/// to Files, AirDropped, or sent off-device for later re-analysis.
private struct ScanDebugShareSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

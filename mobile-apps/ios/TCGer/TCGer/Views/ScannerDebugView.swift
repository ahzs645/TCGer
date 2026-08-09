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
import UniformTypeIdentifiers
import VideoToolbox
@preconcurrency import Vision

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
    var isCameraAvailable: Bool { !isSimulator }

    private let maxLogs = 200

    init() {
#if targetEnvironment(simulator)
        isSimulator = true
        statusMessage = "Live capture requires a physical device. Replay tools remain available."
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

    func replay(_ replay: ScannerReplayImport) async throws -> ScannerReplayReport {
        guard let environmentStore else {
            throw NSError(
                domain: "ScannerDebug",
                code: 3,
                userInfo: [NSLocalizedDescriptionKey: "Scanner environment is unavailable."]
            )
        }
        if let recordedMode = ScanMode.allCases.first(where: {
            $0.rawValue.caseInsensitiveCompare(replay.recording.summary.mode) == .orderedSame
                || $0.displayName.caseInsensitiveCompare(replay.recording.summary.mode) == .orderedSame
        }) {
            mode = recordedMode
        }

        let context = CardScannerContext(
            mode: mode,
            enginePreference: .localOnly,
            serverConfiguration: environmentStore.serverConfiguration,
            authToken: environmentStore.authToken,
            showPricing: environmentStore.showPricing,
            saveDebugCapture: false,
            captureNotes: nil,
            setCode: nil
        )
        let coordinator = embeddingOnly ? embeddingCoordinator : fullCoordinator
        statusMessage = "Replaying \(replay.recording.frames.count) recorded frames…"
        let report = await CardScannerReplayRunner(coordinator: coordinator).run(
            replay: replay,
            context: context
        )
        statusMessage = String(
            format: "Replay complete · %.0f%% top-1 · %.0fms mean",
            report.accuracyRate * 100,
            report.meanLatencyMs
        )
        log(
            report.changedFrames == 0 ? .success : .warn,
            "replay \(report.processedFrames)/\(report.totalFrames) · top-1 \(Int(report.accuracyRate * 100))% · top-5 \(Int(report.topFiveRecall * 100))% · \(report.falsePositiveRegressions) false-positive · \(report.missRegressions) missed · \(report.strategyChangedFrames) strategy changes"
        )
        return report
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
        if on {
            startNewRecordingSession()
            isRecording = true
            log(.info, "Recording started — analyzed frames will be saved for export.")
        } else {
            isRecording = false
            log(.info, "Recording paused (\(recordedFrames.count) frames kept).")
        }
    }

    func clearRecording() {
        isRecording = false
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

#if targetEnvironment(simulator)
    /// Seeds the recorder with realistic local data so the export UI can be
    /// exercised end to end without a physical camera.
    func loadSampleRecording() throws {
        startNewRecordingSession()
        guard let dir = recordingSessionDir else {
            throw NSError(
                domain: "ScannerDebug", code: 5,
                userInfo: [NSLocalizedDescriptionKey: "Could not create the sample recording folder."]
            )
        }

        let colors: [UIColor] = [.systemYellow, .systemBlue, .systemPurple]
        var sampleFrames: [RecordedScanFrame] = []
        for index in 1...3 {
            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let renderer = UIGraphicsImageRenderer(
                size: CGSize(width: 480, height: 672),
                format: format
            )
            let image = renderer.image { context in
                colors[index - 1].setFill()
                context.fill(CGRect(x: 0, y: 0, width: 480, height: 672))
                UIColor.white.withAlphaComponent(0.88).setFill()
                UIBezierPath(
                    roundedRect: CGRect(x: 44, y: 52, width: 392, height: 568),
                    cornerRadius: 28
                ).fill()
                colors[index - 1].withAlphaComponent(0.3).setFill()
                UIBezierPath(ovalIn: CGRect(x: 110, y: 145, width: 260, height: 260)).fill()
            }
            guard let jpeg = image.jpegData(compressionQuality: 0.75) else {
                throw NSError(
                    domain: "ScannerDebug", code: 6,
                    userInfo: [NSLocalizedDescriptionKey: "Could not create a sample frame image."]
                )
            }

            let imageFile = String(format: "frames/frame-%04d.jpg", index)
            try jpeg.write(to: dir.appendingPathComponent(imageFile), options: .atomic)
            let identified = index < 3
            sampleFrames.append(RecordedScanFrame(
                index: index,
                timestampSeconds: Double(index - 1) * 0.7,
                mode: ScanMode.pokemon.displayName,
                pipeline: "simulator sample",
                elapsedMs: 42 + Double(index * 8),
                detectedCount: 1,
                segmentationConfidence: 0.94 - Double(index) * 0.03,
                quad: [[0.12, 0.91], [0.88, 0.9], [0.86, 0.08], [0.14, 0.09]],
                identified: identified,
                bestMatchName: identified ? "Sample Card \(index)" : nil,
                bestMatchCardId: identified ? "sample-card-\(index)" : nil,
                bestMatchSetCode: identified ? "SIM" : nil,
                bestMatchSetName: identified ? "Simulator Samples" : nil,
                confidence: identified ? 0.92 - Double(index) * 0.04 : nil,
                strategy: identified ? "Simulator sample" : nil,
                alternatives: identified ? ["Alternate Sample"] : [],
                alternativeCardIds: identified ? ["sample-alternate"] : [],
                expectedCardId: nil,
                expectedNoMatch: nil,
                imageFile: imageFile
            ))
        }

        recordedFrames = sampleFrames
        recordedFrameCount = sampleFrames.count
        isRecording = false
        log(.success, "Loaded \(sampleFrames.count) simulator sample frames for export testing.")
    }
#endif

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
        guard recordedFrames.count < maxRecordedFrames else {
            isRecording = false
            log(.warn, "Recording stopped at the \(maxRecordedFrames)-frame safety limit.")
            return
        }
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
        var alternativeCardIds: [String] = []
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
            alternativeCardIds = result.alternatives.prefix(5).map { $0.details.identity.id }
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
                alternativeCardIds: alternativeCardIds,
                expectedCardId: nil,
                expectedNoMatch: nil,
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
        try jsonData.write(to: dir.appendingPathComponent("results.json"), options: .atomic)

        let archiveURL = try ScannerDebugViewModel.packageDirectoryForExport(dir)
        let values = try archiveURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
        guard values.isRegularFile == true, (values.fileSize ?? 0) > 0 else {
            throw NSError(
                domain: "ScannerDebug", code: 4,
                userInfo: [NSLocalizedDescriptionKey: "The recording archive was created, but it is empty."]
            )
        }
        return archiveURL
    }

    /// Zip a directory into a single `.zip` using the OS file coordinator.
    nonisolated static func packageDirectoryForExport(_ directory: URL) throws -> URL {
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

    @State private var exportDocument: ScannerRecordingDocument?
    @State private var showingExport = false
    @State private var exportFilename = "TCGer Scanner Recording"
    @State private var exportConfirmation: String?
    @State private var shareArchive: ShareableArchive?
    @State private var toolError: String?
    @State private var showingReplayImporter = false
    @State private var isReplaying = false
    @State private var replayReport: ScannerReplayReport?
    @State private var assetItems: [ScannerAssetDiagnostics.Item] = []
    @State private var assetDiagnosticsPresentation: AssetDiagnosticsPresentation?

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 16) {
                cameraPane
                primaryActions
                assetsPane
                configurationPane
                recordingPane
                identificationPane
                if let replayReport {
                    replayReportPane(replayReport)
                }
                logPane
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Scanner Debug")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            viewModel.configure(environment: environmentStore)
            if assetItems.isEmpty {
                assetItems = ScannerAssetDiagnostics.run()
            }
        }
        .onDisappear { viewModel.stop() }
        .fileExporter(
            isPresented: $showingExport,
            document: exportDocument,
            contentType: .zip,
            defaultFilename: exportFilename
        ) { result in
            switch result {
            case .success(let url):
                exportConfirmation = "Saved \(url.lastPathComponent)"
                viewModel.log(.success, "exported \(url.lastPathComponent)")
            case .failure(let error):
                toolError = "Export failed: \(error.localizedDescription)"
            }
            exportDocument = nil
        }
        .sheet(item: $shareArchive) { archive in
            ShareSheet(items: [archive.url])
        }
        .sheet(item: $assetDiagnosticsPresentation) { presentation in
            ScannerAssetDiagnosticsSheet(items: presentation.items)
        }
        .fileImporter(
            isPresented: $showingReplayImporter,
            allowedContentTypes: [.folder, .json, .image],
            allowsMultipleSelection: true
        ) { result in
            switch result {
            case .success(let urls): importAndReplay(urls)
            case .failure(let error): toolError = error.localizedDescription
            }
        }
        .alert(
            "Scanner Tool Error",
            isPresented: Binding(
                get: { toolError != nil },
                set: { if !$0 { toolError = nil } }
            )
        ) {
            Button("OK", role: .cancel) { toolError = nil }
        } message: {
            Text(toolError ?? "")
        }
    }

    private var cameraPane: some View {
        ZStack {
            Color.black
            CardScannerCameraPreview(controller: viewModel.cameraController)
            if !viewModel.isCameraAvailable {
                VStack(spacing: 8) {
                    Image(systemName: "iphone.and.arrow.forward")
                        .font(.largeTitle)
                    Text("Device camera required")
                        .font(.subheadline.weight(.semibold))
                }
                .foregroundStyle(.white.opacity(0.55))
            }
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

            VStack(spacing: 0) {
                HStack {
                    Label(
                        viewModel.isRunning ? "Live" : "Idle",
                        systemImage: viewModel.isRunning ? "dot.radiowaves.left.and.right" : "camera.fill"
                    )
                    .font(.caption.weight(.bold))
                    .foregroundStyle(viewModel.isRunning ? .green : .white.opacity(0.75))
                    Spacer()
                    if viewModel.isRecording {
                        Label("REC", systemImage: "record.circle.fill")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.red)
                    }
                }
                .padding(12)

                Spacer()

                HStack(alignment: .bottom, spacing: 12) {
                    Text(viewModel.statusMessage)
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.9))
                        .lineLimit(2)
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        Text("\(viewModel.frameCount) frames")
                        Text("\(Int(viewModel.lastFrameMs)) ms")
                    }
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.8))
                }
                .padding(12)
                .background(.black.opacity(0.55))
            }
        }
        .frame(height: viewModel.isCameraAvailable ? 300 : 230)
        .clipped()
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .stroke(.white.opacity(0.1), lineWidth: 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scanner camera preview")
        .accessibilityValue(viewModel.statusMessage)
    }

    private var primaryActions: some View {
        HStack(spacing: 12) {
            Button {
                viewModel.isRunning ? viewModel.stop() : viewModel.start()
            } label: {
                Label(
                    scannerActionTitle,
                    systemImage: viewModel.isCameraAvailable
                        ? (viewModel.isRunning ? "stop.fill" : "play.fill")
                        : "iphone"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(viewModel.isRunning ? .red : .green)
            .controlSize(.large)
            .disabled(!viewModel.isCameraAvailable)

            Button {
                viewModel.setRecording(!viewModel.isRecording)
                exportConfirmation = nil
            } label: {
                Label(
                    viewModel.isRecording ? "Pause" : "Record",
                    systemImage: viewModel.isRecording ? "pause.fill" : "record.circle"
                )
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .tint(viewModel.isRecording ? .red : .accentColor)
            .controlSize(.large)
            .disabled(!viewModel.isCameraAvailable)
        }
    }

    private var scannerActionTitle: String {
        guard viewModel.isCameraAvailable else { return "Device Only" }
        return viewModel.isRunning ? "Stop Scanner" : "Start Scanner"
    }

    private var assetsPane: some View {
        DebugPanel(title: "Scanner Assets", systemImage: "shippingbox") {
            Button {
                assetDiagnosticsPresentation = AssetDiagnosticsPresentation(items: assetItems)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: assetFailureCount == 0 ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .font(.title3)
                        .foregroundStyle(assetFailureCount == 0 ? .green : .orange)

                    VStack(alignment: .leading, spacing: 2) {
                        Text(assetFailureCount == 0 ? "All assets ready" : assetIssueSummary)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        Text("View \(assetItems.count) diagnostic checks")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Spacer(minLength: 8)

                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(assetItems.isEmpty)
            .accessibilityLabel("Scanner asset diagnostics")
            .accessibilityValue(assetFailureCount == 0 ? "All assets ready" : assetIssueSummary)
            .accessibilityHint("Opens the complete scanner asset report")
        }
    }

    private var assetFailureCount: Int {
        assetItems.lazy.filter { !$0.isOK }.count
    }

    private var assetIssueSummary: String {
        "\(assetFailureCount) \(assetFailureCount == 1 ? "issue" : "issues") found"
    }

    private var configurationPane: some View {
        DebugPanel(title: "Scan Configuration", systemImage: "slider.horizontal.3") {
            Picker("Mode", selection: $viewModel.mode) {
                ForEach(ScanMode.allCases) { Text($0.displayName).tag($0) }
            }
            .pickerStyle(.segmented)
            .disabled(viewModel.isRunning)

            Toggle("Offline embedding only", isOn: $viewModel.embeddingOnly)
            .disabled(viewModel.isRunning)
            Text("DINOv2 + OCR. Turn this off to exercise the full local-first pipeline.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Analysis interval")
                        .font(.subheadline)
                    Spacer()
                    Text(String(format: "%.1f seconds", viewModel.throttle))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                Slider(value: $viewModel.throttle, in: 0.2...2.0, step: 0.1)
            }
        }
    }

    private var recordingPane: some View {
        DebugPanel(title: "Recording & Replay", systemImage: "record.circle") {
            HStack(spacing: 12) {
                StatItem(
                    title: "Saved frames",
                    value: "\(viewModel.recordedFrameCount)",
                    color: viewModel.recordedFrameCount == 0 ? .secondary : .blue
                )
                StatItem(
                    title: "Recorder",
                    value: viewModel.isRecording
                        ? "Active"
                        : (viewModel.recordedFrameCount > 0 ? "Paused" : "Idle"),
                    color: viewModel.isRecording ? .red : .secondary
                )
            }

            Text(viewModel.recordedFrameCount > 0
                 ? "The archive includes every saved frame plus results.json for regression testing."
                 : "Start recording, then run the scanner to capture analyzed frames and their results.")
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let exportConfirmation {
                Label(exportConfirmation, systemImage: "checkmark.circle.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.green)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            HStack(spacing: 10) {
                Button {
                    exportRecording()
                } label: {
                    Label("Save", systemImage: "square.and.arrow.down")
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.recordedFrameCount == 0)

                Button {
                    shareRecording()
                } label: {
                    Label("Share", systemImage: "square.and.arrow.up")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.recordedFrameCount == 0)

                Button {
                    viewModel.clearRecording()
                    exportConfirmation = nil
                } label: {
                    Label("Clear", systemImage: "trash")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(viewModel.recordedFrameCount == 0)
            }

            Button {
                showingReplayImporter = true
            } label: {
                if isReplaying {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Label("Replay Extracted Recording", systemImage: "arrow.triangle.2.circlepath")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .disabled(isReplaying || viewModel.isRunning)

            Text("To replay a saved archive, unzip it in Files and select the extracted folder.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            NavigationLink {
                ScannerReferenceBrowserView()
            } label: {
                Label("Browse Reference Sets", systemImage: "square.stack.3d.up")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Text("Step through a labeled reference folder one image at a time and compare each result against its expected card.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Divider()

            ScannerDevModeSection()

#if targetEnvironment(simulator)
            Button {
                do {
                    try viewModel.loadSampleRecording()
                    exportConfirmation = nil
                } catch {
                    toolError = error.localizedDescription
                }
            } label: {
                Label("Load Sample Recording", systemImage: "doc.badge.plus")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .accessibilityHint("Creates three local sample frames so Save Archive can be tested in Simulator.")
#endif
        }
    }

    private func exportRecording() {
        do {
            exportDocument = try ScannerRecordingDocument(
                fileURL: viewModel.buildRecordingExport()
            )
            exportFilename = "TCGer-Scanner-\(Self.exportDateFormatter.string(from: Date()))"
            exportConfirmation = nil
            showingExport = true
        } catch {
            toolError = "Export failed: \(error.localizedDescription)"
        }
    }

    private func shareRecording() {
        do {
            // Move the zip to a stable, human-readable filename so the share
            // sheet (AirDrop, Messages, Files) shows a meaningful name.
            let zip = try viewModel.buildRecordingExport()
            let named = FileManager.default.temporaryDirectory
                .appendingPathComponent("TCGer-Scanner-\(Self.exportDateFormatter.string(from: Date())).zip")
            try? FileManager.default.removeItem(at: named)
            try FileManager.default.moveItem(at: zip, to: named)
            exportConfirmation = nil
            shareArchive = ShareableArchive(url: named)
        } catch {
            toolError = "Share failed: \(error.localizedDescription)"
        }
    }

    private func importAndReplay(_ urls: [URL]) {
        isReplaying = true
        replayReport = nil
        Task {
            defer { isReplaying = false }
            do {
                let replay = try ScannerReplayDocumentLoader.load(urls: urls)
                replayReport = try await viewModel.replay(replay)
            } catch is CancellationError {
                return
            } catch {
                toolError = error.localizedDescription
            }
        }
    }

    private var identificationPane: some View {
        DebugPanel(title: "Latest Identification", systemImage: "rectangle.and.text.magnifyingglass") {
            if let result = viewModel.latestResult {
                let candidate = result.primary
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(candidate.details.identity.name)
                            .font(.headline)
                        Text(candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "Unknown set")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Text(String(format: "%.0f%%", candidate.confidence.score * 100))
                        .font(.title3.weight(.bold).monospacedDigit())
                        .foregroundStyle(confidenceColor(candidate.confidence.score))
                }

                Label(candidate.originatingStrategy.displayName, systemImage: "point.3.connected.trianglepath.dotted")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                if !result.alternatives.isEmpty {
                    Divider()
                    Text("Alternatives")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(Array(result.alternatives.prefix(3).enumerated()), id: \.offset) { _, alternative in
                        HStack {
                            Text(alternative.details.identity.name)
                                .lineLimit(1)
                            Spacer()
                            Text(String(format: "%.0f%%", alternative.confidence.score * 100))
                                .monospacedDigit()
                                .foregroundStyle(.secondary)
                        }
                        .font(.caption)
                    }
                }
            } else {
                ContentUnavailableView(
                    "No Result Yet",
                    systemImage: "rectangle.dashed",
                    description: Text("Start the scanner and hold a card inside the camera frame.")
                )
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func replayReportPane(_ report: ScannerReplayReport) -> some View {
        DebugPanel(title: "Replay Report", systemImage: "chart.bar.xaxis") {
            HStack(spacing: 12) {
                StatItem(
                    title: "Top 1",
                    value: String(format: "%.0f%%", report.accuracyRate * 100),
                    color: report.changedFrames == 0 ? .green : .orange
                )
                StatItem(
                    title: "Top 5",
                    value: String(format: "%.0f%%", report.topFiveRecall * 100),
                    color: .blue
                )
                StatItem(
                    title: "Changed",
                    value: "\(report.changedFrames)",
                    color: report.changedFrames == 0 ? .green : .orange
                )
            }

            Text(String(
                format: "%d/%d processed · %d false-positive · %d missed · %d strategy changes · %.0f ms mean / %.0f ms p95",
                report.processedFrames,
                report.totalFrames,
                report.falsePositiveRegressions,
                report.missRegressions,
                report.strategyChangedFrames,
                report.meanLatencyMs,
                report.p95LatencyMs
            ))
            .font(.caption.monospacedDigit())
            .foregroundStyle(.secondary)
        }
    }

    private var logPane: some View {
        DebugPanel(title: "Pipeline Log", systemImage: "text.alignleft") {
            if viewModel.logs.isEmpty {
                Text("Pipeline events will appear here once scanning starts.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LazyVStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(viewModel.logs.suffix(40).reversed())) { entry in
                        HStack(alignment: .top, spacing: 8) {
                            Circle()
                                .fill(entry.level.color)
                                .frame(width: 6, height: 6)
                                .padding(.top, 5)
                            Text(Self.timeFormatter.string(from: entry.time))
                                .foregroundStyle(.secondary)
                            Text(entry.message)
                                .foregroundStyle(entry.level.color)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .textSelection(.enabled)
                        }
                        .font(.system(.caption2, design: .monospaced))
                    }
                }
            }

            Button("Clear Log", systemImage: "trash") {
                viewModel.clearLogs()
            }
            .font(.caption)
            .disabled(viewModel.logs.isEmpty)
        }
    }

    private func confidenceColor(_ score: Double) -> Color {
        if score >= 0.85 { return .green }
        if score >= 0.65 { return .orange }
        return .red
    }

    private static let timeFormatter: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss.SSS"
        return f
    }()

    private static let exportDateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd-HHmmss"
        return f
    }()
}

// MARK: - Debug UI components

private struct DebugPanel<Content: View>: View {
    let title: String
    let systemImage: String
    @ViewBuilder let content: Content

    init(
        title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(title, systemImage: systemImage)
                .font(.headline)
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(Color.primary.opacity(0.06), lineWidth: 1)
        }
    }
}

private struct AssetDiagnosticsPresentation: Identifiable {
    let id = UUID()
    let items: [ScannerAssetDiagnostics.Item]
}

private struct ScannerAssetDiagnosticsSheet: View {
    @Environment(\.dismiss) private var dismiss

    let items: [ScannerAssetDiagnostics.Item]

    private var failureCount: Int {
        items.lazy.filter { !$0.isOK }.count
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(failureCount == 0 ? "All assets ready" : issueSummary)
                                .font(.headline)
                            Text("\(items.count) diagnostic checks")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: failureCount == 0 ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                            .foregroundStyle(failureCount == 0 ? .green : .orange)
                    }
                }

                Section {
                    ForEach(items) { item in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Image(systemName: item.isOK ? "checkmark.circle.fill" : "xmark.octagon.fill")
                                .foregroundStyle(item.isOK ? .green : .red)
                                .font(.caption)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.name)
                                    .font(.subheadline)
                                Text(item.detail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                } header: {
                    Text("Bundled Assets")
                } footer: {
                    if failureCount > 0 {
                        Text("Missing generated assets disable their scanner strategies. Regenerate with `bash scripts/ios-assets.sh build`, then rebuild the app.")
                    }
                }
            }
            .navigationTitle("Scanner Assets")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var issueSummary: String {
        "\(failureCount) \(failureCount == 1 ? "issue" : "issues") found"
    }
}

private struct ScannerRecordingDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.zip] }

    private let archiveData: Data

    init(fileURL: URL) throws {
        archiveData = try Data(contentsOf: fileURL, options: .mappedIfSafe)
        guard !archiveData.isEmpty else {
            throw CocoaError(.fileReadCorruptFile)
        }
    }

    init(configuration: ReadConfiguration) throws {
        guard let data = configuration.file.regularFileContents, !data.isEmpty else {
            throw CocoaError(.fileReadCorruptFile)
        }
        archiveData = data
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: archiveData)
    }
}

// MARK: - Archive sharing

private struct ShareableArchive: Identifiable {
    let id = UUID()
    let url: URL
}

private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

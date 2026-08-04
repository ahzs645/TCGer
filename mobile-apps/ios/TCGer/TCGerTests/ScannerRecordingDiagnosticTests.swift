import ImageIO
import Vision
import XCTest
@testable import TCGer

/// Diagnostic replay for a device scanner recording. Points at an extracted
/// recording folder on the host filesystem via the SCANNER_RECORDING_DIR
/// environment variable and runs every frame through the real embedding-only
/// pipeline (CardCropper → CoreML DINOv2 → gate → ANN → OCR), printing the
/// per-frame decision. Skips when the variable is absent so CI is unaffected.
@MainActor
final class ScannerRecordingDiagnosticTests: XCTestCase {
    func testReplayRecordingAgainstEmbeddingPipeline() async throws {
        guard let dir = ProcessInfo.processInfo.environment["SCANNER_RECORDING_DIR"] else {
            throw XCTSkip("Set SCANNER_RECORDING_DIR to an extracted recording folder to run.")
        }
        let root = URL(fileURLWithPath: dir, isDirectory: true)
        let replay = try ScannerReplayDocumentLoader.load(urls: [root])

        let strategy = BoardCardEmbeddingScannerStrategy()
        print("DIAG supports pokemon: \(strategy.supports(.pokemon))")
        print("DIAG encoder available: \(CardEmbeddingEncoder().isAvailable)")
        print("DIAG index available: \(AnnoyIndexStore().isAvailable)")
        print("DIAG supported games: \(CardIndexMetadataStore.shared.supportedGames)")
        print("DIAG gate loaded: \(CardFaceRejectionGate.loadBundled() != nil)")

        let coordinator = CardScannerCoordinator(
            strategies: [strategy],
            apiService: APIService()
        )
        let context = CardScannerContext(
            mode: .pokemon,
            enginePreference: .automatic,
            serverConfiguration: .onDevice,
            authToken: nil,
            showPricing: false,
            saveDebugCapture: false,
            captureNotes: nil,
            setCode: nil
        )

        _ = coordinator

        let cropper = CardCropper()
        let encoder = CardEmbeddingEncoder()
        let indexStore = AnnoyIndexStore()
        let metadataStore = CardIndexMetadataStore.shared
        let gate = CardFaceRejectionGate.loadBundled()
        let allowed = await metadataStore.indices(for: TCGGame.pokemon, setCode: nil)

        let cropDir = URL(fileURLWithPath: "/tmp/scanner-diag-crops", isDirectory: true)
        try? FileManager.default.createDirectory(at: cropDir, withIntermediateDirectories: true)

        func describe(_ o: VNRectangleObservation) -> String {
            String(
                format: "conf=%.2f TL(%.2f,%.2f) TR(%.2f,%.2f) BR(%.2f,%.2f) BL(%.2f,%.2f)",
                o.confidence,
                o.topLeft.x, o.topLeft.y, o.topRight.x, o.topRight.y,
                o.bottomRight.x, o.bottomRight.y, o.bottomLeft.x, o.bottomLeft.y
            )
        }

        func analyze(_ crop: CGImage, label: String, index: Int) async throws -> String {
            saveCrop(crop, to: cropDir.appendingPathComponent(String(format: "crop-%02d-%@.png", index, label)))
            let embedding = try await encoder.embedding(for: crop)
            let gateScore = gate?.cardFaceScore(for: embedding) ?? -1
            let matches = try await indexStore.nearestNeighbors(for: embedding, limit: 3, allowedIndices: allowed)
            var tops: [String] = []
            for match in matches {
                let entry = await metadataStore.entry(for: match.index)
                tops.append("\(entry?.cardId ?? "?")=\(String(format: "%.3f", 1 - match.distance))")
            }
            return "\(label): gate=\(String(format: "%.2f", gateScore)) top3 \(tops.joined(separator: ", "))"
        }

        for frame in replay.recording.frames.sorted(by: { $0.index < $1.index }).prefix(18) {
            guard let image = replay.images[frame.imageFile] else { continue }

            // What does Vision detect on this saved frame, per request type?
            let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
            let docRequest = VNDetectDocumentSegmentationRequest()
            try? handler.perform([docRequest])
            let doc = docRequest.results?.max(by: { $0.confidence < $1.confidence })
            print("DIAG frame \(frame.index) doc-seg: \(doc.map(describe) ?? "none")")
            if let recorded = frame.quad {
                print(String(
                    format: "DIAG frame %d recorded: TL(%.2f,%.2f) TR(%.2f,%.2f) BR(%.2f,%.2f) BL(%.2f,%.2f)",
                    frame.index,
                    recorded[0][0], recorded[0][1], recorded[1][0], recorded[1][1],
                    recorded[2][0], recorded[2][1], recorded[3][0], recorded[3][1]
                ))
            }

            var notes: [String] = []
            if let detected = doc,
               let crop = cropper.makeNormalizedCrop(from: image, observation: detected) {
                notes.append(try await analyze(crop, label: "detected", index: frame.index))
            }
            if let q = frame.quad {
                let recordedObservation = VNRectangleObservation(
                    requestRevision: VNDetectRectanglesRequestRevision1,
                    topLeft: CGPoint(x: q[0][0], y: q[0][1]),
                    bottomLeft: CGPoint(x: q[3][0], y: q[3][1]),
                    bottomRight: CGPoint(x: q[2][0], y: q[2][1]),
                    topRight: CGPoint(x: q[1][0], y: q[1][1])
                )
                if let crop = cropper.makeNormalizedCrop(from: image, observation: recordedObservation) {
                    notes.append(try await analyze(crop, label: "recorded", index: frame.index))
                }
            }
            print("DIAG frame \(frame.index) \(notes.joined(separator: " | "))")
        }
    }

    private func saveCrop(_ image: CGImage, to url: URL) {
        guard let dest = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dest, image, nil)
        CGImageDestinationFinalize(dest)
    }
}

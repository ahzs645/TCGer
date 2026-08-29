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

        let environment = ProcessInfo.processInfo.environment
        let mode = environment["SCANNER_RECORDING_MODE"]
            .flatMap(ScanMode.init(rawValue:)) ?? .pokemon
        let runtime = ScannerAssetStore.shared.runtime(for: mode.tcgGame)
        let encoder: CardEmbeddingEncoder
        let indexStore: AnnoyIndexStore
        let metadataStore: CardIndexMetadataStore
        if let runtime {
            encoder = CardEmbeddingEncoder(
                modelLoader: FileCardEmbeddingModelLoader(modelURL: runtime.modelURL)
            )
            indexStore = AnnoyIndexStore(fileURL: runtime.vectorsURL)
            metadataStore = CardIndexMetadataStore(fileURL: runtime.metadataURL)
        } else {
            encoder = CardEmbeddingEncoder()
            indexStore = AnnoyIndexStore()
            metadataStore = .shared
        }

        let strategy = BoardCardEmbeddingScannerStrategy(
            variant: .arcface,
            encoder: encoder,
            indexStore: indexStore,
            metadataStore: metadataStore,
            supportedModes: [mode]
        )
        print("DIAG supports \(mode.rawValue): \(strategy.supports(mode))")
        print("DIAG encoder available: \(encoder.isAvailable)")
        print("DIAG index available: \(indexStore.isAvailable)")
        print("DIAG supported games: \(metadataStore.supportedGames)")
        print("DIAG gate loaded: \(CardFaceRejectionGate.loadBundled() != nil)")

        let coordinator = CardScannerCoordinator(
            strategies: [strategy],
            apiService: APIService()
        )
        _ = coordinator

        let cropper = CardCropper()
        let gate = CardFaceRejectionGate.loadBundled()
        let allowed = await metadataStore.physicalCardIndices(
            for: mode.tcgGame,
            setCode: nil
        )

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

        let acceptedOnly = environment["SCANNER_RECORDING_ACCEPTED_ONLY"] == "1"
        let frames = replay.recording.frames
            .filter { ScanMode(rawValue: $0.mode) == mode }
            .filter { !acceptedOnly || $0.identified }
            .sorted(by: { $0.index < $1.index })
        for frame in frames {
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
                    topRight: CGPoint(x: q[1][0], y: q[1][1]),
                    bottomRight: CGPoint(x: q[2][0], y: q[2][1]),
                    bottomLeft: CGPoint(x: q[3][0], y: q[3][1])
                )
                if let crop = cropper.makeNormalizedCrop(from: image, observation: recordedObservation) {
                    notes.append(try await analyze(crop, label: "recorded", index: frame.index))
                    if let rotated = cropper.rotated180(crop) {
                        notes.append(try await analyze(
                            rotated,
                            label: "recorded180",
                            index: frame.index
                        ))
                    }
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

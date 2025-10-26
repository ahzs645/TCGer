import CoreGraphics
import Foundation

final class BoardCardEmbeddingScannerStrategy: ScanStrategy {
    private enum Configuration {
        static let maxNeighbors = 5
        static let minimumScore: Double = 0.15
        static let confidentScore: Double = 0.85
        static let distanceFloor: Double = 1e-4
    }

    let kind: ScanStrategyKind = .mlDetector
    let supportsLiveScanning: Bool = true

    private let cropper: CardCropper
    private let encoder: CardEmbeddingEncoder
    private let indexStore: ANNIndexProviding
    private let metadataStore: CardIndexMetadataStore

    init(
        cropper: CardCropper = CardCropper(),
        encoder: CardEmbeddingEncoder = CardEmbeddingEncoder(),
        indexStore: ANNIndexProviding = AnnoyIndexStore(),
        metadataStore: CardIndexMetadataStore = .shared
    ) {
        self.cropper = cropper
        self.encoder = encoder
        self.indexStore = indexStore
        self.metadataStore = metadataStore
    }

    func supports(_ mode: ScanMode) -> Bool {
        switch mode {
        case .pokemon, .mtg, .yugioh:
            return true
        }
    }

    func scan(
        image: CGImage,
        context: CardScannerContext,
        apiService: APIService
    ) async throws -> CardScanResult? {
        guard supports(context.mode) else {
            throw CardScannerError.ineligibleMode
        }

        let cropped = try cropper.bestCrop(from: image) ?? image
        let embedding = try await encoder.embedding(for: cropped)
        guard !embedding.isEmpty else { return nil }

        let matches: [ANNVectorMatch]
        do {
            matches = try await indexStore.nearestNeighbors(for: embedding, limit: Configuration.maxNeighbors)
        } catch {
            if error is AnnoyIndexStore.StoreError {
                return nil
            }
            throw CardScannerError.underlying(error)
        }
        guard !matches.isEmpty else { return nil }

        await metadataStore.loadIfNeeded()

        var candidates: [CardScanCandidate] = []
        for match in matches {
            guard let details = await metadataStore.details(for: match.index) else { continue }
            let score = scoreForDistance(match.distance)
            guard score >= Configuration.minimumScore else { continue }
            let candidate = CardScanCandidate(
                details: details,
                confidence: CardScanConfidence(score: score, reason: "ANN distance \(match.distance)"),
                originatingStrategy: kind,
                debugInfo: [
                    "distance": String(format: "%.4f", match.distance)
                ]
            )
            candidates.append(candidate)
        }

        guard let primary = candidates.max(by: { $0.confidence.score < $1.confidence.score }) else {
            return nil
        }

        let alternatives = candidates.filter { $0.id != primary.id }

        return CardScanResult(
            mode: context.mode,
            capturedImage: cropped,
            primary: primary,
            alternatives: alternatives,
            elapsed: 0
        )
    }

    private func scoreForDistance(_ distance: Double) -> Double {
        guard distance.isFinite else { return 0 }
        let normalized = max(Configuration.distanceFloor, distance)
        let score = 1 - min(normalized, 1)
        return min(max(score, Configuration.minimumScore), Configuration.confidentScore)
    }
}

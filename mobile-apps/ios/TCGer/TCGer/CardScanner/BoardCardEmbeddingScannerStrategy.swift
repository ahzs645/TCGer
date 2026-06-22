import CoreGraphics
import Foundation

final class BoardCardEmbeddingScannerStrategy: ScanStrategy {
    private enum Configuration {
        static let maxNeighbors = 5
        static let minimumVerifiedScore: Double = 0.65
        static let strongAcceptanceScore: Double = 0.70
        /// Run the OCR tiebreaker when the top-2 candidate scores are within this.
        static let ocrMargin: Double = 0.1
    }

    let kind: ScanStrategyKind = .mlDetector
    let supportsLiveScanning: Bool = true

    private let cropper: CardCropper
    private let encoder: CardEmbeddingEncoder
    private let indexStore: ANNIndexProviding
    private let metadataStore: CardIndexMetadataStore
    private let ocr: CollectorNumberOCR

    init(
        cropper: CardCropper = CardCropper(),
        encoder: CardEmbeddingEncoder = CardEmbeddingEncoder(),
        indexStore: ANNIndexProviding = AnnoyIndexStore(),
        metadataStore: CardIndexMetadataStore = .shared,
        ocr: CollectorNumberOCR = CollectorNumberOCR()
    ) {
        self.cropper = cropper
        self.encoder = encoder
        self.indexStore = indexStore
        self.metadataStore = metadataStore
        self.ocr = ocr
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
        source: ScanInvocationKind,
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
            guard score >= Configuration.minimumVerifiedScore else { continue }
            let candidate = CardScanCandidate(
                details: details,
                confidence: CardScanConfidence(score: score, reason: "ANN distance \(match.distance)"),
                originatingStrategy: kind,
                debugInfo: [
                    "distance": String(format: "%.4f", match.distance),
                    "similarity": String(format: "%.4f", score),
                    "strongThreshold": String(format: "%.2f", Configuration.strongAcceptanceScore),
                    "verifiedThreshold": String(format: "%.2f", Configuration.minimumVerifiedScore)
                ]
            )
            candidates.append(candidate)
        }

        let ranked = candidates.sorted { $0.confidence.score > $1.confidence.score }
        guard var primary = ranked.first else {
            return nil
        }

        // Collector-number OCR tiebreaker: when the top-2 are close (likely
        // near twins / same-art reprints), read the footer collector number and
        // promote the shortlist candidate it confirms. The embedding alone can't
        // split twins; only a clean "NNN/NNN" pair overrides it.
        var ocrVerified = false
        let needsOCRTiebreak = ranked.count >= 2 &&
            (ranked[0].confidence.score - ranked[1].confidence.score) < Configuration.ocrMargin
        let needsOCRVerification = primary.confidence.score < Configuration.strongAcceptanceScore
        if needsOCRTiebreak || needsOCRVerification {
            let ocrEligibleCandidates = ranked.filter { candidate in
                needsOCRVerification ||
                    (primary.confidence.score - candidate.confidence.score) < Configuration.ocrMargin
            }
            let pairNumbers = Set(ocr.readPairNumbers(from: cropped))
            if !pairNumbers.isEmpty,
               let matched = ocrEligibleCandidates.first(where: { candidate in
                   guard let cn = CollectorNumberOCR.collectorNumber(fromCardId: candidate.details.identity.id)
                   else { return false }
                   return pairNumbers.contains(cn)
               }) {
                let collectorNumber = CollectorNumberOCR.collectorNumber(fromCardId: matched.details.identity.id)
                primary = ocrVerifiedCandidate(matched, collectorNumber: collectorNumber)
                ocrVerified = true
            }
        }

        guard primary.confidence.score >= Configuration.strongAcceptanceScore || ocrVerified else {
            return nil
        }

        let alternatives = ranked.filter { $0.id != primary.id }

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
        // AnnoyIndexStore returns cosine distance (`1 - cosine`), so this is
        // cosine similarity on the same 0...1 scale used by the web matcher.
        return min(max(1 - distance, 0), 1)
    }

    private func ocrVerifiedCandidate(
        _ candidate: CardScanCandidate,
        collectorNumber: String?
    ) -> CardScanCandidate {
        var debugInfo = candidate.debugInfo
        debugInfo["ocrVerified"] = "true"
        if let collectorNumber {
            debugInfo["ocrCollectorNumber"] = collectorNumber
        }

        var reason = candidate.confidence.reason ?? "ANN embedding"
        if let collectorNumber {
            reason += ", OCR collector \(collectorNumber)"
        } else {
            reason += ", OCR collector match"
        }

        return CardScanCandidate(
            id: candidate.id,
            details: candidate.details,
            confidence: CardScanConfidence(score: candidate.confidence.score, reason: reason),
            originatingStrategy: candidate.originatingStrategy,
            debugInfo: debugInfo
        )
    }
}

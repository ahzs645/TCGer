import CoreGraphics
import Foundation
@preconcurrency import Vision

final class BoardCardEmbeddingScannerStrategy: ScanStrategy {
    private enum Configuration {
        static let maxNeighbors = 10
        /// Candidates below the normal acceptance threshold remain available
        /// only for exact OCR confirmation (for example, a readable 170/198).
        static let minimumEvidenceScore: Double = 0.55
        static let strongAcceptanceScore: Double = 0.72
        /// Run the OCR tiebreaker when the top-2 candidate scores are within this.
        static let ocrMargin: Double = 0.1
        /// Abstain when another printing trails the winner by less than this
        /// and collector OCR could not confirm the winner. This applies to
        /// same-name printings too: a correct name with the wrong set number is
        /// not an exact card match.
        static let ambiguityMargin: Double = 0.02
        /// Non-baseline crop attempts (alternate box, whole frame) must clear
        /// a slightly higher score. Extra hypotheses are recall-positive, but
        /// each one is another draw near the threshold for out-of-index cards;
        /// a wrong accept at 0.707 was measured on exactly this path. Applies
        /// only to plain-embedding accepts — OCR-verified results are exempt.
        static let retryAttemptMargin: Double = 0.02
    }

    let kind: ScanStrategyKind = .mlDetector
    let supportsLiveScanning: Bool = true

    private let cropper: CardCropper
    private let encoder: CardEmbeddingEncoder
    private let indexStore: ANNIndexProviding
    private let metadataStore: CardIndexMetadataStore
    private let ocr: CollectorNumberOCR
    private let titleOCR: CardTitleOCR
    private let rejectionGate: CardFaceRejectionGate?

    init(
        cropper: CardCropper = CardCropper(),
        encoder: CardEmbeddingEncoder = CardEmbeddingEncoder(),
        indexStore: ANNIndexProviding = AnnoyIndexStore(),
        metadataStore: CardIndexMetadataStore = .shared,
        ocr: CollectorNumberOCR = CollectorNumberOCR(),
        titleOCR: CardTitleOCR = CardTitleOCR(),
        rejectionGate: CardFaceRejectionGate? = CardFaceRejectionGate.loadBundled()
    ) {
        self.cropper = cropper
        self.encoder = encoder
        self.indexStore = indexStore
        self.metadataStore = metadataStore
        self.ocr = ocr
        self.titleOCR = titleOCR
        self.rejectionGate = rejectionGate
    }

    func supports(_ mode: ScanMode) -> Bool {
        encoder.isAvailable &&
            indexStore.isAvailable &&
            metadataStore.supportedGames.contains(mode.tcgGame)
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

        let attempts = try await makeCropAttempts(from: image, source: source)

        // Try the most card-like candidate first; on an abstention fall
        // through to the next. A retry can only recover an abstention — an
        // accepted result returns immediately, and every attempt faces the
        // same gate, OCR, and threshold policy — so extra candidates add
        // recall without loosening precision.
        var sawRejection = false
        for attempt in attempts {
            do {
                if let result = try await recognize(
                    attempt: attempt,
                    context: context,
                    source: source
                ) {
                    return result
                }
            } catch CardScannerError.rejectedInput {
                sawRejection = true
            }
        }
        // Every attempt abstained. Preserve the explicit open-set rejection if
        // any attempt positively identified a non-card, so the coordinator
        // does not let a looser fallback strategy answer instead.
        if sawRejection { throw CardScannerError.rejectedInput }
        return nil
    }

    /// One crop hypothesis for a frame, with its embedding and card-face
    /// score precomputed so candidates can be ordered before retrieval runs.
    private struct CropAttempt {
        let image: CGImage
        let embedding: [Float]
        let gateScore: Double?
        let kind: ScanDiagnostics.AttemptKind
        let quad: [[Double]]?
        /// True for the crop the pre-retry pipeline would have used (the best
        /// detected crop, or the raw frame when nothing was detected).
        var isBaseline: Bool = false
    }

    private func makeAttempt(
        for image: CGImage,
        kind: ScanDiagnostics.AttemptKind,
        quad: [[Double]]? = nil
    ) async throws -> CropAttempt? {
        let embedding = try await encoder.embedding(for: image)
        guard !embedding.isEmpty else { return nil }
        return CropAttempt(
            image: image,
            embedding: embedding,
            gateScore: rejectionGate?.cardFaceScore(for: embedding),
            kind: kind,
            quad: quad
        )
    }

    private func makeCropAttempts(
        from image: CGImage,
        source: ScanInvocationKind
    ) async throws -> [CropAttempt] {
        var attempts: [CropAttempt] = []
        let detailed = try cropper.detectRectanglesDetailed(in: image)
        var candidateObservations: [VNRectangleObservation] = []
        if let best = CardCropper.preferredObservation(from: detailed.observations) {
            candidateObservations.append(best)
        }
        // The alternate (plain detector box) and whole-frame hypotheses cost
        // an embedding each, so they are reserved for intentional captures;
        // live frames stay single-attempt and recover on a later frame.
        if source != .livePreview, let alternate = detailed.alternateBox {
            candidateObservations.append(alternate)
        }
        for (offset, observation) in candidateObservations.enumerated() {
            guard let crop = cropper.makeNormalizedCrop(from: image, observation: observation)
            else { continue }
            let quad = [
                observation.topLeft, observation.topRight,
                observation.bottomRight, observation.bottomLeft,
            ].map { [Double($0.x), Double($0.y)] }
            if var attempt = try await makeAttempt(for: crop, kind: .detectedCrop, quad: quad) {
                attempt.isBaseline = offset == 0
                attempts.append(attempt)
            }
        }

        // Any intentional still image can benefit from a whole-frame second
        // candidate: an import may already BE the card with no background,
        // and a shutter capture is guide-cropped so the frame is card-plus-
        // thin-border — in both cases a bad localization (interior panel,
        // unrectified diagonal) abstains and the whole frame recovers it.
        // Only the live path skips this: retries add latency per frame and a
        // later clear frame recovers naturally.
        if source != .livePreview,
           let wholeFrame = cropper.normalizedWholeImage(from: image),
           let attempt = try await makeAttempt(for: wholeFrame, kind: .wholeFrame) {
            attempts.append(attempt)
        }
        if attempts.count > 1 {
            attempts.sort {
                ($0.gateScore ?? -.greatestFiniteMagnitude) >
                    ($1.gateScore ?? -.greatestFiniteMagnitude)
            }
        }

        // No detection and no usable whole-frame candidate: embed the raw
        // frame, preserving the historical `bestCrop ?? image` behavior.
        if attempts.isEmpty, var fallback = try await makeAttempt(for: image, kind: .rawImage) {
            fallback.isBaseline = true
            attempts.append(fallback)
        }
        return attempts
    }

    private func recognize(
        attempt: CropAttempt,
        context: CardScannerContext,
        source: ScanInvocationKind
    ) async throws -> CardScanResult? {
        let cropped = attempt.image
        let embedding = attempt.embedding
        let gateScore = attempt.gateScore
        let gateRejected = gateScore.map { score in
            rejectionGate.map { score < $0.threshold } ?? false
        } ?? false

        // Dev-mode evidence draft: populated as the stages below run, and
        // flushed exactly once at whichever exit decides this attempt. All of
        // it is a no-op when no collector is attached.
        let diagnostics = context.diagnostics
        let attemptImageIndex = diagnostics?.registerAttemptImage(cropped) ?? -1
        var evidenceCandidates: [ScanDiagnostics.Candidate] = []
        var evidenceTitleName: String?
        var evidenceTitleCount: Int?
        var evidenceFooterPairs: [String] = []
        var evidenceOCRNumber: String?
        func recordOutcome(_ outcome: ScanDiagnostics.AttemptOutcome) {
            diagnostics?.record(ScanDiagnostics.Attempt(
                kind: attempt.kind,
                quad: attempt.quad,
                gateScore: gateScore,
                gateThreshold: rejectionGate?.threshold,
                topCandidates: evidenceCandidates,
                titleMatchedName: evidenceTitleName,
                titlePrintingCount: evidenceTitleCount,
                footerPairNumbers: evidenceFooterPairs,
                ocrVerifiedCollectorNumber: evidenceOCRNumber,
                outcome: outcome,
                imageIndex: attemptImageIndex
            ))
        }

        // Keep automatic live scanning lightweight and conservative. A later
        // clear frame can recover naturally; the more expensive OCR rescue is
        // reserved for an intentional shutter/photo capture.
        if gateRejected && source == .livePreview {
            recordOutcome(.rejectedInput)
            throw CardScannerError.rejectedInput
        }

        let allowedIndices = await metadataStore.indices(
            for: context.mode.tcgGame,
            setCode: context.setCode
        )
        guard !allowedIndices.isEmpty else {
            recordOutcome(.indexUnavailable)
            throw CardScannerError.ineligibleMode
        }

        let matches: [ANNVectorMatch]
        do {
            matches = try await indexStore.nearestNeighbors(
                for: embedding,
                limit: Configuration.maxNeighbors,
                allowedIndices: allowedIndices
            )
        } catch {
            if error is AnnoyIndexStore.StoreError {
                recordOutcome(.indexUnavailable)
                return nil
            }
            throw CardScannerError.underlying(error)
        }
        guard !matches.isEmpty else {
            recordOutcome(.noCandidates)
            return nil
        }

        var ranked = await makeCandidates(
            from: matches,
            game: context.mode.tcgGame,
            gateScore: gateScore
        )
        evidenceCandidates = ranked.prefix(5).map {
            ScanDiagnostics.Candidate(
                cardID: $0.details.identity.id,
                name: $0.details.identity.name,
                similarity: $0.confidence.score
            )
        }
        guard var primary = ranked.first else {
            if gateRejected {
                recordOutcome(.rejectedInput)
                throw CardScannerError.rejectedInput
            }
            recordOutcome(.noCandidates)
            return nil
        }

        // The gate is intentionally not an unconditional early return. It has
        // false negatives on foil/full-art cards. When the frame is rejected,
        // low-scoring, or printing-ambiguous, exact title OCR can constrain ANN
        // retrieval to one catalog name; collector OCR must still confirm any
        // gate override or close printing decision.
        let initialRival = ranked.first { $0.id != primary.id }
        let needsTitleEvidence = source != .livePreview && (
            gateRejected ||
                primary.confidence.score < Configuration.strongAcceptanceScore ||
                initialRival.map {
                    primary.confidence.score - $0.confidence.score < Configuration.ambiguityMargin
                } == true
        )
        var titlePrintingCount = 0
        var titleRunnerScore: Double?
        var titleConstrained = false
        if needsTitleEvidence {
            let titleCandidates = titleOCR.read(from: cropped)
            if let titleMatch = await metadataStore.exactNameMatch(
                for: titleCandidates,
                game: context.mode.tcgGame,
                setCode: context.setCode
            ) {
                let titleMatches = try await indexStore.nearestNeighbors(
                    for: embedding,
                    limit: Configuration.maxNeighbors,
                    allowedIndices: titleMatch.indices
                )
                let titleRanked = await makeCandidates(
                    from: titleMatches,
                    game: context.mode.tcgGame,
                    gateScore: gateScore,
                    titleVerifiedName: titleMatch.name
                )
                if let titlePrimary = titleRanked.first {
                    ranked = titleRanked
                    primary = titlePrimary
                    titlePrintingCount = titleMatch.indices.count
                    titleConstrained = true
                    titleRunnerScore = titleMatches.dropFirst().first.map {
                        scoreForDistance($0.distance)
                    }
                    evidenceTitleName = titleMatch.name
                    evidenceTitleCount = titleMatch.indices.count
                    evidenceCandidates = ranked.prefix(5).map {
                        ScanDiagnostics.Candidate(
                            cardID: $0.details.identity.id,
                            name: $0.details.identity.name,
                            similarity: $0.confidence.score
                        )
                    }
                }
            }
        }

        // Collector-number OCR tiebreaker: when the top-2 are close (likely
        // near twins / same-art reprints), read the footer collector number and
        // promote the shortlist candidate it confirms. The embedding alone can't
        // split twins; only a clean "NNN/NNN" pair overrides it.
        var ocrVerified = false
        let needsOCRTiebreak = ranked.count >= 2 &&
            (ranked[0].confidence.score - ranked[1].confidence.score) < Configuration.ocrMargin
        let needsOCRVerification = gateRejected ||
            primary.confidence.score < Configuration.strongAcceptanceScore
        if needsOCRTiebreak || needsOCRVerification {
            let ocrEligibleCandidates = ranked.filter { candidate in
                needsOCRVerification ||
                    (primary.confidence.score - candidate.confidence.score) < Configuration.ocrMargin
            }
            let reading = ocr.readFooter(from: cropped)
            evidenceFooterPairs = reading.pairNumbers
            let pairNumbers = Set(reading.pairNumbers)
            var matched = ocrEligibleCandidates.first { candidate in
                guard !pairNumbers.isEmpty,
                      let cn = CollectorNumberOCR.collectorNumber(fromCardId: candidate.details.identity.id)
                else { return false }
                return pairNumbers.contains(cn)
            }
            // Letter-prefixed promo numbers ("SWSH204") never print as
            // NNN/NNN, so without this branch the entire promo class was
            // structurally impossible to OCR-confirm.
            if matched == nil, !reading.promoCodes.isEmpty {
                let promoCodes = Set(reading.promoCodes)
                matched = ocrEligibleCandidates.first { candidate in
                    guard let cn = CollectorNumberOCR.collectorNumber(fromCardId: candidate.details.identity.id),
                          cn.contains(where: \.isLetter)
                    else { return false }
                    return promoCodes.contains(cn)
                }
            }
            // Fallback: slash-less digit runs ("079202" = 079/202). Accepted
            // only when every confirmed candidate agrees on ONE collector
            // number — ambiguity means abstain, never guess.
            if matched == nil, !reading.digitRuns.isEmpty {
                let confirmed = ocrEligibleCandidates.filter { candidate in
                    guard let cn = CollectorNumberOCR.collectorNumber(fromCardId: candidate.details.identity.id)
                    else { return false }
                    return CollectorNumberOCR.runsConfirm(number: cn, in: reading.digitRuns)
                }
                let distinctNumbers = Set(confirmed.compactMap {
                    CollectorNumberOCR.collectorNumber(fromCardId: $0.details.identity.id)
                })
                if distinctNumbers.count == 1 {
                    matched = confirmed.first
                }
            }
            if let matched {
                let collectorNumber = CollectorNumberOCR.collectorNumber(fromCardId: matched.details.identity.id)
                primary = ocrVerifiedCandidate(matched, collectorNumber: collectorNumber)
                ocrVerified = true
                evidenceOCRNumber = collectorNumber
            }
        }

        // A rejected card face may proceed when its exact collector number
        // confirms a shortlist printing, or when BOTH an exact catalog title
        // AND a strong (>= acceptance-threshold) visual match agree — the
        // gate has measured false negatives on hand-held sleeved captures
        // (0.29–0.47 on legitimate cards in device dev-mode sessions), and a
        // back, pack, or carpet produces neither a title match nor a 0.70+
        // similarity. Title evidence alone (without the strong score) is
        // still not enough. The same-name printing guards below still apply.
        if gateRejected && !ocrVerified {
            let titleBacked = titleConstrained
                && primary.confidence.score >= (attempt.isBaseline
                    ? Configuration.strongAcceptanceScore
                    : Configuration.strongAcceptanceScore + Configuration.retryAttemptMargin)
            if !titleBacked {
                recordOutcome(.rejectedInput)
                throw CardScannerError.rejectedInput
            }
        }

        let requiredScore = attempt.isBaseline
            ? Configuration.strongAcceptanceScore
            : Configuration.strongAcceptanceScore + Configuration.retryAttemptMargin
        guard primary.confidence.score >= requiredScore || ocrVerified else {
            recordOutcome(.belowAcceptanceThreshold)
            return nil
        }

        // A title proves the card name, not the printing. When that name has
        // multiple catalog rows, require either the printed collector number
        // or an exceptionally strong, well-separated visual printing match.
        // This prevents a modern Piplup frame, for example, from being labeled
        // as a visually similar 2007 Piplup simply because both share a title.
        if !ocrVerified, titlePrintingCount > 1 {
            guard primary.confidence.score >= 0.85,
                  let titleRunnerScore,
                  primary.confidence.score - titleRunnerScore >= 0.05
            else {
                recordOutcome(.titlePrintingUnresolved)
                return nil
            }
        }

        // Ambiguity guard: a near-tied runner-up that is a different card means
        // the embedding alone cannot tell the two apart on this frame. Without
        // OCR confirmation, abstain and let a cleaner frame decide.
        if !ocrVerified,
           let rival = ranked.first(where: { $0.id != primary.id }),
           primary.confidence.score - rival.confidence.score < Configuration.ambiguityMargin {
            recordOutcome(.printingAmbiguous)
            return nil
        }

        let alternatives = ranked.filter { $0.id != primary.id }
        recordOutcome(.accepted)

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

    private func makeCandidates(
        from matches: [ANNVectorMatch],
        game: TCGGame,
        gateScore: Double?,
        titleVerifiedName: String? = nil
    ) async -> [CardScanCandidate] {
        var candidates: [CardScanCandidate] = []
        for match in matches {
            guard let details = await metadataStore.details(for: match.index),
                  details.identity.game == game
            else { continue }
            let score = scoreForDistance(match.distance)
            guard score >= Configuration.minimumEvidenceScore else { continue }
            var debugInfo = [
                "distance": String(format: "%.4f", match.distance),
                "similarity": String(format: "%.4f", score),
                "strongThreshold": String(format: "%.2f", Configuration.strongAcceptanceScore),
                "evidenceThreshold": String(format: "%.2f", Configuration.minimumEvidenceScore)
            ]
            if let gateScore {
                debugInfo["cardFaceScore"] = String(format: "%.4f", gateScore)
            }
            if let titleVerifiedName {
                debugInfo["ocrTitle"] = titleVerifiedName
            }
            candidates.append(CardScanCandidate(
                details: details,
                confidence: CardScanConfidence(score: score, reason: "ANN distance \(match.distance)"),
                originatingStrategy: kind,
                debugInfo: debugInfo
            ))
        }
        return candidates.sorted { $0.confidence.score > $1.confidence.score }
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

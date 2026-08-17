import CoreGraphics
import Foundation
@preconcurrency import Vision

final class BoardCardEmbeddingScannerStrategy: ScanStrategy {
    private enum Configuration {
        static let maxNeighbors = 10
        /// Candidates below the normal acceptance threshold remain available
        /// only for exact OCR confirmation (for example, a readable 170/198).
        static let minimumEvidenceScore: Double = 0.55
        /// Device foil/blur evidence found two plain-visual wrong accepts at
        /// 0.70 while the canonical replay's weakest plain correct accept was
        /// 0.742. OCR-confirmed results remain eligible from 0.55.
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
        /// Footer-OCR cache: reuse the previous frame's reading only when the
        /// new crop's embedding is this close to the cached crop's. A steady
        /// card produces near-identical embeddings frame after frame; two
        /// different cards this close are near twins, and twins are exactly
        /// where a stale footer reading could confirm the wrong printing — so
        /// the bar is deliberately strict, and misses just re-run OCR.
        static let ocrCacheMinimumCosine: Float = 0.97
        /// And only within this window. Live analyses run ~1/s, so this
        /// covers a handful of frames of one steady card, not a card swap.
        static let ocrCacheLifetime: TimeInterval = 3.0
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

    /// Single-slot footer-OCR cache for "the card currently in front of the
    /// camera". A steady card re-reads the same footer at ~1/s through an
    /// `.accurate` Vision text request; the reading cannot change while the
    /// crop's embedding hasn't, so live frames reuse it and skip the request.
    /// Guarded by embedding cosine + a short lifetime rather than an
    /// invalidation web: this strategy never sees the no-card frames between
    /// two cards, so recency and similarity are the only trustworthy signals.
    private struct FooterOCRCacheEntry {
        let embedding: [Float]
        let reading: CollectorNumberOCR.FooterReading
        let readAt: Date
    }
    private let footerOCRCacheLock = NSLock()
    private var footerOCRCacheEntry: FooterOCRCacheEntry?

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

        let hypotheses = try await makeCropHypotheses(
            from: image,
            source: source,
            intrinsics: context.cameraIntrinsics
        )

        // Geometry can normalize a card to portrait, but it cannot determine
        // which short edge is the semantic top. Evaluate the 0- and 180-degree
        // versions as one hypothesis and choose only after both have passed
        // the normal gate, OCR, threshold, and ambiguity policy. Returning the
        // first accepted orientation would preserve a confident wrong result
        // from an upside-down crop even when its semantic counterpart is a much
        // stronger match.
        var sawRejection = false
        for hypothesis in hypotheses {
            var uprightResult: CardScanResult?
            var semantic180Result: CardScanResult?
            for attempt in hypothesis.orientations {
                do {
                    let result = try await recognize(
                        attempt: attempt,
                        context: context,
                        source: source
                    )
                    if attempt.isSemantic180 {
                        semantic180Result = result
                    } else {
                        uprightResult = result
                    }
                } catch CardScannerError.rejectedInput {
                    sawRejection = true
                }
            }
            if Self.shouldPreferSemantic180(
                uprightScore: uprightResult?.primary.confidence.score,
                semantic180Score: semantic180Result?.primary.confidence.score
            ) {
                return semantic180Result
            }
            if let uprightResult { return uprightResult }
            if let semantic180Result { return semantic180Result }
        }
        // Every geometry/orientation attempt abstained. Preserve the explicit
        // open-set rejection if any attempt positively identified a non-card,
        // so the coordinator does not let a looser fallback strategy answer.
        if sawRejection { throw CardScannerError.rejectedInput }
        return nil
    }

    /// A missing result represents an abstention, never a zero-confidence
    /// acceptance. Exact ties deliberately keep the original orientation.
    /// Internal so the semantic arbitration policy can be regression-tested
    /// without loading Core ML assets.
    static func shouldPreferSemantic180(
        uprightScore: Double?,
        semantic180Score: Double?
    ) -> Bool {
        guard let semantic180Score else { return false }
        guard let uprightScore else { return true }
        return semantic180Score > uprightScore
    }

    /// The two semantic orientations of one geometry-preserving crop. Crop
    /// hypotheses are ordered by card-face score, but orientations remain
    /// paired so a weaker wrong result can never short-circuit a stronger one.
    private struct CropHypothesis {
        let orientations: [CropAttempt]

        var bestGateScore: Double {
            orientations.compactMap(\.gateScore).max() ?? -.greatestFiniteMagnitude
        }
    }

    private func makeHypothesis(
        for image: CGImage,
        kind: ScanDiagnostics.AttemptKind,
        quad: [[Double]]? = nil,
        isBaseline: Bool
    ) async throws -> CropHypothesis? {
        guard var upright = try await makeAttempt(for: image, kind: kind, quad: quad) else {
            return nil
        }
        upright.isBaseline = isBaseline
        var orientations = [upright]
        if let rotated = cropper.rotated180(image),
           var semantic180 = try await makeAttempt(for: rotated, kind: kind, quad: quad) {
            // The extra orientation is another open-set retrieval draw, so it
            // uses the existing retry margin for unverified ANN acceptance.
            semantic180.isSemantic180 = true
            orientations.append(semantic180)
        }
        return CropHypothesis(orientations: orientations)
    }

    private func makeFallbackHypothesis(for image: CGImage) async throws -> CropHypothesis? {
        try await makeHypothesis(
            for: image,
            kind: .rawImage,
            isBaseline: true
        )
    }

    private func sortByGateScore(_ hypotheses: inout [CropHypothesis]) {
        if hypotheses.count > 1 {
            hypotheses.sort { $0.bestGateScore > $1.bestGateScore }
        }
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
        /// The geometry-preserving crop turned by 180 degrees to test the
        /// otherwise unknowable semantic top edge.
        var isSemantic180: Bool = false
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

    private func makeCropHypotheses(
        from image: CGImage,
        source: ScanInvocationKind,
        intrinsics: ScannerCameraIntrinsics?
    ) async throws -> [CropHypothesis] {
        var hypotheses: [CropHypothesis] = []
        let detailed = try cropper.detectRectanglesDetailed(
            in: image,
            intrinsics: intrinsics
        )
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
            if let hypothesis = try await makeHypothesis(
                for: crop,
                kind: .detectedCrop,
                quad: quad,
                isBaseline: offset == 0
            ) {
                hypotheses.append(hypothesis)
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
           let hypothesis = try await makeHypothesis(
               for: wholeFrame,
               kind: .wholeFrame,
               isBaseline: false
           ) {
            hypotheses.append(hypothesis)
        }
        sortByGateScore(&hypotheses)

        // No detection and no usable whole-frame candidate: embed the raw
        // frame, preserving the historical `bestCrop ?? image` behavior.
        if hypotheses.isEmpty, let fallback = try await makeFallbackHypothesis(for: image) {
            hypotheses.append(fallback)
        }
        return hypotheses
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
                imageIndex: attemptImageIndex,
                sourceCropPixelWidth: cropped.width,
                sourceCropPixelHeight: cropped.height,
                semanticOrientation: attempt.isSemantic180 ? .upsideDown : .upright
            ))
        }

        // Keep automatic live scanning lightweight and conservative. A later
        // clear frame can recover naturally; the more expensive OCR rescue is
        // reserved for an intentional shutter/photo capture.
        if gateRejected && source == .livePreview {
            recordOutcome(.rejectedInput)
            throw CardScannerError.rejectedInput
        }

        let allowedIndices = await metadataStore.physicalCardIndices(
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
                setCode: context.setCode,
                physicalCardsOnly: true
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
            let reading = footerReading(for: cropped, embedding: embedding, source: source)
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
        // back, pack, or carpet produces neither a title match nor a 0.72+
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

    /// Live-preview frames reuse the previous frame's footer reading when the
    /// crop embedding says it is the same steady card; intentional captures
    /// always read fresh. A cache hit only short-circuits the Vision request —
    /// every downstream confirmation rule runs unchanged on the reading.
    /// Internal (not private) so tests can exercise the cache policy directly.
    func footerReading(
        for cropped: CGImage,
        embedding: [Float],
        source: ScanInvocationKind
    ) -> CollectorNumberOCR.FooterReading {
        if source == .livePreview, let cached = cachedFooterReading(matching: embedding) {
            return cached
        }
        let fresh = ocr.readFooter(from: cropped)
        footerOCRCacheLock.lock()
        // The original read's timestamp is kept on reuse (see below), so a
        // steady card still re-reads every `ocrCacheLifetime` seconds.
        footerOCRCacheEntry = FooterOCRCacheEntry(
            embedding: embedding,
            reading: fresh,
            readAt: Date()
        )
        footerOCRCacheLock.unlock()
        return fresh
    }

    func cachedFooterReading(matching embedding: [Float]) -> CollectorNumberOCR.FooterReading? {
        footerOCRCacheLock.lock()
        defer { footerOCRCacheLock.unlock() }
        guard let entry = footerOCRCacheEntry else { return nil }
        guard Date().timeIntervalSince(entry.readAt) <= Configuration.ocrCacheLifetime else {
            footerOCRCacheEntry = nil
            return nil
        }
        guard Self.cosineSimilarity(entry.embedding, embedding) >= Configuration.ocrCacheMinimumCosine
        else { return nil }
        return entry.reading
    }

    private static func cosineSimilarity(_ a: [Float], _ b: [Float]) -> Float {
        guard a.count == b.count, !a.isEmpty else { return -1 }
        var dot: Float = 0
        var normA: Float = 0
        var normB: Float = 0
        for index in a.indices {
            dot += a[index] * b[index]
            normA += a[index] * a[index]
            normB += b[index] * b[index]
        }
        let denominator = (normA * normB).squareRoot()
        guard denominator > 0 else { return -1 }
        return dot / denominator
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

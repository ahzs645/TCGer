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
        // strongAcceptanceScore and ambiguityMargin moved to
        // ScannerEncoderVariant (they are per-encoder operating points, with
        // the same env overrides for sweeps); the strategy holds them as
        // instance values resolved at construction.
        /// Run the OCR tiebreaker when the top-2 candidate scores are within this.
        static let ocrMargin: Double = 0.1
        /// Non-baseline crop attempts (alternate box, whole frame) must clear
        /// a slightly higher score. Extra hypotheses are recall-positive, but
        /// each one is another draw near the threshold for out-of-index cards;
        /// a wrong accept at 0.707 was measured on exactly this path. Applies
        /// only to plain-embedding accepts — OCR-verified results are exempt.
        static let retryAttemptMargin: Double = 0.02
        /// When the card detector found a box covering at least this fraction
        /// of the frame, the whole-frame hypothesis is card PLUS background —
        /// its embedding is not evidence of a card and must not produce a
        /// plain-visual accept (Tranquil Cove accepted as Sandblast at
        /// 0.725/0.735 exactly this way, session 2026-08-29 23:37). Below
        /// this fraction the detection is noise (a 1%-of-frame box) and the
        /// frame is treated as effectively being the card, as for imports.
        static let credibleDetectionMinimumArea: CGFloat = 0.10
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
    /// Downloaded per-game runtimes opt out of `.automatic` until their
    /// cross-model open-set scores are calibrated against the other games.
    /// Bundled runtimes leave this nil and retain their historical behavior.
    private let supportedModes: Set<ScanMode>?
    /// Per-encoder operating points, resolved once at construction from the
    /// selected `ScannerEncoderVariant` (env overrides win for sweeps).
    private let strongAcceptanceScore: Double
    private let ambiguityMargin: Double
    /// Kept so `recognize` can resolve the per-game acceptance policy once
    /// the retrieved game is known (see `acceptancePolicy(for:)`).
    private let variant: ScannerEncoderVariant
    /// Policies declared by installed manifests (`acceptancePolicy`), keyed
    /// by game. Games without an entry run their built-in profile.
    private let declaredPolicies: [TCGGame: ScannerGameAcceptancePolicy]

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

    /// The variant selects model + index + thresholds + gate as one atomic
    /// bundle. Explicit `encoder`/`indexStore`/`rejectionGate` arguments (used
    /// by tests and replay tooling) override the variant's resolution.
    init(
        variant: ScannerEncoderVariant = .current,
        cropper: CardCropper = CardCropper(),
        encoder: CardEmbeddingEncoder? = nil,
        indexStore: ANNIndexProviding? = nil,
        metadataStore: CardIndexMetadataStore = .shared,
        ocr: CollectorNumberOCR = CollectorNumberOCR(),
        titleOCR: CardTitleOCR = CardTitleOCR(),
        rejectionGate: CardFaceRejectionGate? = nil,
        supportedModes: Set<ScanMode>? = nil,
        acceptancePolicies: [TCGGame: ScannerGameAcceptancePolicy] = [:]
    ) {
        self.cropper = cropper
        self.encoder = encoder ?? CardEmbeddingEncoder(
            modelLoader: BundleCardEmbeddingModelLoader(modelName: variant.embeddingModelName)
        )
        self.indexStore = indexStore ?? AnnoyIndexStore(resourceName: variant.indexResourceName)
        self.metadataStore = metadataStore
        self.ocr = ocr
        self.titleOCR = titleOCR
        self.supportedModes = supportedModes
        self.rejectionGate = rejectionGate
            ?? (variant.usesRejectionGate ? CardFaceRejectionGate.loadBundled() : nil)
        self.strongAcceptanceScore = variant.strongAcceptanceScore
        self.ambiguityMargin = variant.ambiguityMargin
        self.variant = variant
        self.declaredPolicies = acceptancePolicies
    }

    /// The acceptance policy this strategy applies to `game`: the manifest's
    /// declared policy when valid, else the built-in profile, with
    /// environment overrides last (see `ScannerGameAcceptancePolicy`).
    func acceptancePolicy(for game: TCGGame) -> ScannerGameAcceptancePolicy {
        ScannerGameAcceptancePolicy.resolve(
            game: game,
            declared: declaredPolicies[game],
            variant: variant
        )
    }

    func supports(_ mode: ScanMode) -> Bool {
        (supportedModes?.contains(mode) ?? true) &&
            encoder.isAvailable &&
            indexStore.isAvailable &&
            (mode == .automatic
                ? !metadataStore.supportedGames.isEmpty
                : metadataStore.supportedGames.contains(mode.tcgGame))
    }

    /// Forces every expensive lazy load the first shutter press would
    /// otherwise pay: the detector/Vision first-use cost, the embedding
    /// model load plus its ANE compilation (triggered by the first
    /// prediction, not the model load), the packed ANN index decode, and the
    /// catalog metadata decode. A blank frame is enough — the outputs are
    /// discarded; only the side-effectful loading matters.
    func warmUp() async {
        await warmUp(for: .pokemon)
    }

    func warmUp(for mode: ScanMode) async {
        guard supports(mode) else { return }
        guard encoder.isAvailable, indexStore.isAvailable else { return }
        guard let blank = Self.makeWarmUpImage() else { return }
        _ = try? cropper.detectRectanglesDetailed(in: blank, intrinsics: nil)
        let embedding = (try? await encoder.embedding(for: blank)) ?? []
        _ = await metadataStore.physicalCardIndices(for: mode.tcgGame, setCode: nil)
        _ = try? await indexStore.nearestNeighbors(
            for: embedding,
            limit: 1,
            allowedIndices: [0]
        )
    }

    private static func makeWarmUpImage() -> CGImage? {
        let side = 64
        guard let context = CGContext(
            data: nil,
            width: side,
            height: side,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
        ) else { return nil }
        context.setFillColor(CGColor(gray: 0.5, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: side, height: side))
        return context.makeImage()
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

        if ScannerPerfOptions.isStagedHypothesesEnabled {
            return try await stagedScan(image: image, context: context, source: source)
        }

        let hypotheses = try await makeCropHypotheses(
            from: image,
            source: source,
            intrinsics: context.cameraIntrinsics,
            diagnostics: context.diagnostics
        )

        var sawRejection = false
        for hypothesis in hypotheses {
            let verdict = try await evaluate(hypothesis, context: context, source: source)
            sawRejection = sawRejection || verdict.sawRejection
            if let result = verdict.result { return result }
        }
        // Every geometry/orientation attempt abstained. Preserve the explicit
        // open-set rejection if any attempt positively identified a non-card,
        // so the coordinator does not let a looser fallback strategy answer.
        if sawRejection { throw CardScannerError.rejectedInput }
        return nil
    }

    /// Staged variant (`ScannerPerfOptions.isStagedHypothesesEnabled`): crop
    /// candidates are built without embeddings and evaluated in fixed priority
    /// order — baseline detected crop, alternate detector box, whole frame —
    /// with each hypothesis embedded only when every earlier one abstained. A
    /// clean accept on the baseline crop therefore pays for one hypothesis
    /// (two orientations) instead of embedding all hypotheses up front. The
    /// trade against the legacy path is the loss of gate-score ordering across
    /// hypotheses, which requires replay validation.
    private func stagedScan(
        image: CGImage,
        context: CardScannerContext,
        source: ScanInvocationKind
    ) async throws -> CardScanResult? {
        let candidates = try makeCropCandidates(
            from: image,
            source: source,
            intrinsics: context.cameraIntrinsics,
            diagnostics: context.diagnostics
        )
        var sawRejection = false
        var evaluatedAnyHypothesis = false
        for candidate in candidates {
            guard let hypothesis = try await makeHypothesis(
                for: candidate.image,
                kind: candidate.kind,
                quad: candidate.quad,
                isBaseline: candidate.isBaseline,
                requiresEvidence: candidate.requiresEvidence
            ) else { continue }
            evaluatedAnyHypothesis = true
            let verdict = try await evaluate(hypothesis, context: context, source: source)
            sawRejection = sawRejection || verdict.sawRejection
            if let result = verdict.result { return result }
        }
        // Mirror the legacy path's last resort: when no crop hypothesis
        // materialized at all, embed the raw frame (`bestCrop ?? image`).
        if !evaluatedAnyHypothesis,
           let fallback = try await makeFallbackHypothesis(for: image) {
            let verdict = try await evaluate(fallback, context: context, source: source)
            sawRejection = sawRejection || verdict.sawRejection
            if let result = verdict.result { return result }
        }
        if sawRejection { throw CardScannerError.rejectedInput }
        return nil
    }

    /// The staged path's crop candidates: the same crops the legacy
    /// `makeCropHypotheses` builds, in fixed priority order, but without
    /// computing any embeddings yet.
    private struct CropCandidate {
        let image: CGImage
        let kind: ScanDiagnostics.AttemptKind
        let quad: [[Double]]?
        let isBaseline: Bool
        var requiresEvidence: Bool = false
    }

    private func makeCropCandidates(
        from image: CGImage,
        source: ScanInvocationKind,
        intrinsics: ScannerCameraIntrinsics?,
        diagnostics: ScanDiagnostics?
    ) throws -> [CropCandidate] {
        var candidates: [CropCandidate] = []
        let detectStarted = Date()
        let detailed = try cropper.detectRectanglesDetailed(
            in: image,
            intrinsics: intrinsics
        )
        diagnostics?.addStageTime(
            "detect",
            milliseconds: Date().timeIntervalSince(detectStarted) * 1_000
        )
        var candidateObservations: [VNRectangleObservation] = []
        if let best = CardCropper.preferredObservation(from: detailed.observations) {
            candidateObservations.append(best)
        }
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
            candidates.append(CropCandidate(
                image: crop,
                kind: .detectedCrop,
                quad: quad,
                isBaseline: offset == 0
            ))
        }
        if source != .livePreview,
           let wholeFrame = cropper.normalizedWholeImage(from: image) {
            candidates.append(CropCandidate(
                image: wholeFrame,
                kind: .wholeFrame,
                quad: nil,
                isBaseline: false,
                requiresEvidence: Self.wholeFrameRequiresEvidence(detectorBox: detailed.detectorBox)
            ))
        }
        return candidates
    }

    /// The whole frame is only card-shaped evidence when the detector saw no
    /// credible card box inside it; with a credible box the whole frame is
    /// card plus background, and only printed evidence may accept it.
    static func wholeFrameRequiresEvidence(detectorBox: CGRect?) -> Bool {
        guard let box = detectorBox else { return false }
        return box.width * box.height >= Configuration.credibleDetectionMinimumArea
    }

    private struct HypothesisVerdict {
        let result: CardScanResult?
        let sawRejection: Bool
    }

    // Geometry can normalize a card to portrait, but it cannot determine
    // which short edge is the semantic top. Evaluate the 0- and 180-degree
    // versions as one hypothesis and choose only after both have passed
    // the normal gate, OCR, threshold, and ambiguity policy. Returning the
    // first accepted orientation would preserve a confident wrong result
    // from an upside-down crop even when its semantic counterpart is a much
    // stronger match.
    /// One orientation's recognition, folded into a value so concurrent and
    /// serial evaluation share identical downstream handling.
    private enum OrientationOutcome {
        case result(CardScanResult?)
        case rejected
        /// Hub collapse: the crop's pixels are degenerate, so neither
        /// orientation of it may answer (the 180-degree twin of a collapsed
        /// crop accepted "Island" at 0.94 from a Tranquil Cove photo).
        case degenerate
        case failed(Error)
    }

    private func recognizeOutcome(
        attempt: CropAttempt,
        context: CardScannerContext,
        source: ScanInvocationKind
    ) async -> OrientationOutcome {
        do {
            return .result(try await recognize(
                attempt: attempt,
                context: context,
                source: source
            ))
        } catch CardScannerError.rejectedInput {
            return .rejected
        } catch CardScannerError.degenerateInput {
            return .degenerate
        } catch {
            return .failed(error)
        }
    }

    private func evaluate(
        _ hypothesis: CropHypothesis,
        context: CardScannerContext,
        source: ScanInvocationKind
    ) async throws -> HypothesisVerdict {
        var sawRejection = false
        var uprightResult: CardScanResult?
        var semantic180Result: CardScanResult?
        // Both orientations always run and arbitrate only afterwards, so the
        // pair is order-independent — running it concurrently changes wall
        // time, never the outcome. Serial evaluation remains for A/B runs.
        let outcomes: [(attempt: CropAttempt, outcome: OrientationOutcome)]
        if ScannerPerfOptions.isConcurrentOrientationsEnabled,
           hypothesis.orientations.count == 2 {
            let first = hypothesis.orientations[0]
            let second = hypothesis.orientations[1]
            async let firstOutcome = recognizeOutcome(
                attempt: first, context: context, source: source
            )
            async let secondOutcome = recognizeOutcome(
                attempt: second, context: context, source: source
            )
            outcomes = [(first, await firstOutcome), (second, await secondOutcome)]
        } else {
            var collected: [(CropAttempt, OrientationOutcome)] = []
            for attempt in hypothesis.orientations {
                collected.append((attempt, await recognizeOutcome(
                    attempt: attempt, context: context, source: source
                )))
            }
            outcomes = collected
        }
        for (attempt, outcome) in outcomes {
            switch outcome {
            case .result(let result):
                if attempt.isSemantic180 {
                    semantic180Result = result
                } else {
                    uprightResult = result
                }
            case .rejected:
                sawRejection = true
            case .degenerate:
                // A collapsed crop is discarded whole; a later hypothesis
                // (alternate box, whole frame) may still recover the card.
                return HypothesisVerdict(result: nil, sawRejection: sawRejection)
            case .failed(let error):
                throw error
            }
        }
        if Self.shouldPreferSemantic180(
            uprightScore: uprightResult?.primary.confidence.score,
            semantic180Score: semantic180Result?.primary.confidence.score
        ) {
            return HypothesisVerdict(result: semantic180Result, sawRejection: sawRejection)
        }
        return HypothesisVerdict(
            result: uprightResult ?? semantic180Result,
            sawRejection: sawRejection
        )
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
        isBaseline: Bool,
        requiresEvidence: Bool = false
    ) async throws -> CropHypothesis? {
        var hypothesis: CropHypothesis?
        if ScannerPerfOptions.isBatchedOrientationEnabled {
            hypothesis = try await makeBatchedHypothesis(
                for: image,
                kind: kind,
                quad: quad,
                isBaseline: isBaseline
            )
        } else if ScannerPerfOptions.isConcurrentOrientationsEnabled,
                  let rotated = cropper.rotated180(image) {
            async let uprightAttempt = makeAttempt(for: image, kind: kind, quad: quad)
            async let rotatedAttempt = makeAttempt(for: rotated, kind: kind, quad: quad)
            guard var upright = try await uprightAttempt else {
                _ = try? await rotatedAttempt
                return nil
            }
            upright.isBaseline = isBaseline
            var orientations = [upright]
            if var semantic180 = try await rotatedAttempt {
                semantic180.isSemantic180 = true
                orientations.append(semantic180)
            }
            hypothesis = CropHypothesis(orientations: orientations)
        } else {
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
            hypothesis = CropHypothesis(orientations: orientations)
        }
        guard var made = hypothesis else { return nil }
        if requiresEvidence {
            made = CropHypothesis(orientations: made.orientations.map {
                var attempt = $0
                attempt.requiresEvidence = true
                return attempt
            })
        }
        return made
    }

    /// Batched variant (`ScannerPerfOptions.isBatchedOrientationEnabled`):
    /// both orientations of one crop go through a single Core ML batch
    /// prediction. Outcome parity with the serial path: an empty upright
    /// embedding voids the hypothesis, and a failed 180° rotation or empty
    /// rotated embedding leaves an upright-only hypothesis.
    private func makeBatchedHypothesis(
        for image: CGImage,
        kind: ScanDiagnostics.AttemptKind,
        quad: [[Double]]?,
        isBaseline: Bool
    ) async throws -> CropHypothesis? {
        let rotated = cropper.rotated180(image)
        let images = [image] + (rotated.map { [$0] } ?? [])
        let embedStarted = Date()
        let embeddings = try await encoder.embeddings(for: images)
        // The batch is one request; attribute its wall time evenly so summed
        // per-attempt embedMs still totals the real cost.
        let embedMsPerImage = Date().timeIntervalSince(embedStarted) * 1_000 / Double(images.count)
        guard let uprightEmbedding = embeddings.first, !uprightEmbedding.isEmpty else {
            return nil
        }
        var upright = CropAttempt(
            image: image,
            embedding: uprightEmbedding,
            gateScore: rejectionGate?.cardFaceScore(for: uprightEmbedding),
            kind: kind,
            quad: quad,
            embedMs: embedMsPerImage
        )
        upright.isBaseline = isBaseline
        var orientations = [upright]
        if let rotated, embeddings.count == 2, !embeddings[1].isEmpty {
            var semantic180 = CropAttempt(
                image: rotated,
                embedding: embeddings[1],
                gateScore: rejectionGate?.cardFaceScore(for: embeddings[1]),
                kind: kind,
                quad: quad,
                embedMs: embedMsPerImage
            )
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
        /// True for a whole-frame crop taken while the detector saw a
        /// credible card box: only printed evidence may accept it.
        var requiresEvidence: Bool = false
        /// Wall time of this attempt's embedding (preprocess + inference).
        var embedMs: Double = 0
    }

    private func makeAttempt(
        for image: CGImage,
        kind: ScanDiagnostics.AttemptKind,
        quad: [[Double]]? = nil
    ) async throws -> CropAttempt? {
        let embedStarted = Date()
        let embedding = try await encoder.embedding(for: image)
        guard !embedding.isEmpty else { return nil }
        return CropAttempt(
            image: image,
            embedding: embedding,
            gateScore: rejectionGate?.cardFaceScore(for: embedding),
            kind: kind,
            quad: quad,
            embedMs: Date().timeIntervalSince(embedStarted) * 1_000
        )
    }

    private func makeCropHypotheses(
        from image: CGImage,
        source: ScanInvocationKind,
        intrinsics: ScannerCameraIntrinsics?,
        diagnostics: ScanDiagnostics?
    ) async throws -> [CropHypothesis] {
        var hypotheses: [CropHypothesis] = []
        let detectStarted = Date()
        let detailed = try cropper.detectRectanglesDetailed(
            in: image,
            intrinsics: intrinsics
        )
        diagnostics?.addStageTime(
            "detect",
            milliseconds: Date().timeIntervalSince(detectStarted) * 1_000
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
               isBaseline: false,
               requiresEvidence: Self.wholeFrameRequiresEvidence(detectorBox: detailed.detectorBox)
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
        var annMs: Double = 0
        var titleOCRMs: Double = 0
        var footerOCRMs: Double = 0
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
                semanticOrientation: attempt.isSemantic180 ? .upsideDown : .upright,
                embedMs: attempt.embedMs,
                annMs: annMs,
                titleOCRMs: titleOCRMs > 0 ? titleOCRMs : nil,
                footerOCRMs: footerOCRMs > 0 ? footerOCRMs : nil
            ))
        }

        // Keep automatic live scanning lightweight and conservative. A later
        // clear frame can recover naturally; the more expensive OCR rescue is
        // reserved for an intentional shutter/photo capture.
        if gateRejected && source == .livePreview {
            recordOutcome(.rejectedInput)
            throw CardScannerError.rejectedInput
        }

        let allowedIndices: Set<Int>
        if let deckScope = context.deckScope {
            guard context.mode.tcgGame == .all || context.mode.tcgGame == deckScope.game else {
                recordOutcome(.indexUnavailable)
                throw CardScannerError.ineligibleMode
            }
            allowedIndices = await metadataStore.physicalCardIndices(
                for: deckScope.game,
                setCode: context.setCode,
                externalCardIDs: deckScope.externalCardIDs
            )
        } else {
            allowedIndices = await metadataStore.physicalCardIndices(
                for: context.mode.tcgGame,
                setCode: context.setCode
            )
        }
        guard !allowedIndices.isEmpty else {
            recordOutcome(.indexUnavailable)
            throw CardScannerError.ineligibleMode
        }

        let matches: [ANNVectorMatch]
        do {
            let annStarted = Date()
            matches = try await indexStore.nearestNeighbors(
                for: embedding,
                limit: Configuration.maxNeighbors,
                allowedIndices: allowedIndices
            )
            annMs += Date().timeIntervalSince(annStarted) * 1_000
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
            gateScore: gateScore,
            deckScope: context.deckScope
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
        // In automatic mode the globally best catalog row routes all OCR and
        // ambiguity checks through that game's shard. The crop was embedded
        // once; only metadata/index filtering changes from this point on.
        let recognizedGame = primary.details.identity.game
        // Per-game acceptance policy (declared by the manifest or built in).
        // Its operating point shadows the encoder-level defaults from here on.
        let policy = acceptancePolicy(for: recognizedGame)
        let strongAcceptanceScore = policy.strongAcceptanceScore
        let ambiguityMargin = policy.ambiguityMargin

        // Hub collapse: a degenerate crop (blank, glare-saturated, badly
        // rectified) does not land near ONE card, it lands near many
        // unrelated rows at once — the 0.99-to-a-back-face failure. No
        // printed evidence can rescue an embedding that is not of a card.
        if policy.isHubCollapse(ranked.map { ($0.details.identity.name, $0.confidence.score) }) {
            recordOutcome(.hubRejected)
            throw CardScannerError.degenerateInput
        }
        // What THIS attempt must score to be accepted on visual evidence
        // alone (retry hypotheses carry the extra margin). Every OCR stage
        // keys off this, so a crop that cannot pass visually always gets its
        // evidence read instead of abstaining unexamined.
        // A whole-frame crop taken while the detector saw a credible card
        // box is card-plus-background: no similarity is high enough on its
        // own, only printed evidence may confirm it.
        let requiredScore: Double = attempt.requiresEvidence
            ? .infinity
            : (attempt.isBaseline
                ? strongAcceptanceScore
                : strongAcceptanceScore + Configuration.retryAttemptMargin)

        // The gate is intentionally not an unconditional early return. It has
        // false negatives on foil/full-art cards. When the frame is rejected,
        // low-scoring, or printing-ambiguous, exact title OCR can constrain ANN
        // retrieval to one catalog name; collector OCR must still confirm any
        // gate override or close printing decision.
        let initialRival = ranked.first { $0.id != primary.id }
        let requiresTitleConfirmation = policy.requiresTitleConfirmation(
            purpose: context.purpose,
            source: source
        )
        let ocrEnabled = ScannerPerfOptions.isOCREnabled
        let needsTitleEvidence = ocrEnabled && source != .livePreview && (
            requiresTitleConfirmation ||
            gateRejected ||
                primary.confidence.score < requiredScore ||
                initialRival.map {
                    primary.confidence.score - $0.confidence.score < ambiguityMargin
                } == true
        )

        // Confirms a shortlist candidate from one footer reading: NNN/NNN
        // pairs, then letter-prefixed promo codes, then slash-less digit runs
        // (the last only when every confirmed candidate agrees on ONE
        // number). Shared verbatim by both OCR orderings below.
        func resolvedCollectorNumber(for details: CardDetails) -> String? {
            if let value = details.identity.collectorNumber {
                let normalized = CollectorNumberOCR.normalize(value)
                if !normalized.isEmpty { return normalized }
            }
            return CollectorNumberOCR.collectorNumber(fromCardId: details.identity.id)
        }

        // A family-index row carries one representative printing plus the
        // rest of the family's printings as alternatives. A footer reading
        // proves the PRINTING, so it must be matched against every printing
        // the row represents — matching only the representative discarded
        // correct readings (C17 258 nested under a SCD 306 row, 2026-08-29).
        struct CollectorNumberMatch {
            let candidate: CardScanCandidate
            let printing: CardDetails
            let collectorNumber: String?
        }

        func printingOptions(for candidate: CardScanCandidate) -> [CardDetails] {
            if policy.collectorNumberScope == .representative { return [candidate.details] }
            var seen: Set<String> = []
            var options: [CardDetails] = []
            for details in [candidate.details] + candidate.printingAlternatives {
                let key = details.identity.exactPrintingID ?? details.identity.id
                guard seen.insert(key).inserted else { continue }
                options.append(details)
            }
            return options
        }

        func matchCollectorNumber(
            in candidates: [CardScanCandidate],
            reading: CollectorNumberOCR.FooterReading,
            titleConstrained: Bool = false
        ) -> CollectorNumberMatch? {
            let options: [(candidate: CardScanCandidate, printing: CardDetails, number: String)] =
                candidates.flatMap { candidate in
                    printingOptions(for: candidate).compactMap { printing in
                        resolvedCollectorNumber(for: printing).map { (candidate, printing, $0) }
                    }
                }
            func match(_ option: (candidate: CardScanCandidate, printing: CardDetails, number: String)) -> CollectorNumberMatch {
                CollectorNumberMatch(
                    candidate: option.candidate,
                    printing: option.printing,
                    collectorNumber: option.number
                )
            }
            // A three-digit number is not unique across a ten-card shortlist
            // whose rows each represent many printings: "273" confirmed
            // Cathedral of War over Forsaken Sanctuary at 0.595. When the
            // reading matches printings of more than one family, only a
            // title-constrained shortlist (one name) may resolve it.
            func unambiguous(_ hits: [(candidate: CardScanCandidate, printing: CardDetails, number: String)]) -> CollectorNumberMatch? {
                guard let first = hits.first else { return nil }
                let families = Set(hits.map {
                    $0.candidate.details.identity.recognitionFamilyID ?? $0.candidate.id.uuidString
                })
                guard families.count == 1 || titleConstrained else { return nil }
                return match(first)
            }
            let pairNumbers = Set(reading.pairNumbers)
            if !pairNumbers.isEmpty {
                let hits = options.filter { pairNumbers.contains($0.number) }
                if !hits.isEmpty { return unambiguous(hits) }
            }
            // Letter-prefixed promo numbers ("SWSH204") never print as
            // NNN/NNN, so without this branch the entire promo class was
            // structurally impossible to OCR-confirm.
            if !reading.promoCodes.isEmpty {
                let promoCodes = Set(reading.promoCodes)
                let hits = options.filter {
                    $0.number.contains(where: \.isLetter) && promoCodes.contains($0.number)
                }
                if !hits.isEmpty { return unambiguous(hits) }
            }
            if !reading.digitRuns.isEmpty {
                let confirmed = options.filter {
                    CollectorNumberOCR.runsConfirm(number: $0.number, in: reading.digitRuns)
                }
                let distinctNumbers = Set(confirmed.map(\.number))
                if distinctNumbers.count == 1, let hit = confirmed.first {
                    return match(hit)
                }
            }
            return nil
        }

        var ocrVerified = false
        var footerFirstReading: CollectorNumberOCR.FooterReading?
        let footerFirst = ocrEnabled && ScannerPerfOptions.isFooterFirstOCREnabled

        // Footer-first ordering: the collector number is both cheaper to read
        // and stronger evidence than a title (it proves the printing, not
        // just the name), so read it before deciding whether the title pass
        // is needed at all. The reading is kept for re-matching after a
        // title constraint — one Vision pass either way.
        if footerFirst {
            let preTiebreak = ranked.count >= 2 &&
                (ranked[0].confidence.score - ranked[1].confidence.score) < Configuration.ocrMargin
            let preVerification = gateRejected ||
                primary.confidence.score < requiredScore
            if preTiebreak || preVerification {
                let eligible = ranked.filter { candidate in
                    preVerification ||
                        (primary.confidence.score - candidate.confidence.score) < Configuration.ocrMargin
                }
                let footerStarted = Date()
                var reading = footerReading(for: cropped, embedding: embedding, source: source)
                if reading.usedFastPath, matchCollectorNumber(in: eligible, reading: reading) == nil {
                    // Fast read confirmed nothing — one accurate rescue read.
                    reading = ocr.readFooterAccurate(from: cropped)
                }
                footerOCRMs += Date().timeIntervalSince(footerStarted) * 1_000
                footerFirstReading = reading
                evidenceFooterPairs = reading.pairNumbers
                if let matched = matchCollectorNumber(in: eligible, reading: reading) {
                    primary = ocrVerifiedCandidate(
                        matched.candidate,
                        printing: matched.printing,
                        collectorNumber: matched.collectorNumber
                    )
                    ocrVerified = true
                    evidenceOCRNumber = matched.collectorNumber
                }
            }
        }

        // The unconstrained visual leader, remembered so title evidence can
        // be judged as agreeing with (or contradicting) the image.
        let visualLeaderName = primary.details.identity.name
        let visualLeaderScore = primary.confidence.score
        let visualRival = initialRival

        var titlePrintingCount = 0
        var titleRunnerScore: Double?
        var titleConstrained = false
        if needsTitleEvidence, !(footerFirst && ocrVerified) {
            let titleStarted = Date()
            let titleCandidates = titleOCR.read(from: cropped)
            titleOCRMs += Date().timeIntervalSince(titleStarted) * 1_000
            var titleMatch = await metadataStore.exactNameMatch(
                for: titleCandidates,
                game: recognizedGame,
                setCode: context.setCode,
                physicalCardsOnly: true
            )
            // Vision occasionally substitutes one final glyph in an otherwise
            // perfect title (`Thrór's Man` for `Thrór's Map`). Permit that
            // correction only against strong candidates already retrieved by
            // the image embedding. This keeps fuzzy text out of global catalog
            // search and therefore preserves the open-set boundary.
            if titleMatch == nil,
               let corrected = CardTitleOCR.singleEditCorrection(
                    for: titleCandidates,
                    shortlistNames: ranked
                        .filter { $0.confidence.score >= 0.75 }
                        .map { $0.details.identity.name }
               ) {
                titleMatch = await metadataStore.exactNameMatch(
                    for: [corrected],
                    game: recognizedGame,
                    setCode: context.setCode,
                    physicalCardsOnly: true
                )
            }
            if let titleMatch {
                let titleANNStarted = Date()
                let titleMatches = try await indexStore.nearestNeighbors(
                    for: embedding,
                    limit: Configuration.maxNeighbors,
                    allowedIndices: titleMatch.indices
                )
                annMs += Date().timeIntervalSince(titleANNStarted) * 1_000
                let titleRanked = await makeCandidates(
                    from: titleMatches,
                    game: recognizedGame,
                    gateScore: gateScore,
                    titleVerifiedName: titleMatch.name,
                    deckScope: context.deckScope
                )
                if let titlePrimary = titleRanked.first {
                    ranked = titleRanked
                    primary = titlePrimary
                    titlePrintingCount = titleMatch.printingCount
                    titleConstrained = true
                    titleRunnerScore = titleMatches.dropFirst().first.map {
                        scoreForDistance($0.distance)
                    }
                    evidenceTitleName = titleMatch.name
                    evidenceTitleCount = titleMatch.printingCount
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
        // split twins; only a clean "NNN/NNN" pair overrides it. In
        // footer-first mode the reading already happened above — this stage
        // re-matches it against the title-constrained shortlist instead of
        // running a second Vision pass.
        if ocrEnabled && !ocrVerified {
            let needsOCRTiebreak = ranked.count >= 2 &&
                (ranked[0].confidence.score - ranked[1].confidence.score) < Configuration.ocrMargin
            let needsOCRVerification = gateRejected ||
                primary.confidence.score < requiredScore
            if needsOCRTiebreak || needsOCRVerification {
                let ocrEligibleCandidates = ranked.filter { candidate in
                    needsOCRVerification ||
                        (primary.confidence.score - candidate.confidence.score) < Configuration.ocrMargin
                }
                var reading: CollectorNumberOCR.FooterReading
                if footerFirst, let cached = footerFirstReading {
                    reading = cached
                } else {
                    let footerStarted = Date()
                    reading = footerReading(for: cropped, embedding: embedding, source: source)
                    if reading.usedFastPath,
                       matchCollectorNumber(in: ocrEligibleCandidates, reading: reading) == nil {
                        // Fast read confirmed nothing — one accurate rescue read.
                        reading = ocr.readFooterAccurate(from: cropped)
                    }
                    footerOCRMs += Date().timeIntervalSince(footerStarted) * 1_000
                    evidenceFooterPairs = reading.pairNumbers
                }
                if let matched = matchCollectorNumber(
                    in: ocrEligibleCandidates,
                    reading: reading,
                    titleConstrained: titleConstrained
                ) {
                    primary = ocrVerifiedCandidate(
                        matched.candidate,
                        printing: matched.printing,
                        collectorNumber: matched.collectorNumber
                    )
                    ocrVerified = true
                    evidenceOCRNumber = matched.collectorNumber
                }
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
                && primary.confidence.score >= requiredScore
            if !titleBacked {
                recordOutcome(.rejectedInput)
                throw CardScannerError.rejectedInput
            }
        }

        let uniqueTitleVerified = policy.uniqueTitleRescue && Self.acceptsUniqueTitleEvidence(
            score: primary.confidence.score,
            printingCount: titleConstrained ? titlePrintingCount : 0,
            floor: policy.evidenceFloor
        )
        // Two independent signals naming the same card: the exact printed
        // title and the image's own unconstrained leader. Together they
        // confirm the visual FAMILY (the printing is still resolved below),
        // which lets a reprinted card through on the same 0.55 evidence
        // floor a unique title already enjoys — provided no different-name
        // rival was within the ambiguity margin of that leader.
        let titleAgreesWithVisual = Self.titleAgreesWithVisualLeader(
            titleConstrained: titleConstrained,
            titleName: evidenceTitleName,
            visualLeaderName: visualLeaderName,
            visualLeaderScore: visualLeaderScore,
            rivalName: visualRival?.details.identity.name,
            rivalScore: visualRival?.confidence.score,
            ambiguityMargin: ambiguityMargin,
            evidenceScore: primary.confidence.score,
            enabled: policy.titleAgreementRescue,
            evidenceFloor: policy.evidenceFloor
        )
        guard primary.confidence.score >= requiredScore
                || ocrVerified
                || uniqueTitleVerified
                || titleAgreesWithVisual
        else {
            recordOutcome(.belowAcceptanceThreshold)
            return nil
        }

        // A binder page multiplies every false-positive opportunity by the
        // number of pockets. MTG's August 27 session also produced three wrong
        // accepts from 180-degree retries and one from a landscape interior
        // fragment rotated into a portrait crop. The standardized MTG title
        // line lets every intentional result stay useful without accepting an
        // unverified visual neighbor. A genuinely upside-down card becomes
        // title-readable after the retry; a fragment or spurious retry does
        // not. Live preview remains visual-only and cannot import a card.
        guard !ocrEnabled || !requiresTitleConfirmation || titleConstrained || ocrVerified else {
            recordOutcome(.noCandidates)
            return nil
        }

        // A title proves the card name, not the printing. When that name has
        // multiple catalog rows, require either the printed collector number
        // or an exceptionally strong, well-separated visual printing match.
        // This prevents a modern Piplup frame, for example, from being labeled
        // as a visually similar 2007 Piplup simply because both share a title.
        let primaryFamilyID = primary.details.identity.recognitionFamilyID
        let familyHasMultiplePrintings = primaryFamilyID != nil && ranked.contains { candidate in
            candidate.id != primary.id
                && candidate.details.identity.recognitionFamilyID == primaryFamilyID
                && (candidate.details.identity.exactPrintingID ?? candidate.details.identity.id)
                    != (primary.details.identity.exactPrintingID ?? primary.details.identity.id)
        }
        // When the title merely CONTRADICTS nothing but the image did not
        // independently pick the same name, keep the strict bar. When the
        // image and the title agree on the name, the family is confirmed and
        // `CardPrintingResolver` owns the printing choice (newest in Quick
        // Scan, user choice in Exact Printing).
        if !ocrVerified, titlePrintingCount > 1, !familyHasMultiplePrintings, !titleAgreesWithVisual {
            guard primary.confidence.score >= 0.85,
                  let titleRunnerScore,
                  primary.confidence.score - titleRunnerScore >= 0.05
            else {
                recordOutcome(.titlePrintingUnresolved)
                if context.purpose == .binderPage, titleConstrained {
                    let alternatives = ranked.filter { $0.id != primary.id }
                    let resultMode = ScanMode.allCases.first {
                        $0 != .automatic && $0.tcgGame == primary.details.identity.game
                    } ?? context.mode
                    return CardScanResult(
                        mode: resultMode,
                        capturedImage: cropped,
                        primary: primary,
                        alternatives: alternatives,
                        resolution: .nameOnly,
                        elapsed: 0
                    )
                }
                return nil
            }
        }

        // Ambiguity guard: a near-tied runner-up that is a different card means
        // the embedding alone cannot tell the two apart on this frame. Without
        // OCR confirmation, abstain and let a cleaner frame decide.
        if !ocrVerified,
           let rival = ranked.first(where: { $0.id != primary.id }),
           primary.confidence.score - rival.confidence.score < ambiguityMargin,
           (rival.details.identity.recognitionFamilyID == nil
                || rival.details.identity.recognitionFamilyID != primary.details.identity.recognitionFamilyID) {
            recordOutcome(.printingAmbiguous)
            return nil
        }

        let printingDecision = CardPrintingResolver.resolve(
            primary: primary,
            candidates: ranked.filter { $0.id != primary.id },
            mode: context.printingMode,
            verifiedExactPrintingID: ocrVerified
                ? (primary.details.identity.exactPrintingID ?? primary.details.identity.id)
                : nil
        )
        if printingDecision.requiresSelection {
            recordOutcome(.titlePrintingUnresolved)
            let resultMode = ScanMode.allCases.first {
                $0 != .automatic && $0.tcgGame == primary.details.identity.game
            } ?? context.mode
            return CardScanResult(
                mode: resultMode,
                capturedImage: cropped,
                primary: primary,
                alternatives: printingDecision.candidates.filter { $0.id != primary.id },
                resolution: .nameOnly,
                printingResolutionProvenance: .unresolved,
                elapsed: 0
            )
        }

        let resolvedPrimary = printingDecision.selected ?? primary
        let alternatives = ranked.filter { $0.id != resolvedPrimary.id }
        recordOutcome(.accepted)

        let resultMode = ScanMode.allCases.first {
            $0 != .automatic && $0.tcgGame == resolvedPrimary.details.identity.game
        } ?? context.mode
        return CardScanResult(
            mode: resultMode,
            capturedImage: cropped,
            primary: resolvedPrimary,
            alternatives: alternatives,
            printingResolutionProvenance: printingDecision.provenance,
            elapsed: 0
        )
    }

    /// An exact catalog title plus minimum visual evidence can safely rescue a
    /// truly unique card even when blur keeps the embedding below the normal
    /// visual-only threshold. Reprinted/shared names still proceed through the
    /// collector-number and printing-ambiguity policy below.
    static func acceptsUniqueTitleEvidence(
        score: Double,
        printingCount: Int,
        floor: Double = Configuration.minimumEvidenceScore
    ) -> Bool {
        printingCount == 1 && score >= floor
    }

    /// Title agreement: the exact printed title names the same card the
    /// image ranked first, that leader is at or above the evidence floor,
    /// and no different-name rival sat within the ambiguity margin of it.
    /// Internal so the rule can be regression-tested without Core ML.
    static func titleAgreesWithVisualLeader(
        titleConstrained: Bool,
        titleName: String?,
        visualLeaderName: String,
        visualLeaderScore: Double,
        rivalName: String?,
        rivalScore: Double?,
        ambiguityMargin: Double,
        evidenceScore: Double,
        enabled: Bool = true,
        evidenceFloor: Double = Configuration.minimumEvidenceScore
    ) -> Bool {
        guard enabled, titleConstrained, let titleName else { return false }
        guard evidenceScore >= evidenceFloor else { return false }
        let title = CardTitleOCR.normalizedName(titleName)
        guard CardTitleOCR.normalizedName(visualLeaderName) == title else { return false }
        if let rivalName, let rivalScore,
           CardTitleOCR.normalizedName(rivalName) != title,
           visualLeaderScore - rivalScore < ambiguityMargin {
            return false
        }
        return true
    }

    /// The built-in policy's title requirement for `game` (no manifest
    /// declaration). Visual-first since 2026-08-29: a single-card Magic
    /// capture is accepted on visual evidence alone at its per-game
    /// operating point, the same way Pokémon is; title/footer OCR is a
    /// verifier for weak or ambiguous scores, never a gate. Binder pages keep
    /// the title requirement — a page multiplies every false-positive
    /// opportunity by the pocket count and produced wrong accepts from
    /// 180-degree retries. `SCANNER_MTG_TITLE_GATE=1` restores the gate on
    /// intentional captures for A/B replays.
    nonisolated static func requiresTitleConfirmation(
        game: TCGGame,
        purpose: CardScanPurpose,
        source: ScanInvocationKind
    ) -> Bool {
        ScannerGameAcceptancePolicy.resolve(game: game, declared: nil)
            .requiresTitleConfirmation(purpose: purpose, source: source)
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
        titleVerifiedName: String? = nil,
        deckScope: CardScanDeckScope? = nil
    ) async -> [CardScanCandidate] {
        var candidates: [CardScanCandidate] = []
        for match in matches {
            guard let details = await metadataStore.details(for: match.index),
                  (game == .all || details.identity.game == game)
            else { continue }
            let printingAlternatives = await metadataStore.printingDetails(for: match.index)
            let score = scoreForDistance(match.distance)
            guard score >= Configuration.minimumEvidenceScore else { continue }
            var debugInfo = [
                "distance": String(format: "%.4f", match.distance),
                "similarity": String(format: "%.4f", score),
                "strongThreshold": String(format: "%.2f", strongAcceptanceScore),
                "evidenceThreshold": String(format: "%.2f", Configuration.minimumEvidenceScore)
            ]
            if let gateScore {
                debugInfo["cardFaceScore"] = String(format: "%.4f", gateScore)
            }
            if let titleVerifiedName {
                debugInfo["ocrTitle"] = titleVerifiedName
            }
            if let deckScope {
                debugInfo["searchScope"] = "deck"
                debugInfo["deckID"] = deckScope.deckID
                debugInfo["deckName"] = deckScope.deckName
                debugInfo["deckCardCount"] = String(deckScope.externalCardIDs.count)
            } else {
                debugInfo["searchScope"] = "full_catalog"
            }
            candidates.append(CardScanCandidate(
                details: details,
                confidence: CardScanConfidence(score: score, reason: "ANN distance \(match.distance)"),
                originatingStrategy: kind,
                debugInfo: debugInfo,
                printingAlternatives: printingAlternatives
            ))
        }
        return candidates.sorted { $0.confidence.score > $1.confidence.score }
    }

    /// The confirmed printing becomes the candidate's identity (so the
    /// printing resolver's verified path selects it) while the family's
    /// alternative list and candidate id are preserved.
    private func ocrVerifiedCandidate(
        _ candidate: CardScanCandidate,
        printing: CardDetails,
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
            details: printing,
            confidence: CardScanConfidence(score: candidate.confidence.score, reason: reason),
            originatingStrategy: candidate.originatingStrategy,
            debugInfo: debugInfo,
            printingAlternatives: candidate.printingAlternatives
        )
    }
}

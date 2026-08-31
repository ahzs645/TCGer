import CoreGraphics
import Foundation

protocol ScanStrategy: AnyObject {
    var kind: ScanStrategyKind { get }
    var supportsLiveScanning: Bool { get }
    func supports(_ mode: ScanMode) -> Bool
    func scan(
        image: CGImage,
        context: CardScannerContext,
        source: ScanInvocationKind,
        apiService: APIService
    ) async throws -> CardScanResult?
    /// Pre-warms the strategy's expensive lazy loads (models, indices) so
    /// the first real scan does not pay them. Protocol requirement so the
    /// coordinator's existential call dispatches to the implementation.
    func warmUp() async
    /// Mode-aware warm-up used by the camera startup path. Most strategies
    /// have one shared runtime and can use `warmUp()`; strategies with
    /// per-game assets override this to avoid loading unrelated catalogs.
    func warmUp(for mode: ScanMode) async
}

extension ScanStrategy {
    var supportsLiveScanning: Bool { false }

    /// Optional pre-warm of a strategy's expensive lazy loads so the first
    /// real scan does not pay them. Default no-op.
    func warmUp() async {}

    func warmUp(for mode: ScanMode) async {
        await warmUp()
    }
}

final class CardScannerCoordinator: @unchecked Sendable {
    private let strategies: [ScanStrategy]
    private let apiService: APIService

    init(strategies: [ScanStrategy], apiService: APIService) {
        self.strategies = strategies
        self.apiService = apiService
    }

    /// Runs every strategy's warm-up serially off the caller's critical path.
    /// Serial on purpose: warm-up competes with nothing when the scanner has
    /// just opened, and concurrent Core ML compilations contend for the ANE.
    func warmUp() async {
        for strategy in strategies {
            await strategy.warmUp()
        }
    }

    /// Warms only the first strategy that a real capture would use. Camera
    /// startup should prepare the recognition path the user is most likely to
    /// need, not decode every fallback database before the first photo.
    func warmUpPrimary(
        for mode: ScanMode,
        preferredEngine: ScanEnginePreference = .automatic
    ) async {
        guard let primary = eligibleStrategies(
            for: mode,
            source: .photoCapture,
            preferredEngine: preferredEngine
        ).first else { return }
        await primary.warmUp(for: mode)
    }

    static func makeDefault(
        apiService: APIService = APIService(),
        includeBundledTestFallbacks: Bool = false
    ) -> CardScannerCoordinator {
        var strategies: [ScanStrategy] = [BackendHashScannerStrategy()]
        let downloadableModes: [(TCGGame, ScanMode)] = [
            (.pokemon, .pokemon),
            (.magic, .mtg),
            (.yugioh, .yugioh),
        ]
        for (game, mode) in downloadableModes {
            guard let runtime = ScannerAssetStore.shared.runtime(for: game) else { continue }
            strategies.append(BoardCardEmbeddingScannerStrategy(
                variant: .arcface,
                encoder: CardEmbeddingEncoder(
                    modelLoader: FileCardEmbeddingModelLoader(modelURL: runtime.modelURL),
                    queryNormalization: ScannerGameAcceptancePolicy.resolve(
                        game: game,
                        declared: runtime.acceptancePolicy
                    ).queryNormalization
                ),
                indexStore: AnnoyIndexStore(fileURL: runtime.vectorsURL),
                metadataStore: CardIndexMetadataStore(fileURL: runtime.metadataURL),
                supportedModes: [mode],
                acceptancePolicies: runtime.acceptancePolicy.map { [game: $0] } ?? [:]
            ))
        }
        if includeBundledTestFallbacks {
            // Large game-specific recognition payloads are no longer part of
            // the production scanner path. Tests and offline evaluation tools
            // may opt into the historical fixtures explicitly while the app
            // requires a checksum-validated downloadable runtime.
            strategies.append(ArtworkFingerprintScannerStrategy())
            strategies.append(BoardCardEmbeddingScannerStrategy())
            strategies.append(PokemonTextScannerStrategy())
            strategies.append(MagicPerceptualHashScannerStrategy())
        }
        return CardScannerCoordinator(strategies: strategies, apiService: apiService)
    }

    func canScan(mode: ScanMode, preferredEngine: ScanEnginePreference = .automatic) -> Bool {
        !eligibleStrategies(for: mode, source: .photoCapture, preferredEngine: preferredEngine).isEmpty
    }

    func supportsLiveScanning(
        for mode: ScanMode,
        preferredEngine: ScanEnginePreference = .automatic
    ) -> Bool {
        !eligibleStrategies(for: mode, source: .livePreview, preferredEngine: preferredEngine).isEmpty
    }

    func scan(
        image: CGImage,
        context: CardScannerContext,
        source: ScanInvocationKind
    ) async -> Result<CardScanResult, CardScannerError> {
        let strategiesForRequest = eligibleStrategies(
            for: context.mode,
            source: source,
            preferredEngine: context.enginePreference
        )
        // Deck Scan is a restricted exact-vector search, not a post-hoc label
        // filter over a full-catalog hash/server result.
        let eligibleStrategies = context.deckScope == nil
            ? strategiesForRequest
            : strategiesForRequest.filter { $0.kind == .mlDetector }
        guard !eligibleStrategies.isEmpty else {
            return .failure(.ineligibleMode)
        }

        // A single strategy failing (e.g. a server matcher when there is no
        // network) must not abort the whole chain — keep trying the remaining
        // strategies so local matchers still get a turn. We only surface an
        // error if every strategy failed AND none of them cleanly reported a
        // "no match"; a clean no-match is preferred over a network error.
        var firstError: CardScannerError?
        var sawCleanNoMatch = false

        for strategy in eligibleStrategies {
            let start = Date()
            do {
                if var result = try await strategy.scan(
                    image: image,
                    context: context,
                    source: source,
                    apiService: apiService
                ) {
                    if let deckScope = context.deckScope {
                        let scopedCandidates = ([result.primary] + result.alternatives).filter { candidate in
                            deckScope.contains(candidate.details) ||
                                candidate.printingAlternatives.contains { deckScope.contains($0) }
                        }
                        guard let primary = scopedCandidates.first else {
                            sawCleanNoMatch = true
                            continue
                        }
                        result = CardScanResult(
                            mode: result.mode,
                            capturedImage: result.capturedImage,
                            primary: primary,
                            alternatives: Array(scopedCandidates.dropFirst()),
                            resolution: result.resolution,
                            printingResolutionProvenance: result.printingResolutionProvenance,
                            elapsed: result.elapsed,
                            debugCapture: result.debugCapture,
                            debugCaptureError: result.debugCaptureError
                        )
                    }
                    if let setCode = context.setCode {
                        let scopedCandidates = ([result.primary] + result.alternatives).filter {
                            $0.details.identity.setCode?.caseInsensitiveCompare(setCode) == .orderedSame
                        }
                        guard let primary = scopedCandidates.first else {
                            sawCleanNoMatch = true
                            continue
                        }
                        result = CardScanResult(
                            mode: result.mode,
                            capturedImage: result.capturedImage,
                            primary: primary,
                            alternatives: Array(scopedCandidates.dropFirst()),
                            resolution: result.resolution,
                            printingResolutionProvenance: result.printingResolutionProvenance,
                            elapsed: result.elapsed,
                            debugCapture: result.debugCapture,
                            debugCaptureError: result.debugCaptureError
                        )
                    }
                    let elapsed = Date().timeIntervalSince(start)
                    result = CardScanResult(
                        mode: result.mode,
                        capturedImage: result.capturedImage,
                        primary: result.primary,
                        alternatives: result.alternatives,
                        resolution: result.resolution,
                        printingResolutionProvenance: result.printingResolutionProvenance,
                        elapsed: elapsed,
                        debugCapture: result.debugCapture,
                        debugCaptureError: result.debugCaptureError
                    )
                    return .success(result)
                }
                sawCleanNoMatch = true
            } catch let error as CardScannerError {
                if case .rejectedInput = error {
                    // This is an explicit open-set decision, not a strategy
                    // failure. A looser nearest-neighbor fallback must not
                    // override it with a confidently wrong card.
                    return .failure(.noMatch)
                }
                if firstError == nil { firstError = error }
            } catch {
                if firstError == nil { firstError = .underlying(error) }
            }
        }

        if sawCleanNoMatch {
            return .failure(.noMatch)
        }
        return .failure(firstError ?? .noMatch)
    }

    private func eligibleStrategies(
        for mode: ScanMode,
        source: ScanInvocationKind,
        preferredEngine: ScanEnginePreference
    ) -> [ScanStrategy] {
        let strategiesForMode = strategies
            .enumerated()
            .filter { _, strategy in
                guard strategy.supports(mode) else { return false }
                guard ScannerPerfOptions.isOCREnabled || strategy.kind != .textOCR else {
                    return false
                }
                switch source {
                case .livePreview:
                    return strategy.supportsLiveScanning
                case .photoCapture, .importedPhoto:
                    return true
                }
            }
            .sorted { lhs, rhs in
                let lhsPriority = priority(of: lhs.element, for: mode)
                let rhsPriority = priority(of: rhs.element, for: mode)
                if lhsPriority == rhsPriority {
                    return lhs.offset < rhs.offset
                }
                return lhsPriority < rhsPriority
            }
            .map(\.element)

        if preferredEngine.isLocalOnly {
            // Only strategies that run entirely on-device: bundled artwork
            // fingerprints, perceptual hashing, and the embedding detector.
            // Text OCR and the server matchers need a backend, so drop them.
            return strategiesForMode.filter { strategy in
                switch strategy.kind {
                case .artworkFingerprint, .perceptualHash, .mlDetector:
                    return true
                case .manual, .textOCR, .serverHash, .serverEmbedding:
                    return false
                }
            }
        }

        guard preferredEngine.requiresServerOnlyFlow else {
            return strategiesForMode
        }

        guard source != .livePreview else {
            return []
        }

        return strategiesForMode.filter { $0.kind == .serverHash }
    }

    private func priority(of strategy: ScanStrategy, for mode: ScanMode) -> Int {
        switch (mode, strategy.kind) {
        case (_, .manual):
            return 5
        // Pokémon leads with the embedding pipeline: it carries the OCR
        // collector-number tiebreak, the ambiguity abstain, and the card-face
        // rejection gate, none of which the artwork/HSV matcher has. The
        // HSV-weighted fingerprint stays as the fallback — on real camera
        // frames it rarely clears its own 0.90 floor, but on clean frames it
        // could otherwise short-circuit the better-verified strategy.
        case (.pokemon, .mlDetector), (.mtg, .perceptualHash):
            return 0
        case (_, .artworkFingerprint), (_, .perceptualHash):
            return 1
        case (_, .mlDetector):
            return 2
        case (_, .textOCR):
            return 3
        case (_, .serverHash), (_, .serverEmbedding):
            return 4
        }
    }
}

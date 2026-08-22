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
}

extension ScanStrategy {
    var supportsLiveScanning: Bool { false }

    /// Optional pre-warm of a strategy's expensive lazy loads so the first
    /// real scan does not pay them. Default no-op.
    func warmUp() async {}
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

    static func makeDefault(apiService: APIService = APIService()) -> CardScannerCoordinator {
        let strategies: [ScanStrategy] = [
            ArtworkFingerprintScannerStrategy(),
            BackendHashScannerStrategy(),
            BoardCardEmbeddingScannerStrategy(),
            PokemonTextScannerStrategy(),
            MagicPerceptualHashScannerStrategy()
        ]
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
        let eligibleStrategies = eligibleStrategies(
            for: context.mode,
            source: source,
            preferredEngine: context.enginePreference
        )
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

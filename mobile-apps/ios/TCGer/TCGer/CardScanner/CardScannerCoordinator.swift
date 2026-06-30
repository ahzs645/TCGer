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
}

extension ScanStrategy {
    var supportsLiveScanning: Bool { false }
}

final class CardScannerCoordinator {
    private let strategies: [ScanStrategy]
    private let apiService: APIService

    private lazy var supportedModes: [ScanMode: [ScanStrategy]] = {
        var mapping: [ScanMode: [ScanStrategy]] = [:]
        for strategy in strategies {
            for mode in ScanMode.allCases where strategy.supports(mode) {
                mapping[mode, default: []].append(strategy)
            }
        }
        return mapping
    }()

    init(strategies: [ScanStrategy], apiService: APIService) {
        self.strategies = strategies
        self.apiService = apiService
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
        let strategiesForMode = (supportedModes[mode] ?? []).filter { strategy in
            switch source {
            case .livePreview:
                return strategy.supportsLiveScanning
            case .photoCapture:
                return true
            }
        }

        if preferredEngine.isLocalOnly {
            // Only strategies that run entirely on-device: bundled artwork
            // fingerprints, perceptual hashing, and the embedding detector.
            // Text OCR and the server matchers need a backend, so drop them.
            return strategiesForMode.filter { strategy in
                switch strategy.kind {
                case .artworkFingerprint, .perceptualHash, .mlDetector:
                    return true
                case .textOCR, .serverHash, .serverEmbedding:
                    return false
                }
            }
        }

        guard preferredEngine.requiresServerOnlyFlow else {
            return strategiesForMode
        }

        guard source == .photoCapture else {
            return []
        }

        return strategiesForMode.filter { $0.kind == .serverHash }
    }
}

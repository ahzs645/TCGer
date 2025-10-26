import CoreGraphics
import Foundation

protocol ScanStrategy: AnyObject {
    var kind: ScanStrategyKind { get }
    var supportsLiveScanning: Bool { get }
    func supports(_ mode: ScanMode) -> Bool
    func scan(
        image: CGImage,
        context: CardScannerContext,
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
            BoardCardEmbeddingScannerStrategy(),
            PokemonTextScannerStrategy(),
            MagicPerceptualHashScannerStrategy()
        ]
        return CardScannerCoordinator(strategies: strategies, apiService: apiService)
    }

    func canScan(mode: ScanMode) -> Bool {
        !(supportedModes[mode] ?? []).isEmpty
    }

    func supportsLiveScanning(for mode: ScanMode) -> Bool {
        (supportedModes[mode] ?? []).contains { $0.supportsLiveScanning }
    }

    func scan(
        image: CGImage,
        context: CardScannerContext
    ) async -> Result<CardScanResult, CardScannerError> {
        let eligibleStrategies = supportedModes[context.mode] ?? []
        guard !eligibleStrategies.isEmpty else {
            return .failure(.ineligibleMode)
        }

        for strategy in eligibleStrategies {
            let start = Date()
            do {
                if var result = try await strategy.scan(
                    image: image,
                    context: context,
                    apiService: apiService
                ) {
                    let elapsed = Date().timeIntervalSince(start)
                    result = CardScanResult(
                        mode: result.mode,
                        capturedImage: result.capturedImage,
                        primary: result.primary,
                        alternatives: result.alternatives,
                        elapsed: elapsed
                    )
                    return .success(result)
                }
            } catch let error as CardScannerError {
                return .failure(error)
            } catch {
                return .failure(.underlying(error))
            }
        }

        return .failure(.noMatch)
    }
}

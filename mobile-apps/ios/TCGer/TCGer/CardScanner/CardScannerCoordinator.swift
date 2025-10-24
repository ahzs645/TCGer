import CoreGraphics
import Foundation

protocol ScanStrategy: AnyObject {
    var kind: ScanStrategyKind { get }
    func supports(_ mode: ScanMode) -> Bool
    func scan(
        image: CGImage,
        context: CardScannerContext,
        apiService: APIService
    ) async throws -> CardScanResult?
}

final class CardScannerCoordinator {
    private let strategies: [ScanStrategy]
    private let apiService: APIService

    init(strategies: [ScanStrategy], apiService: APIService) {
        self.strategies = strategies
        self.apiService = apiService
    }

    static func makeDefault(apiService: APIService = APIService()) -> CardScannerCoordinator {
        let strategies: [ScanStrategy] = [
            PokemonTextScannerStrategy()
        ]
        return CardScannerCoordinator(strategies: strategies, apiService: apiService)
    }

    func scan(
        image: CGImage,
        context: CardScannerContext
    ) async -> Result<CardScanResult, CardScannerError> {
        let eligibleStrategies = strategies.filter { $0.supports(context.mode) }
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

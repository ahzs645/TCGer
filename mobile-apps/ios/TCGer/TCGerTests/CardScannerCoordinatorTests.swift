import XCTest
@testable import TCGer

@MainActor
final class CardScannerCoordinatorTests: XCTestCase {
    func testSuccessfulManualScanStaysInSessionByDefault() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    behavior: .match(cardID: "session-card"),
                    recorder: recorder
                )
            ],
            apiService: APIService()
        )
        let viewModel = CardScannerViewModel(coordinator: coordinator)
        let environment = EnvironmentStore()
        environment.serverConfiguration = .onDevice
        viewModel.updateEnvironment(environment)

        await viewModel.scan(image: ScannerTestImage.solid())

        XCTAssertEqual(viewModel.sessionResults.map(\.primary.details.identity.id), ["session-card"])
        XCTAssertNil(viewModel.latestResult)
    }

    func testSuccessfulManualScanCanAutomaticallyPresentResult() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    behavior: .match(cardID: "presented-card"),
                    recorder: recorder
                )
            ],
            apiService: APIService()
        )
        let viewModel = CardScannerViewModel(coordinator: coordinator)
        let environment = EnvironmentStore()
        environment.serverConfiguration = .onDevice
        viewModel.setAutomaticallyPresentsResults(true)
        viewModel.updateEnvironment(environment)

        await viewModel.scan(image: ScannerTestImage.solid())

        XCTAssertEqual(viewModel.sessionResults.map(\.primary.details.identity.id), ["presented-card"])
        XCTAssertEqual(viewModel.latestResult?.primary.details.identity.id, "presented-card")
    }

    func testStrategiesRunInModePriorityOrderAndContinueAfterFailures() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .serverHash,
                    behavior: .failure(.missingAuthToken),
                    recorder: recorder
                ),
                StubScanStrategy(
                    kind: .mlDetector,
                    supportsLiveScanning: true,
                    behavior: .noMatch,
                    recorder: recorder
                ),
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    supportsLiveScanning: true,
                    behavior: .match(cardID: "winner"),
                    recorder: recorder
                )
            ],
            apiService: APIService()
        )

        let result = await coordinator.scan(
            image: ScannerTestImage.solid(),
            context: .test(),
            source: .photoCapture
        )

        guard case .success(let scan) = result else {
            return XCTFail("Expected the local fallback strategy to match")
        }
        XCTAssertEqual(scan.primary.details.identity.id, "winner")
        XCTAssertEqual(recorder.kinds, [.mlDetector, .artworkFingerprint])
    }

    func testCleanNoMatchWinsOverEarlierStrategyError() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    behavior: .failure(.missingAuthToken),
                    recorder: recorder
                ),
                StubScanStrategy(kind: .mlDetector, behavior: .noMatch, recorder: recorder)
            ],
            apiService: APIService()
        )

        let result = await coordinator.scan(
            image: ScannerTestImage.solid(),
            context: .test(),
            source: .photoCapture
        )

        guard case .failure(.noMatch) = result else {
            return XCTFail("A clean no-match should suppress an earlier recoverable error")
        }
    }

    func testLocalOnlyFiltersServerAndOCRStrategies() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .serverHash,
                    supportsLiveScanning: true,
                    behavior: .match(cardID: "server"),
                    recorder: recorder
                ),
                StubScanStrategy(
                    kind: .textOCR,
                    supportsLiveScanning: true,
                    behavior: .match(cardID: "ocr"),
                    recorder: recorder
                ),
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    supportsLiveScanning: true,
                    behavior: .match(cardID: "local"),
                    recorder: recorder
                )
            ],
            apiService: APIService()
        )

        let result = await coordinator.scan(
            image: ScannerTestImage.solid(),
            context: .test(engine: .localOnly),
            source: .livePreview
        )

        guard case .success(let scan) = result else {
            return XCTFail("Expected a local strategy result")
        }
        XCTAssertEqual(scan.primary.details.identity.id, "local")
        XCTAssertEqual(recorder.kinds, [.artworkFingerprint])
    }

    func testServerOnlyFlowIsPhotoOnly() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .serverHash,
                    supportsLiveScanning: true,
                    behavior: .match(cardID: "server"),
                    recorder: recorder
                )
            ],
            apiService: APIService()
        )

        XCTAssertTrue(coordinator.canScan(mode: .pokemon, preferredEngine: .serverHash))
        XCTAssertFalse(coordinator.supportsLiveScanning(for: .pokemon, preferredEngine: .serverHash))

        let result = await coordinator.scan(
            image: ScannerTestImage.solid(),
            context: .test(engine: .serverHash),
            source: .livePreview
        )
        guard case .failure(.ineligibleMode) = result else {
            return XCTFail("Server-only live preview must be rejected")
        }
        XCTAssertTrue(recorder.kinds.isEmpty)
    }

    func testSetScopeDropsOutOfScopeResultAndContinuesFallback() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .mlDetector,
                    behavior: .match(cardID: "wrong-set", setCode: "sv01"),
                    recorder: recorder
                ),
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    behavior: .match(cardID: "right-set", setCode: "sv02"),
                    recorder: recorder
                )
            ],
            apiService: APIService()
        )

        let result = await coordinator.scan(
            image: ScannerTestImage.solid(),
            context: .test(setCode: "SV02"),
            source: .photoCapture
        )
        guard case .success(let scan) = result else {
            return XCTFail("Expected the in-scope fallback result")
        }
        XCTAssertEqual(scan.primary.details.identity.id, "right-set")
        XCTAssertEqual(recorder.kinds, [.mlDetector, .artworkFingerprint])
    }
}

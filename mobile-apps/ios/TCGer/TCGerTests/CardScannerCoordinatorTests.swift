import XCTest
@testable import TCGer

@MainActor
final class CardScannerCoordinatorTests: XCTestCase {
    func testEnvironmentChoosesRecognitionEngineForRegularScans() {
        let viewModel = CardScannerViewModel(
            coordinator: CardScannerCoordinator(strategies: [], apiService: APIService())
        )
        let environment = EnvironmentStore()

        environment.serverConfiguration = .onDevice
        viewModel.selectedEngine = .serverEmbedding
        viewModel.updateEnvironment(environment)

        XCTAssertEqual(viewModel.selectedEngine, .localOnly)

        environment.serverConfiguration = ServerConfiguration(baseURL: "https://example.com")
        viewModel.updateEnvironment(environment)

        XCTAssertEqual(viewModel.selectedEngine, .automatic)
    }

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

    func testSessionCandidateCorrectionPersistsAndKeepsOriginalAsAlternative() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    behavior: .match(cardID: "original-card"),
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
        guard let originalResult = viewModel.sessionResults.first else {
            return XCTFail("Expected a scan result in the session")
        }
        viewModel.presentSessionResult(originalResult)

        let correctedCandidate = CardScanCandidate(
            details: CardDetails(
                identity: CardIdentity(
                    id: "corrected-card",
                    name: "Corrected Card",
                    game: .pokemon,
                    setCode: "ME05",
                    setName: "Mega Evolution"
                ),
                rarity: nil,
                imageURL: nil,
                price: nil
            ),
            confidence: CardScanConfidence(score: 0.88, reason: "alternative"),
            originatingStrategy: .artworkFingerprint
        )

        viewModel.selectCandidate(correctedCandidate, for: originalResult.id)

        XCTAssertEqual(viewModel.sessionResults.first?.primary.details.identity.id, "corrected-card")
        XCTAssertEqual(viewModel.latestResult?.primary.details.identity.id, "corrected-card")
        XCTAssertEqual(
            viewModel.sessionResults.first?.alternatives.map(\.details.identity.id),
            ["original-card"]
        )
    }

    func testRemovingSessionResultAlsoClearsAddedState() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    behavior: .match(cardID: "added-card"),
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
        guard let resultID = viewModel.sessionResults.first?.id else {
            return XCTFail("Expected a scan result in the session")
        }

        viewModel.markSessionResultsAdded([resultID])
        viewModel.removeSessionResult(id: resultID)

        XCTAssertTrue(viewModel.sessionResults.isEmpty)
        XCTAssertTrue(viewModel.addedSessionResultIDs.isEmpty)
    }

    func testManualTriggerModeDisablesLivePreviewWithoutDisablingPhotoScan() {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .mlDetector,
                    supportsLiveScanning: true,
                    behavior: .match(cardID: "live-card"),
                    recorder: recorder
                )
            ],
            apiService: APIService()
        )
        let viewModel = CardScannerViewModel(coordinator: coordinator)

        XCTAssertEqual(viewModel.triggerMode, .manual)
        XCTAssertFalse(viewModel.supportsLivePreview(.pokemon))

        viewModel.triggerMode = .automatic

        XCTAssertTrue(viewModel.supportsLivePreview(.pokemon))

        viewModel.triggerMode = .manual

        XCTAssertFalse(viewModel.supportsLivePreview(.pokemon))
        XCTAssertTrue(viewModel.isModeSupported(.pokemon))
    }

    func testBinderScanCanDeferReviewUntilBulkImportFinishes() async {
        let coordinator = CardScannerCoordinator(
            strategies: [],
            apiService: APIService()
        )
        let viewModel = CardScannerViewModel(coordinator: coordinator)
        let environment = EnvironmentStore()
        environment.serverConfiguration = .onDevice
        viewModel.updateEnvironment(environment)
        viewModel.captureMode = .binder

        await viewModel.scanBinderPage(
            image: ScannerTestImage.solid(),
            presentsReview: false
        )

        XCTAssertEqual(viewModel.binderPagesScanned, 1)
        XCTAssertNil(viewModel.binderReviewPresentation)

        viewModel.reopenBinderReview()

        XCTAssertNotNil(viewModel.binderReviewPresentation)
    }

    func testBinderRescanReplacesPhysicalPageAndContinuesPagination() async {
        let coordinator = CardScannerCoordinator(strategies: [], apiService: APIService())
        let viewModel = CardScannerViewModel(coordinator: coordinator)
        let environment = EnvironmentStore()
        environment.serverConfiguration = .onDevice
        viewModel.updateEnvironment(environment)
        viewModel.captureMode = .binder

        await viewModel.scanBinderPage(image: ScannerTestImage.solid(), presentsReview: false)
        viewModel.prepareToRescanBinderPage(1)
        await viewModel.scanBinderPage(image: ScannerTestImage.solid(), presentsReview: false)

        XCTAssertEqual(viewModel.binderPages.map(\.pageNumber), [1])
        XCTAssertEqual(viewModel.nextBinderPageNumber, 2)

        viewModel.setNextBinderPageNumber(7)
        await viewModel.scanBinderPage(image: ScannerTestImage.solid(), presentsReview: false)

        XCTAssertEqual(viewModel.binderPages.map(\.pageNumber), [1, 7])
        XCTAssertEqual(viewModel.nextBinderPageNumber, 8)
    }

    func testBinderDestinationCanBeSharedOrChosenPerPageForTheSession() {
        let coordinator = CardScannerCoordinator(strategies: [], apiService: APIService())
        let viewModel = CardScannerViewModel(coordinator: coordinator)
        viewModel.selectedBinderID = "session-binder"

        XCTAssertEqual(viewModel.binderDestinationMode, .oneBinder)
        XCTAssertEqual(viewModel.binderDestinationID(forPageNumber: 1), "session-binder")
        XCTAssertEqual(viewModel.binderDestinationID(forPageNumber: 2), "session-binder")

        viewModel.binderDestinationMode = .pageByPage
        viewModel.setBinderDestinationID("first-page-binder", forPageNumber: 1)
        viewModel.setBinderDestinationID("second-page-binder", forPageNumber: 2)

        XCTAssertEqual(viewModel.binderDestinationID(forPageNumber: 1), "first-page-binder")
        XCTAssertEqual(viewModel.binderDestinationID(forPageNumber: 2), "second-page-binder")
        XCTAssertEqual(viewModel.binderDestinationID(forPageNumber: 3), "session-binder")
    }

    func testClearingBinderSessionResetsDestinationChoices() {
        let coordinator = CardScannerCoordinator(strategies: [], apiService: APIService())
        let viewModel = CardScannerViewModel(coordinator: coordinator)
        viewModel.selectedBinderID = "session-binder"
        viewModel.binderDestinationMode = .pageByPage
        viewModel.setBinderDestinationID("page-binder", forPageNumber: 1)

        viewModel.clearBinderSession()

        XCTAssertEqual(viewModel.binderDestinationMode, .oneBinder)
        XCTAssertNil(viewModel.selectedBinderID)
        XCTAssertTrue(viewModel.binderPageDestinationIDs.isEmpty)
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

    func testOpenSetRejectionStopsLooserFallbacks() async {
        let recorder = ScanInvocationRecorder()
        let coordinator = CardScannerCoordinator(
            strategies: [
                StubScanStrategy(
                    kind: .mlDetector,
                    behavior: .failure(.rejectedInput),
                    recorder: recorder
                ),
                StubScanStrategy(
                    kind: .artworkFingerprint,
                    behavior: .match(cardID: "false-positive"),
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

        guard case .failure(.noMatch) = result else {
            return XCTFail("An open-set rejection should end the local matching chain")
        }
        XCTAssertEqual(recorder.kinds, [.mlDetector])
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

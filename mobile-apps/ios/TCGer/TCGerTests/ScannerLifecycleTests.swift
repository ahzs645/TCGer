import XCTest
@testable import TCGer

final class ScannerLifecycleTests: XCTestCase {
    func testAnalysisFinishingAfterExitAndReentryIsRejected() {
        var lifecycle = ScannerLiveAnalysisLifecycle()
        XCTAssertFalse(lifecycle.accepts(lifecycle.generation))
        lifecycle.setActive(true)
        let captured = lifecycle.generation
        XCTAssertTrue(lifecycle.accepts(captured))
        lifecycle.setActive(false)
        XCTAssertFalse(lifecycle.accepts(captured))
        lifecycle.setActive(true)
        XCTAssertFalse(lifecycle.accepts(captured))
        XCTAssertTrue(lifecycle.accepts(lifecycle.generation))
    }

    func testContextChangeRejectsOldWorkWithoutStoppingPreview() {
        var lifecycle = ScannerLiveAnalysisLifecycle()
        lifecycle.setActive(true)
        let captured = lifecycle.generation
        lifecycle.invalidate()
        XCTAssertTrue(lifecycle.isActive)
        XCTAssertFalse(lifecycle.accepts(captured))
        XCTAssertTrue(lifecycle.accepts(lifecycle.generation))
    }

    func testRepeatedVisibilityNotificationDoesNotInvalidateCurrentWork() {
        var lifecycle = ScannerLiveAnalysisLifecycle()
        lifecycle.setActive(true)
        let captured = lifecycle.generation
        lifecycle.setActive(true)
        XCTAssertTrue(lifecycle.accepts(captured))
    }

    func testVerifiedPackageSupportDoesNotNeedToReadMetadataAtStartup() {
        let store = CardIndexMetadataStore(
            fileURL: URL(fileURLWithPath: "/missing/Metadata.json"),
            supportedGames: [.yugioh]
        )
        XCTAssertEqual(store.supportedGames, [.yugioh])
    }
}

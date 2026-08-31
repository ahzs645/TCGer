import XCTest
@testable import TCGer

final class GameInstallationStateTests: XCTestCase {
    func testInstallationIsRequiredOnlyWithoutAnActiveOrExternalGame() {
        XCTAssertTrue(
            GameInstallationState.needsInstallation(
                enabledGameCount: 0,
                installedPackageCount: 0
            )
        )
        XCTAssertFalse(
            GameInstallationState.needsInstallation(
                enabledGameCount: 1,
                installedPackageCount: 0
            )
        )
        XCTAssertFalse(
            GameInstallationState.needsInstallation(
                enabledGameCount: 0,
                installedPackageCount: 1
            )
        )
    }
}

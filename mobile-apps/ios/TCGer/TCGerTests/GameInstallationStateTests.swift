import XCTest
@testable import TCGer

final class GameInstallationStateTests: XCTestCase {
    func testOnDeviceGamesAreActiveOnlyAfterTheirCatalogIsInstalled() {
        XCTAssertFalse(
            GameAvailabilityState.isActive(
                preferenceEnabled: true,
                isOnDevice: true,
                isInstalled: false
            )
        )
        XCTAssertTrue(
            GameAvailabilityState.isActive(
                preferenceEnabled: true,
                isOnDevice: true,
                isInstalled: true
            )
        )
        XCTAssertFalse(
            GameAvailabilityState.isActive(
                preferenceEnabled: false,
                isOnDevice: true,
                isInstalled: true
            )
        )
    }

    func testServerGamesDoNotRequireAnOnDeviceCatalog() {
        XCTAssertTrue(
            GameAvailabilityState.isActive(
                preferenceEnabled: true,
                isOnDevice: false,
                isInstalled: false
            )
        )
    }

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

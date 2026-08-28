import XCTest
@testable import TCGer

final class ScannerAssetPromptTests: XCTestCase {
    func testMultipleEnabledScannerModulesRequestExplicitGameChoice() {
        XCTAssertEqual(
            ScannerGameChoiceRequest.resolve(
                availableModes: [.automatic, .pokemon, .mtg, .yugioh]
            ),
            .choose(ScannerGameChoiceRequest(modes: [.pokemon, .mtg, .yugioh]))
        )
    }

    func testExplicitGameRequestBypassesChoice() {
        XCTAssertEqual(
            ScannerGameChoiceRequest.resolve(
                availableModes: [.pokemon, .mtg, .yugioh],
                requestedMode: .yugioh
            ),
            .select(.yugioh)
        )
    }

    func testSingleEnabledScannerModuleDoesNotAskRedundantQuestion() {
        XCTAssertEqual(
            ScannerGameChoiceRequest.resolve(availableModes: [.mtg]),
            .select(.mtg)
        )
    }

    func testUnavailableOrAutomaticOnlyModulesCannotBecomeGameChoices() {
        XCTAssertEqual(
            ScannerGameChoiceRequest.resolve(availableModes: [.automatic]),
            .unavailable
        )
    }

    func testMissingRuntimeRequestsFirstUseInstall() {
        XCTAssertEqual(
            ScannerAssetPromptRequest.recommended(
                for: .magic,
                installState: .notInstalled,
                updateAvailable: false
            ),
            ScannerAssetPromptRequest(game: .magic, kind: .install)
        )
    }

    func testInstalledRuntimeRequestsOnlyAvailableUpdates() {
        XCTAssertNil(
            ScannerAssetPromptRequest.recommended(
                for: .pokemon,
                installState: .installed(version: 1),
                updateAvailable: false
            )
        )
        XCTAssertEqual(
            ScannerAssetPromptRequest.recommended(
                for: .pokemon,
                installState: .installed(version: 1),
                updateAvailable: true
            ),
            ScannerAssetPromptRequest(game: .pokemon, kind: .update)
        )
    }
}

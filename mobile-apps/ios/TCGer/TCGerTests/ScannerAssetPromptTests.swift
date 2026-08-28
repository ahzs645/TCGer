import XCTest
@testable import TCGer

final class ScannerAssetPromptTests: XCTestCase {
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

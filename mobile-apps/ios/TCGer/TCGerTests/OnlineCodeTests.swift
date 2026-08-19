import XCTest
@testable import TCGer

@MainActor
final class OnlineCodeTests: XCTestCase {
    func testParserDeduplicatesNormalizedCodes() {
        XCTAssertEqual(
            OnlineCodeParser.parse(" abcd-1234 \nABCD-1234, WXYZ-9876\nno"),
            ["abcd-1234", "WXYZ-9876"]
        )
    }

    func testParserExtractsPokemonQRPayloadAndDeduplicatesPrintedCode() {
        let code = "ZNM1-B6Z2-4PL3-YYM"
        let url = "https://pokemon.com/redeem?2d_code=\(code)"
        XCTAssertEqual(OnlineCodeParser.canonicalCode(url), code)
        XCTAssertEqual(OnlineCodeParser.parse("\(url)\n\(code)"), [code])
    }

    func testLiveTextExtractsMTGArenaCodesWithoutCapturingCardCopy() {
        let text = "THANKS FOR COMING TO THE PRERELEASE ABC12-3DE45-FG678-9HIJK-LM012"
        XCTAssertEqual(
            OnlineCodeParser.extractCandidates(from: text),
            ["ABC12-3DE45-FG678-9HIJK-LM012"]
        )
        XCTAssertTrue(OnlineCodeParser.extractCandidates(from: "THANKS-FOR-COMING").isEmpty)
    }

    func testPhoneOnlyCodesPersistStatusAndDetails() throws {
        let repository = OnlineCodeMemoryRepository()
        let store = LocalStore(persistenceRepository: repository)

        let result = try store.createOnlineCodes(
            tcg: "pokemon",
            codes: ["ABCD-1234", " abcd-1234 ", "WXYZ-9876"],
            source: .manual,
            productName: "Booster box",
            notes: nil
        )
        XCTAssertEqual(result.created, 2)
        XCTAssertEqual(result.duplicates, 1)

        let qrResult = try store.createOnlineCodes(
            tcg: "pokemon",
            codes: [
                "https://pokemon.com/redeem?2d_code=QR12-CODE-3456",
                "QR12-CODE-3456"
            ],
            source: .camera,
            productName: nil,
            notes: nil
        )
        XCTAssertEqual(qrResult.created, 1)
        XCTAssertEqual(qrResult.duplicates, 1)

        let magicResult = try store.createOnlineCodes(
            tcg: "magic",
            codes: ["ABCDE-12345-FGHIJ-67890-KLMNO"],
            source: .camera,
            productName: "Prerelease reward",
            notes: nil
        )
        XCTAssertEqual(magicResult.created, 1)
        XCTAssertEqual(store.getOnlineCodes().count, 4)
        XCTAssertEqual(store.getOnlineCodes(tcg: "magic").count, 1)

        let first = try XCTUnwrap(result.items.first)
        let updated = try store.updateOnlineCode(
            id: first.id,
            status: .redeemed,
            productName: "Destined Rivals",
            notes: "Redeemed on desktop",
            updateDetails: true
        )
        XCTAssertEqual(updated.status, .redeemed)
        XCTAssertNotNil(updated.redeemedAt)
        XCTAssertEqual(updated.productName, "Destined Rivals")

        let reloaded = LocalStore(persistenceRepository: repository)
        XCTAssertEqual(reloaded.getOnlineCodes(tcg: "pokemon").count, 3)
        XCTAssertEqual(
            reloaded.getOnlineCodes(tcg: "pokemon").first { $0.id == first.id }?.status,
            .redeemed
        )
    }
}

private final class OnlineCodeMemoryRepository: LocalStorePersistenceRepository {
    private var payload: Data?

    func load() throws -> Data? { payload }
    func save(_ payload: Data) throws { self.payload = payload }
    func remove() throws { payload = nil }
    func availableBackups() throws -> [URL] { [] }
    func createBackup(_ payload: Data) throws -> URL { throw CocoaError(.fileWriteUnknown) }
    func loadBackup(at url: URL) throws -> Data { throw CocoaError(.fileReadUnknown) }
    func removeBackup(at url: URL) throws {}
}

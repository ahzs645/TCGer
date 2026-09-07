import CryptoKit
import Foundation
@testable import TCGer
import XCTest

final class FutureGameTests: XCTestCase {
    private func data(_ name: String) throws -> Data {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return try Data(contentsOf: root.appendingPathComponent("docs/scanner-system/examples/star-garden/\(name)"))
    }
    @MainActor func testFutureGameFixtureUsesPortableContracts() throws {
        let decoder = JSONDecoder()
        let manifest = try decoder.decode(GamePackageManifest.self, from: data("game-package.json"))
        for asset in [manifest.catalog.asset, try XCTUnwrap(manifest.pricing).asset, try XCTUnwrap(manifest.offlinePacks).manifest] {
            let bytes = try data(asset.url)
            XCTAssertEqual(bytes.count, asset.bytes)
            XCTAssertEqual(SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined(), asset.sha256)
        }
        let definition = try XCTUnwrap(manifest.definition)
        try XCTUnwrap(definition.deckRules).validateContract()
        XCTAssertEqual(TCGGame(rawValue: "star-garden")?.rawValue, "star-garden")
        XCTAssertNil(TCGGame(rawValue: "../invalid"))
        XCTAssertEqual(ScanMode.game(try XCTUnwrap(TCGGame(rawValue: "star-garden"))).tcgGame.rawValue, "star-garden")
        let packs = try decoder.decode(GamePackLibrary.self, from: data("packs.json")); try packs.validateContract()
        XCTAssertEqual(try packs.packs[0].open(random: { 0 }), ["captain-1", "scout-1", "scout-2"])
        let prices = try decoder.decode(GamePriceSnapshot.self, from: data("prices.json")); try prices.validateContract()
        let now = try XCTUnwrap(gameCapabilityDate("2026-09-05"))
        XCTAssertEqual(prices.quote(cardId: "scout-1", currency: "USD", printingKey: "scout-1", finishCode: "matte", condition: "NM", language: "English", now: now)?.amount, 2)
        XCTAssertNil(prices.quote(cardId: "scout-1", currency: "CAD", printingKey: "scout-1", finishCode: "matte", condition: "NM", language: "English", now: now))
        XCTAssertEqual(definition.printings?.finishes.first?.foil, false)
    }
    func testDatedLegalityDoesNotFallBackOutsideCoverage() throws {
        let periods = [GameLegalityPeriod(format: "duel", legal: true, validFrom: "2026-01-01", validTo: "2026-02-01")]
        XCTAssertNil(gameCardLegality(format: "duel", legality: ["duel": true], periods: periods, now: try XCTUnwrap(gameCapabilityDate("2026-02-01"))))
    }
}

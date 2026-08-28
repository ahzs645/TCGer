import CryptoKit
import Foundation
@testable import TCGer
import XCTest

final class GamePackageFixtureTests: XCTestCase {
    func testCodexCrittersDecodesAndVerifiesAsUnknownGamePackage() throws {
        let directory = fixtureDirectory
        let manifestData = try Data(contentsOf: directory.appendingPathComponent("codex-critters.game-package.json"))
        let manifest = try JSONDecoder().decode(GamePackageManifest.self, from: manifestData)
        let catalogURL = directory.appendingPathComponent(manifest.catalog.asset.url)
        let catalogData = try Data(contentsOf: catalogURL)
        let catalog = try XCTUnwrap(try JSONSerialization.jsonObject(with: catalogData) as? [String: Any])
        let cards = try XCTUnwrap(catalog["cards"] as? [[String: Any]])
        let sets = try XCTUnwrap(catalog["sets"] as? [[String: Any]])

        XCTAssertEqual(manifest.game.id, "codex-critters")
        XCTAssertNil(manifest.scanner)
        XCTAssertNil(manifest.offlinePacks)
        XCTAssertEqual(catalogData.count, manifest.catalog.asset.bytes)
        XCTAssertEqual(SHA256.hash(data: catalogData).hexString, manifest.catalog.asset.sha256)
        XCTAssertEqual(catalog["tcg"] as? String, manifest.game.id)
        XCTAssertEqual(cards.count, manifest.catalog.cardCount)
        XCTAssertEqual(sets.count, manifest.catalog.setCount)
        XCTAssertEqual(Set(cards.compactMap { $0["id"] as? String }).count, cards.count)
        XCTAssertEqual(Set(manifest.filters.map(\.type)), ["select", "multiSelect", "numberRange", "boolean", "text"])
    }

    private var fixtureDirectory: URL {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<5 { root.deleteLastPathComponent() }
        return root.appendingPathComponent("docs/scanner-system/examples/codex-critters", isDirectory: true)
    }
}

private extension SHA256.Digest {
    var hexString: String { map { String(format: "%02x", $0) }.joined() }
}

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
        XCTAssertEqual(manifest.packageId, "codex-critters-library")
        XCTAssertEqual(manifest.publisher.id, "tcger-fixtures")
        XCTAssertEqual(manifest.installedId, "tcger-fixtures--codex-critters-library")
        XCTAssertEqual(manifest.effectiveDefinition.id, manifest.game.id)
        XCTAssertEqual(manifest.effectiveDefinition.interfaces?.search, true)
        XCTAssertEqual(manifest.effectiveDefinition.interfaces?.scanner, false)
        XCTAssertEqual(manifest.effectiveDefinition.interfaces?.supportsFeature("tcger-fixtures--critter-index"), true)
        XCTAssertEqual(manifest.effectiveDefinition.collection.defaultIdentityMode, "collector")
        XCTAssertEqual(manifest.effectiveDefinition.search.facets.count, 5)
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

    func testDuplicatePackageAndCatalogCopiesAreGatedButUpdatesAreAllowed() throws {
        let data = try Data(contentsOf: fixtureDirectory.appendingPathComponent("codex-critters.game-package.json"))
        let installed = try JSONDecoder().decode(GamePackageManifest.self, from: data)
        XCTAssertEqual(duplicateGamePackage(in: [installed], candidate: installed), .samePackage)

        var includedObject = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        includedObject["packageId"] = "pokemon-catalog"
        includedObject["game"] = ["id": "pokemon", "name": "Pokémon"]
        includedObject["publisher"] = ["id": "tcger", "name": "TCGer"]
        includedObject["definition"] = nil
        let included = try JSONDecoder().decode(GamePackageManifest.self, from: JSONSerialization.data(withJSONObject: includedObject))
        XCTAssertEqual(duplicateGamePackage(in: [], candidate: included), .included)

        var renamedObject = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        renamedObject["packageId"] = "renamed-critters-library"
        renamedObject["publisher"] = ["id": "another-publisher", "name": "Another Publisher"]
        let renamed = try JSONDecoder().decode(GamePackageManifest.self, from: JSONSerialization.data(withJSONObject: renamedObject))
        XCTAssertEqual(duplicateGamePackage(in: [installed], candidate: renamed), .sameCatalog)

        var updateObject = try XCTUnwrap(try JSONSerialization.jsonObject(with: data) as? [String: Any])
        updateObject["packageVersion"] = "fixture-2"
        var catalog = try XCTUnwrap(updateObject["catalog"] as? [String: Any])
        var asset = try XCTUnwrap(catalog["asset"] as? [String: Any])
        asset["sha256"] = String(repeating: "a", count: 64)
        catalog["asset"] = asset
        updateObject["catalog"] = catalog
        let update = try JSONDecoder().decode(GamePackageManifest.self, from: JSONSerialization.data(withJSONObject: updateObject))
        XCTAssertNil(duplicateGamePackage(in: [installed], candidate: update))
    }

    func testPackageUpdatesAreMonotonicAndConflictsDoNotReplaceInstalledData() throws {
        let data = try Data(contentsOf: fixtureDirectory.appendingPathComponent("codex-critters.game-package.json"))
        let decoder = JSONDecoder()
        let current = try decoder.decode(GamePackageManifest.self, from: data)
        let source = try XCTUnwrap(String(data: data, encoding: .utf8))
        let next = try decoder.decode(
            GamePackageManifest.self,
            from: Data(source
                .replacingOccurrences(of: current.publishedAt, with: "2026-08-29T00:00:00Z")
                .replacingOccurrences(of: current.packageVersion, with: "fixture-2")
                .replacingOccurrences(of: "\"sequence\": 1", with: "\"sequence\": 2")
                .utf8)
        )
        let conflict = try decoder.decode(
            GamePackageManifest.self,
            from: Data(source.replacingOccurrences(of: current.packageVersion, with: "fixture-conflict").utf8)
        )

        XCTAssertEqual(gamePackageReleaseRelation(current: current, candidate: next), .update)
        XCTAssertEqual(gamePackageReleaseRelation(current: next, candidate: current), .downgrade)
        XCTAssertEqual(gamePackageReleaseRelation(current: current, candidate: current), .same)
        XCTAssertEqual(gamePackageReleaseRelation(current: current, candidate: conflict), .conflict)
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

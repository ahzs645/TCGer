import Foundation
import XCTest
@testable import TCGer

final class CatalogManifestMergeTests: XCTestCase {
    @MainActor
    func testBundledCatalogsInstallAndExposeSets() async throws {
        let source = BundledCatalogSource(bundle: .main)
        do {
            _ = try await source.data(for: "manifest.json")
        } catch {
            throw XCTSkip("Bundled catalogs are optional in clean-clone builds")
        }

        let suiteName = "CatalogManifestMergeTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let store = CatalogStore(
            source: source,
            defaults: defaults
        )
        let games: [TCGGame] = [.yugioh, .magic, .pokemon, .onepiece, .lorcana]

        await store.refreshManifest()
        await store.configure(enabledGames: games)

        let packages = await store.officialGamePackages()
        XCTAssertEqual(Set(packages.map(\.game)), Set(games))
        XCTAssertTrue(packages.allSatisfy { $0.manifest.publisher.id == "tcger" })

        for game in games {
            try await store.install(game)
            XCTAssertTrue(store.isLoaded(game), "Expected \(game.rawValue) to load")
            XCTAssertFalse(store.sets(tcg: game).isEmpty, "Expected \(game.rawValue) sets")
        }
    }

    func testNewerBundledEntriesOverrideRemoteAndMissingGamesAreAdded() throws {
        let remote = try manifestData(
            generatedAt: "2026-07-24T00:00:00Z",
            games: [
                "pokemon": entry(version: 1, file: "pokemon.v1.old.pack.json")
            ]
        )
        let bundled = try manifestData(
            generatedAt: "2026-08-04T00:00:00Z",
            games: [
                "pokemon": entry(version: 2, file: "pokemon.v2.new.pack.json"),
                "lorcana": entry(version: 1, file: "lorcana.v1.new.pack.json")
            ]
        )

        let mergedData = RemoteCatalogSource.mergeManifest(remote: remote, bundled: bundled)
        let merged = try JSONDecoder().decode(CatalogManifest.self, from: mergedData)

        XCTAssertEqual(merged.generatedAt, "2026-08-04T00:00:00Z")
        XCTAssertEqual(merged.games["pokemon"]?.version, 2)
        XCTAssertEqual(merged.games["pokemon"]?.file, "pokemon.v2.new.pack.json")
        XCTAssertEqual(merged.games["lorcana"]?.version, 1)
    }

    func testNewerRemoteEntryIsPreserved() throws {
        let remote = try manifestData(
            generatedAt: "2026-08-05T00:00:00Z",
            games: ["magic": entry(version: 3, file: "magic.v3.remote.pack.json")]
        )
        let bundled = try manifestData(
            generatedAt: "2026-08-04T00:00:00Z",
            games: ["magic": entry(version: 2, file: "magic.v2.bundled.pack.json")]
        )

        let mergedData = RemoteCatalogSource.mergeManifest(remote: remote, bundled: bundled)
        let merged = try JSONDecoder().decode(CatalogManifest.self, from: mergedData)

        XCTAssertEqual(merged.games["magic"]?.version, 3)
        XCTAssertEqual(merged.games["magic"]?.file, "magic.v3.remote.pack.json")
    }

    func testMatchingRemoteEntryInheritsBundledPackageFile() throws {
        let packageFile = "pokemon.game-package.json"
        let remoteEntry = entry(version: 2, file: "pokemon.v2.pack.json")
        var bundledEntry = remoteEntry
        bundledEntry.packageFile = packageFile
        let remote = try manifestData(
            generatedAt: "2026-08-29T00:00:00Z",
            games: ["pokemon": remoteEntry]
        )
        let bundled = try manifestData(
            generatedAt: "2026-08-30T00:00:00Z",
            games: ["pokemon": bundledEntry]
        )

        let mergedData = RemoteCatalogSource.mergeManifest(remote: remote, bundled: bundled)
        let merged = try JSONDecoder().decode(CatalogManifest.self, from: mergedData)

        XCTAssertEqual(merged.games["pokemon"]?.packageFile, packageFile)
    }

    private func entry(version: Int, file: String) -> CatalogManifestGame {
        CatalogManifestGame(
            version: version,
            cardCount: 1,
            setCount: 1,
            bytes: 1,
            sha256: String(repeating: "a", count: 64),
            file: file
        )
    }

    private func manifestData(
        generatedAt: String,
        games: [String: CatalogManifestGame]
    ) throws -> Data {
        try JSONEncoder().encode(
            CatalogManifest(formatVersion: 1, generatedAt: generatedAt, games: games)
        )
    }
}

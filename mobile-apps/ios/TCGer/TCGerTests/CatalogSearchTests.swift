import CryptoKit
import Foundation
import XCTest
@testable import TCGer

@MainActor
final class CatalogSearchTests: XCTestCase {
    func testNamePrefixRankingIsPreserved() async throws {
        let fixture = try await makeFixture()
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        let ids = fixture.store.search(query: "Lucario", tcg: .pokemon, limit: 20)
            .map(\.card.id)

        XCTAssertEqual(
            ids,
            ["lucario-v", "tk-dp-l-3", "mega-lucario", "lukario-trick"]
        )
    }

    func testWordBoundaryPrefixRanksAheadOfCollapsedPrefix() async throws {
        let fixture = try await makeFixture()
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        XCTAssertEqual(
            fixture.store.search(query: "Darkrai", tcg: .pokemon, limit: 20).map(\.card.id),
            ["darkrai-vstar", "darkrai", "dark-raichu"]
        )
    }

    func testTermsCanMatchAcrossNameAndDerivedCollectorFraction() async throws {
        let fixture = try await makeFixture()
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        let compound = fixture.store.search(
            query: "Lucario 3/11",
            tcg: .pokemon,
            limit: 20
        )
        XCTAssertEqual(compound.map(\.card.id), ["tk-dp-l-3"])

        let fraction = fixture.store.search(query: "3/11", tcg: .pokemon, limit: 20)
        XCTAssertEqual(fraction.map(\.card.id), ["tk-dp-l-3"])

        let exactNumber = fixture.store.search(query: "3", tcg: .pokemon, limit: 20)
        XCTAssertEqual(exactNumber.map(\.card.id), ["tk-dp-l-3"])
        XCTAssertFalse(exactNumber.map(\.card.id).contains("mega-lucario"))

        XCTAssertTrue(
            fixture.store.search(query: "Lucario 3/12", tcg: .pokemon, limit: 20).isEmpty
        )

        let entry = try XCTUnwrap(compound.first)
        XCTAssertEqual(fixture.store.displayCollectorNumber(for: entry), "3/11")
        let mappedCard = fixture.store.card(from: entry)
        XCTAssertEqual(mappedCard.collectorNumber, "3")
        XCTAssertEqual(mappedCard.attributes?["collector_number_display"], .string("3/11"))
    }

    func testCuratedPrintedIdentifierAliasesFindExactCard() async throws {
        let fixture = try await makeFixture()
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        XCTAssertEqual(
            fixture.store.search(query: "DPBP#506", tcg: .pokemon, limit: 20).map(\.card.id),
            ["tk-dp-l-3"]
        )
        XCTAssertEqual(
            fixture.store.search(query: "DPBP506", tcg: .pokemon, limit: 20).map(\.card.id),
            ["tk-dp-l-3"]
        )
        XCTAssertEqual(
            fixture.store.search(
                query: "Lucario DPBP#506",
                tcg: .pokemon,
                limit: 20
            ).map(\.card.id),
            ["tk-dp-l-3"]
        )
    }

    func testSingleEditTypoIsOnlyUsedWhenExactSearchIsEmpty() async throws {
        let fixture = try await makeFixture()
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        let misspelled = fixture.store.search(query: "Lucaio", tcg: .pokemon, limit: 20)
        XCTAssertEqual(
            misspelled.map(\.card.id),
            ["lucario-v", "tk-dp-l-3", "mega-lucario"]
        )

        let exactWins = fixture.store.search(query: "Lukario", tcg: .pokemon, limit: 20)
        XCTAssertEqual(exactWins.map(\.card.id), ["lukario-trick"])
        XCTAssertFalse(exactWins.map(\.card.id).contains("tk-dp-l-3"))

        XCTAssertTrue(
            fixture.store.search(query: "Lukx", tcg: .pokemon, limit: 20).isEmpty,
            "Short queries must not activate typo tolerance"
        )
    }

    func testIndexedAsyncSearchMatchesLegacyRankingAndLimits() async throws {
        let fixture = try await makeFixture()
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        let cases: [(query: String, limit: Int)] = [
            ("Lucario", 20),
            ("cario", 20),
            ("trainer kit", 20),
            ("Lucario 3/11", 20),
            ("DPBP#506", 20),
            ("3", 20),
            ("Lucaio", 20),
            ("Lucario", 2),
            ("Lukx", 20),
        ]

        for testCase in cases {
            let legacy = fixture.store.search(
                query: testCase.query,
                tcg: .pokemon,
                limit: testCase.limit
            )
            let indexed = await fixture.store.searchAsync(
                query: testCase.query,
                tcg: .pokemon,
                limit: testCase.limit
            )
            XCTAssertEqual(
                indexed.map(\.card.id),
                legacy.map(\.card.id),
                "Indexed search changed results for \(testCase.query)"
            )
        }
    }

    func testDerivedCollectorFractionsArePokemonOnly() {
        XCTAssertEqual(
            CatalogStore.displayCollectorNumber("3", tcg: .pokemon, officialCardCount: 11),
            "3/11"
        )
        XCTAssertEqual(
            CatalogStore.displayCollectorNumber("3", tcg: .magic, officialCardCount: 11),
            "3"
        )
        XCTAssertEqual(
            CatalogStore.displayCollectorNumber("LOB-001", tcg: .yugioh, officialCardCount: 126),
            "LOB-001"
        )
    }

    func testCanonicalCollectionTagsSupportExactOfflineGuideSearch() async throws {
        let fixture = try await makeFixture()
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        XCTAssertTrue(fixture.store.hasCollectionTagMetadata(for: .pokemon))
        let entries = fixture.store.cards(tagged: "pokemon.art.clay", tcg: .pokemon)
        XCTAssertEqual(entries.map(\.card.id), ["lucario-v"])
        XCTAssertEqual(
            fixture.store.card(from: try XCTUnwrap(entries.first))
                .attributes?["collection_tags"],
            .array([.string("pokemon.art.clay")])
        )
    }

    func testPocketMetadataParticipatesInOfflineSearchAndCardMapping() async throws {
        let fixture = try await makeFixture()
        defer { fixture.defaults.removePersistentDomain(forName: fixture.suiteName) }

        let attackResults = fixture.store.search(
            query: "Aura Sphere",
            tcg: .pokemon,
            limit: 20
        )
        XCTAssertEqual(attackResults.map(\.card.id), ["lucario-v"])
        XCTAssertTrue(
            fixture.store.search(query: "Pokémon Pocket", tcg: .pokemon, limit: 20)
                .contains { $0.card.id == "lucario-v" }
        )

        let entry = try XCTUnwrap(attackResults.first)
        let mappedCard = fixture.store.card(from: entry)
        XCTAssertEqual(mappedCard.pokemonPrint?.format, .pocket)
        XCTAssertEqual(mappedCard.pokemonPrint?.pocket?.hp, 120)
        XCTAssertEqual(mappedCard.pokemonPrint?.pocket?.attacks?.first?.damage, "70")

        let set = try XCTUnwrap(fixture.store.sets(tcg: .pokemon).first)
        let mappedSet = fixture.store.tcgSet(from: set, tcg: .pokemon)
        XCTAssertEqual(mappedSet.pokemonFormat, .pocket)
        XCTAssertEqual(mappedSet.boosters?.first?.name, "Lucario Pack")
    }

    private func makeFixture() async throws -> Fixture {
        let pack = Data(
            #"""
            {
              "formatVersion": 1,
              "tcg": "pokemon",
              "version": 1,
              "updatedAt": "2026-08-10T00:00:00Z",
              "sets": [
                {
                  "code": "tk-dp-l",
                  "name": "DP trainer Kit (Lucario)",
                  "serie": "tcgp",
                  "count": 11,
                  "standardCount": 11,
                  "boosters": [{"id":"boo_lucario","name":"Lucario Pack"}]
                },
                {
                  "code": "rocket",
                  "name": "Team Rocket",
                  "serie": "base",
                  "count": 3,
                  "standardCount": 3
                }
              ],
              "cards": [
                {"id":"dark-raichu","name":"Dark Raichu","setCode":"rocket","collectorNumber":"1"},
                {"id":"darkrai-vstar","name":"Darkrai VSTAR","setCode":"rocket","collectorNumber":"2"},
                {"id":"darkrai","name":"Darkrai","setCode":"rocket","collectorNumber":"3"},
                {"id":"mega-lucario","name":"Mega Lucario","setCode":"tk-dp-l","collectorNumber":"13"},
                {"id":"lucario-v","name":"Lucario V","setCode":"tk-dp-l","collectorNumber":"4","collectionTags":["pokemon.art.clay"],"type":"Pokémon","pokemonPocket":{"hp":120,"effect":"Charge your attack.","attacks":[{"cost":["Fighting"],"name":"Aura Sphere","damage":"70"}],"boosters":[{"id":"boo_lucario","name":"Lucario Pack"}]}},
                {"id":"tk-dp-l-3","name":"Lucario","setCode":"tk-dp-l","collectorNumber":"3","rarity":"Promo"},
                {"id":"lukario-trick","name":"Lukario's Trick","setCode":"tk-dp-l","collectorNumber":"7"}
              ]
            }
            """#.utf8
        )
        let digest = SHA256.hash(data: pack).map { String(format: "%02x", $0) }.joined()
        let manifest = try JSONEncoder().encode(
            CatalogManifest(
                formatVersion: 1,
                generatedAt: "2026-08-10T00:00:00Z",
                games: [
                    "pokemon": CatalogManifestGame(
                        version: 1,
                        cardCount: 7,
                        setCount: 2,
                        bytes: pack.count,
                        sha256: digest,
                        file: "pokemon.test.pack.json"
                    )
                ]
            )
        )
        let source = CatalogSearchTestSource(
            files: [
                "manifest.json": manifest,
                "pokemon.test.pack.json": pack
            ]
        )
        let suiteName = "CatalogSearchTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        let store = CatalogStore(source: source, defaults: defaults)

        await store.refreshManifest()
        await store.configure(enabledGames: [.pokemon])
        try await store.install(.pokemon)

        return Fixture(
            store: store,
            defaults: defaults,
            suiteName: suiteName
        )
    }

    private struct Fixture {
        let store: CatalogStore
        let defaults: UserDefaults
        let suiteName: String
    }
}

private struct CatalogSearchTestSource: CatalogSource {
    let files: [String: Data]

    func data(for filename: String) async throws -> Data {
        guard let data = files[filename] else {
            throw CatalogStore.StoreError.resourceUnavailable(filename)
        }
        return data
    }

    func remove(_ filename: String) async {}
}

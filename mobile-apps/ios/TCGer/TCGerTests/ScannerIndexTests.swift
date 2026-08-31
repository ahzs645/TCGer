import XCTest
@testable import TCGer

final class ScannerIndexTests: XCTestCase {
    @MainActor
    func testCandidateMagicPackageInstallsAtomicallyWhenConfigured() async throws {
        let environmentKey = "TCGER_IOS_SCANNER_CANDIDATE_BASE_URL"
        let environmentURL = ProcessInfo.processInfo.environment[environmentKey].flatMap(URL.init(string:))
        guard let baseURL = environmentURL ?? ScannerAssetConfiguration.baseURL(),
              baseURL.path.contains("candidate") else {
            throw XCTSkip("Set \(environmentKey) or the candidate scanner build setting to run the native Magic install gate.")
        }

        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("MagicScannerCandidate-\(UUID().uuidString)", isDirectory: true)
        let suiteName = "ScannerIndexTests.MagicCandidate.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defer {
            try? FileManager.default.removeItem(at: root)
            defaults.removePersistentDomain(forName: suiteName)
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 120
        configuration.timeoutIntervalForResource = 600
        let productionStore = ScannerAssetStore(
            baseURL: URL(string: "https://assets.tcger.ahmadjalil.com/ios/scan-assets"),
            session: URLSession(configuration: configuration),
            defaults: defaults,
            rootDirectory: root
        )
        try await productionStore.install(.magic)
        XCTAssertEqual(productionStore.installedVersions[.magic], 1)

        let store = ScannerAssetStore(
            baseURL: baseURL,
            session: URLSession(configuration: configuration),
            defaults: defaults,
            rootDirectory: root
        )

        XCTAssertEqual(store.installedVersions[.magic], 1)
        try await store.refreshManifest(for: .magic)
        XCTAssertTrue(store.isUpdateAvailable(.magic))
        try await store.install(.magic)

        let manifest = try XCTUnwrap(store.manifests[.magic])
        let runtime = try XCTUnwrap(store.runtime(for: .magic))
        XCTAssertEqual(manifest.formatVersion, 3)
        XCTAssertEqual(manifest.version, 2)
        XCTAssertEqual(manifest.cardCount, 67_849)
        XCTAssertEqual(manifest.printingCount, 109_546)
        XCTAssertEqual(manifest.metadataSchema, "tcger-cards-index-metadata-v3")
        XCTAssertEqual(manifest.recognitionContract, "tcger-two-stage-recognition-v2")
        XCTAssertTrue(FileManager.default.fileExists(atPath: runtime.modelURL.path))
        XCTAssertEqual(
            try FileManager.default.attributesOfItem(atPath: runtime.vectorsURL.path)[.size] as? Int,
            manifest.vectors.bytes
        )
        XCTAssertEqual(
            try FileManager.default.attributesOfItem(atPath: runtime.metadataURL.path)[.size] as? Int,
            manifest.metadata.bytes
        )
        let installedDirectories = try FileManager.default.contentsOfDirectory(
            at: root.appendingPathComponent(TCGGame.magic.rawValue, isDirectory: true),
            includingPropertiesForKeys: nil
        )
        XCTAssertEqual(installedDirectories.map(\.lastPathComponent), ["version-2"])
    }

    func testPackedFileIndexMatchesDequantizedReference() async throws {
        let packed: [[Int8]] = [
            [127, 0, 0, 0],
            [90, 90, 0, 0],
            [0, 127, 0, 0],
            [-127, 0, 0, 0],
        ]
        let query: [Float] = [0.8, 0.2, 0, 0]
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("ScannerIndexTests-\(UUID().uuidString).bin")
        defer { try? FileManager.default.removeItem(at: fileURL) }
        try Self.writePackedIndex(packed, to: fileURL)

        let fileStore = AnnoyIndexStore(fileURL: fileURL)
        let referenceStore = AnnoyIndexStore(vectors: packed.map { row in
            row.map { Float($0) / 127 }
        })
        let allowed: Set<Int> = [0, 1, 2, 3]

        let actual = try await fileStore.nearestNeighbors(
            for: query,
            limit: 3,
            allowedIndices: allowed
        )
        let expected = try await referenceStore.nearestNeighbors(
            for: query,
            limit: 3,
            allowedIndices: allowed
        )

        XCTAssertEqual(actual.map(\.index), expected.map(\.index))
        for (lhs, rhs) in zip(actual, expected) {
            XCTAssertEqual(lhs.distance, rhs.distance, accuracy: 1e-6)
        }
    }

    func testPackedFileIndexRespectsAllowedIndices() async throws {
        let packed: [[Int8]] = [
            [127, 0],
            [120, 20],
            [0, 127],
        ]
        let fileURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("ScannerIndexTests-\(UUID().uuidString).bin")
        defer { try? FileManager.default.removeItem(at: fileURL) }
        try Self.writePackedIndex(packed, to: fileURL)

        let store = AnnoyIndexStore(fileURL: fileURL)
        let matches = try await store.nearestNeighbors(
            for: [1, 0],
            limit: 3,
            allowedIndices: [1, 2, 99_999]
        )

        XCTAssertEqual(matches.map(\.index), [1, 2])
    }

    private static func writePackedIndex(_ rows: [[Int8]], to url: URL) throws {
        let dimension = try XCTUnwrap(rows.first?.count)
        XCTAssertTrue(rows.allSatisfy { $0.count == dimension })
        var count = Int32(rows.count).littleEndian
        var dim = Int32(dimension).littleEndian
        var data = withUnsafeBytes(of: &count) { Data($0) }
        data.append(withUnsafeBytes(of: &dim) { Data($0) })
        for row in rows {
            data.append(contentsOf: row.map { UInt8(bitPattern: $0) })
        }
        try data.write(to: url, options: .atomic)
    }

    func testMetadataEntryDecodingAndGameNormalization() throws {
        let data = Data(#"{"annIndex":7,"cardId":"abc","name":"Card","game":"yu-gi-oh","setCode":"LOB","collectorNumber":"001","setName":"Legend of Blue Eyes","rarity":"Rare","imageURL":"https://example.com/card.jpg","price":1.25}"#.utf8)
        let entry = try JSONDecoder().decode(CardIndexMetadataEntry.self, from: data)

        XCTAssertEqual(entry.annIndex, 7)
        XCTAssertEqual(entry.resolvedGame, .yugioh)
        XCTAssertEqual(entry.collectorNumber, "001")
        XCTAssertEqual(entry.resolvedRecognitionFamilyId, "yugioh:legacy-name:card")
    }

    func testMetadataStoreCarriesLegacyFamilyAndCollectorNumberIntoDetails() async throws {
        let store = CardIndexMetadataStore(entries: [
            CardIndexMetadataEntry(
                annIndex: 0,
                cardId: "0000419b-0bba-4488-8f7a-6194544ce91e",
                name: "Forest",
                game: "magic",
                setCode: "blb",
                collectorNumber: "280",
                setName: "Bloomburrow",
                rarity: "common",
                imageURL: nil,
                price: nil
            )
        ])

        let loaded = await store.details(for: 0)
        let details = try XCTUnwrap(loaded)
        XCTAssertEqual(details.identity.collectorNumber, "280")
        XCTAssertEqual(details.identity.recognitionFamilyID, "magic:legacy-name:forest")
        XCTAssertEqual(
            details.identity.exactPrintingID,
            "0000419b-0bba-4488-8f7a-6194544ce91e"
        )
    }

    func testMetadataStoreExpandsCompactVisualFamilyPrintings() async throws {
        let data = Data(#"[{"annIndex":0,"cardId":"new","exactPrintingId":"new","recognitionFamilyId":"magic:visual:shared","name":"Shared Art","game":"magic","setCode":"new","releaseDate":"2025-01-01","printings":[{"cardId":"new","exactPrintingId":"new","setCode":"new","setName":"New","releaseDate":"2025-01-01"},{"cardId":"old","exactPrintingId":"old","setCode":"old","setName":"Old","releaseDate":"2020-01-01"}]}]"#.utf8)
        let entries = try JSONDecoder().decode([CardIndexMetadataEntry].self, from: data)
        let store = CardIndexMetadataStore(entries: entries)

        let printings = await store.printingDetails(for: 0)
        let oldSetIndices = await store.indices(for: .magic, setCode: "old")
        XCTAssertEqual(printings.map(\.identity.id), ["new", "old"])
        XCTAssertEqual(oldSetIndices, [0])
    }

    func testVersionTwoMagicPackageRequiresExactPrintMetadata() throws {
        let manifest = try Self.scannerManifest(formatVersion: 2)
        let valid = Data(#"[{"annIndex":0,"cardId":"printing-a","exactPrintingId":"printing-a","recognitionFamilyId":"magic:illustration:art-a","visualIdentityId":"magic:printing:printing-a:front","name":"Shared Art","game":"magic","imageURL":"https://example.com/a.jpg","setCode":"one","collectorNumber":"10","releaseDate":"2024-02-02","faceSide":"front"}]"#.utf8)
        XCTAssertNoThrow(
            try ScannerAssetStore.validateMetadataData(valid, manifest: manifest)
        )

        let missingCollectorNumber = Data(#"[{"annIndex":0,"cardId":"printing-a","exactPrintingId":"printing-a","recognitionFamilyId":"magic:illustration:art-a","visualIdentityId":"magic:printing:printing-a:front","name":"Shared Art","game":"magic","imageURL":"https://example.com/a.jpg","setCode":"one","releaseDate":"2024-02-02","faceSide":"front"}]"#.utf8)
        XCTAssertThrowsError(
            try ScannerAssetStore.validateMetadataData(
                missingCollectorNumber,
                manifest: manifest
            )
        )
    }

    func testVersionOneMagicPackageKeepsLegacyCompatibility() throws {
        let manifest = try Self.scannerManifest(formatVersion: 1)
        let legacy = Data(#"[{"annIndex":0,"cardId":"printing-a","name":"Shared Art","game":"magic"}]"#.utf8)

        XCTAssertNoThrow(
            try ScannerAssetStore.validateMetadataData(legacy, manifest: manifest)
        )
    }

    func testVersionThreeMagicPackageValidatesNestedExactPrintings() throws {
        let manifest = try Self.scannerManifest(formatVersion: 3)
        let valid = Data(#"[{"annIndex":0,"cardId":"new","exactPrintingId":"new","recognitionFamilyId":"magic:visual:shared","name":"Shared Art","game":"magic","imageURL":"https://example.com/new.jpg","setCode":"new","collectorNumber":"10","releaseDate":"2025-01-01","printings":[{"cardId":"new","exactPrintingId":"new","imageURL":"https://example.com/new.jpg","setCode":"new","collectorNumber":"10","releaseDate":"2025-01-01"},{"cardId":"old","exactPrintingId":"old","imageURL":"https://example.com/old.jpg","setCode":"old","collectorNumber":"20","releaseDate":"2020-01-01"}]}]"#.utf8)
        XCTAssertNoThrow(try ScannerAssetStore.validateMetadataData(valid, manifest: manifest))

        let missingPrintings = Data(#"[{"annIndex":0,"cardId":"new","exactPrintingId":"new","recognitionFamilyId":"magic:visual:shared","name":"Shared Art","game":"magic","imageURL":"https://example.com/new.jpg","setCode":"new","collectorNumber":"10","releaseDate":"2025-01-01"}]"#.utf8)
        XCTAssertThrowsError(
            try ScannerAssetStore.validateMetadataData(missingPrintings, manifest: manifest)
        )
    }

    func testMetadataStoreFiltersByGameAndSetAndBuildsDetails() async {
        let store = CardIndexMetadataStore(entries: [
            metadata(index: 0, id: "p1", game: "pokemon", setCode: "sv01"),
            metadata(index: 1, id: "p2", game: "pokemon", setCode: "sv02"),
            metadata(index: 2, id: "m1", game: "magic", setCode: "lea")
        ])

        let pokemonIndices = await store.indices(for: .pokemon)
        let scopedIndices = await store.indices(for: .pokemon, setCode: "SV02")
        let magicDetails = await store.details(for: 2)

        XCTAssertEqual(pokemonIndices, [0, 1])
        XCTAssertEqual(scopedIndices, [1])
        XCTAssertEqual(magicDetails?.identity.game, .magic)
        XCTAssertEqual(magicDetails?.identity.id, "m1")
    }

    func testPhysicalCardIndicesExcludePocketRowsIncludingLegacyMetadata() async {
        let store = CardIndexMetadataStore(entries: [
            metadata(index: 0, id: "me05-003", game: "pokemon", setCode: "me05"),
            metadata(
                index: 1,
                id: "B2-004",
                game: "pokemon",
                setCode: "B2",
                imageURL: "https://assets.tcgdex.net/en/tcgp/B2/004/high.webp"
            ),
            metadata(
                index: 2,
                id: "A2-105",
                game: "pokemon",
                setCode: "A2",
                format: "pocket"
            ),
        ])

        let allPokemon = await store.indices(for: .pokemon)
        let physicalPokemon = await store.physicalCardIndices(for: .pokemon, setCode: nil)

        XCTAssertEqual(allPokemon, [0, 1, 2])
        XCTAssertEqual(physicalPokemon, [0])
    }

    func testAutomaticPhysicalCardIndicesSpanInstalledGameShards() async {
        let store = CardIndexMetadataStore(entries: [
            metadata(index: 0, id: "p1", game: "pokemon", setCode: "sv01"),
            metadata(index: 1, id: "m1", game: "magic", setCode: "lea"),
            metadata(index: 2, id: "y1", game: "yugioh", setCode: "lob"),
            metadata(
                index: 3,
                id: "pocket-1",
                game: "pokemon",
                setCode: "A1",
                format: "pocket"
            ),
        ])

        let automatic = await store.physicalCardIndices(for: .all, setCode: nil)

        XCTAssertEqual(automatic, [0, 1, 2])
    }

    func testDeckScopedPhysicalIndicesMatchRepresentativeAndNestedPrintingIDs() async {
        let store = CardIndexMetadataStore(entries: [
            metadata(index: 0, id: "89631139", game: "yugioh", setCode: "LOB"),
            CardIndexMetadataEntry(
                annIndex: 1,
                cardId: "representative",
                recognitionFamilyId: "yugioh:art:alternate",
                name: "Alternate Artwork",
                game: "yugioh",
                setCode: "NEW",
                setName: nil,
                rarity: nil,
                imageURL: nil,
                price: nil,
                printings: [
                    CardIndexPrintingEntry(
                        cardId: "46986414",
                        exactPrintingId: "printing-46986414",
                        format: "paper",
                        setCode: "OLD",
                        collectorNumber: nil,
                        setName: nil,
                        rarity: nil,
                        imageURL: nil,
                        price: nil,
                        releaseDate: nil
                    )
                ]
            ),
            metadata(index: 2, id: "not-in-deck", game: "yugioh", setCode: "LOB"),
            metadata(index: 3, id: "89631139", game: "pokemon", setCode: "SV1"),
        ])

        let scoped = await store.physicalCardIndices(
            for: .yugioh,
            setCode: nil,
            externalCardIDs: ["89631139", "46986414"]
        )
        let exactPrintingScoped = await store.physicalCardIndices(
            for: .yugioh,
            setCode: nil,
            externalCardIDs: ["PRINTING-46986414"]
        )

        XCTAssertEqual(scoped, [0, 1])
        XCTAssertEqual(exactPrintingScoped, [1])
    }

    func testANNRanksByCosineDistanceAndHonorsAllowedIndices() async throws {
        let store = AnnoyIndexStore(vectors: [
            [1, 0],
            [0.8, 0.2],
            [0, 1]
        ])

        let all = try await store.nearestNeighbors(
            for: [1, 0],
            limit: 3,
            allowedIndices: [0, 1, 2]
        )
        XCTAssertEqual(all.map(\.index), [0, 1, 2])
        XCTAssertEqual(all[0].distance, 0, accuracy: 0.000_001)

        let filtered = try await store.nearestNeighbors(
            for: [1, 0],
            limit: 3,
            allowedIndices: [1, 2]
        )
        XCTAssertEqual(filtered.map(\.index), [1, 2])
    }

    private func metadata(
        index: Int,
        id: String,
        game: String,
        setCode: String,
        imageURL: String? = nil,
        format: String? = nil
    ) -> CardIndexMetadataEntry {
        CardIndexMetadataEntry(
            annIndex: index,
            cardId: id,
            name: id,
            game: game,
            format: format,
            setCode: setCode,
            setName: nil,
            rarity: nil,
            imageURL: imageURL,
            price: nil
        )
    }

    private static func scannerManifest(formatVersion: Int) throws -> ScannerAssetManifest {
        let contract: String
        if formatVersion == 2 {
            contract = #", "metadataSchema":"tcger-cards-index-metadata-v2","recognitionContract":"tcger-two-stage-recognition-v1""#
        } else if formatVersion == 3 {
            contract = #", "metadataSchema":"tcger-cards-index-metadata-v3","recognitionContract":"tcger-two-stage-recognition-v2","printingCount":2"#
        } else {
            contract = ""
        }
        let data = Data("""
        {
          "formatVersion": \(formatVersion),
          "game": "magic",
          "version": 2,
          "generatedAt": "2026-08-29T00:00:00Z",
          "encoder": "arcface",
          "modelName": "CardEmbeddings-arcface"
          \(contract),
          "cardCount": 1,
          "dimension": 2,
          "downloadBytes": 3,
          "modelPackage": [],
          "vectors": {"file":"vectors.bin","bytes":1,"sha256":"00"},
          "metadata": {"file":"metadata.json","bytes":2,"sha256":"00"}
        }
        """.utf8)
        return try JSONDecoder().decode(ScannerAssetManifest.self, from: data)
    }
}

import XCTest
@testable import TCGer

final class ScannerStagingStoreTests: XCTestCase {
    private var directory: URL!

    override func setUpWithError() throws {
        directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("scanner-staging-tests-\(UUID().uuidString)", isDirectory: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: directory)
    }

    private func makeResult(
        id: UUID = UUID(),
        cardID: String = "sv1-025",
        name: String = "Pikachu"
    ) -> CardScanResult {
        let details = CardDetails(
            identity: CardIdentity(
                id: cardID,
                name: name,
                game: .pokemon,
                setCode: "sv1",
                setName: "Scarlet & Violet"
            ),
            rarity: "Common",
            imageURL: URL(string: "https://example.com/card.png"),
            price: 1.25
        )
        let primary = CardScanCandidate(
            details: details,
            confidence: CardScanConfidence(score: 0.91, reason: "test"),
            originatingStrategy: .mlDetector,
            debugInfo: ["similarity": "0.91"]
        )
        let alternative = CardScanCandidate(
            details: details,
            confidence: CardScanConfidence(score: 0.74, reason: "runner-up"),
            originatingStrategy: .mlDetector
        )
        return CardScanResult(
            id: id,
            mode: .pokemon,
            capturedImage: ScannerTestImage.solid(),
            primary: primary,
            alternatives: [alternative],
            elapsed: 0.42
        )
    }

    func testStageAndRestoreRoundTripAcrossInstances() async throws {
        let result = makeResult()
        await ScannerStagingStore(directory: directory).stage(result)

        // A second instance over the same directory is "the next launch".
        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertEqual(restored.count, 1)
        let scan = try XCTUnwrap(restored.first)
        XCTAssertEqual(scan.result.id, result.id)
        XCTAssertEqual(scan.result.mode, .pokemon)
        XCTAssertEqual(scan.result.primary.details.identity.id, "sv1-025")
        XCTAssertEqual(scan.result.primary.details.identity.name, "Pikachu")
        XCTAssertEqual(scan.result.primary.details.identity.game, .pokemon)
        XCTAssertEqual(scan.result.primary.confidence.score, 0.91)
        XCTAssertEqual(scan.result.primary.originatingStrategy, .mlDetector)
        XCTAssertEqual(scan.result.primary.debugInfo["similarity"], "0.91")
        XCTAssertEqual(scan.result.alternatives.count, 1)
        XCTAssertEqual(scan.result.capturedImage.width, 8)
        XCTAssertFalse(scan.addedToCollection)
    }

    func testMarkAddedPersistsAcrossInstances() async {
        let result = makeResult()
        let store = ScannerStagingStore(directory: directory)
        await store.stage(result)
        await store.markAdded([result.id])

        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertEqual(restored.first?.addedToCollection, true)
    }

    func testUpdatePersistsACandidateCorrection() async {
        let result = makeResult()
        let store = ScannerStagingStore(directory: directory)
        await store.stage(result)

        let corrected = makeResult(id: result.id, cardID: "sv1-026", name: "Raichu")
        await store.update(corrected)

        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored.first?.result.primary.details.identity.name, "Raichu")
    }

    func testUpdateIgnoresUnknownResult() async {
        let store = ScannerStagingStore(directory: directory)
        await store.stage(makeResult())
        await store.update(makeResult(name: "Stranger"))

        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored.first?.result.primary.details.identity.name, "Pikachu")
    }

    func testRemoveDeletesRecordAndImageSidecar() async {
        let result = makeResult()
        let store = ScannerStagingStore(directory: directory)
        await store.stage(result)
        await store.remove(id: result.id)

        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertTrue(restored.isEmpty)
        let jpegs = (try? FileManager.default.contentsOfDirectory(atPath: directory.path))?
            .filter { $0.hasSuffix(".jpg") } ?? []
        XCTAssertTrue(jpegs.isEmpty)
    }

    func testClearEmptiesTheTray() async {
        let store = ScannerStagingStore(directory: directory)
        await store.stage(makeResult())
        await store.stage(makeResult())
        await store.clear()

        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertTrue(restored.isEmpty)
        let jpegs = (try? FileManager.default.contentsOfDirectory(atPath: directory.path))?
            .filter { $0.hasSuffix(".jpg") } ?? []
        XCTAssertTrue(jpegs.isEmpty)
    }

    func testCapDropsOldestScansAndTheirSidecars() async {
        let store = ScannerStagingStore(directory: directory)
        let first = makeResult(name: "Oldest")
        await store.stage(first)
        for index in 0..<100 {
            await store.stage(makeResult(name: "Card \(index)"))
        }

        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertEqual(restored.count, 100)
        XCTAssertFalse(restored.contains { $0.result.id == first.id })
        let jpegs = (try? FileManager.default.contentsOfDirectory(atPath: directory.path))?
            .filter { $0.hasSuffix(".jpg") } ?? []
        XCTAssertEqual(jpegs.count, 100)
    }

    func testMissingImageSidecarDropsTheRecordNotTheTray() async {
        let store = ScannerStagingStore(directory: directory)
        let broken = makeResult(name: "Broken")
        let intact = makeResult(name: "Intact")
        await store.stage(broken)
        await store.stage(intact)
        try? FileManager.default.removeItem(
            at: directory.appendingPathComponent("\(broken.id.uuidString).jpg")
        )

        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertEqual(restored.count, 1)
        XCTAssertEqual(restored.first?.result.primary.details.identity.name, "Intact")
    }

    func testCorruptManifestReadsAsEmptyTray() async {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try? Data("not json".utf8).write(to: directory.appendingPathComponent("staged-scans.json"))

        let restored = await ScannerStagingStore(directory: directory).restore()
        XCTAssertTrue(restored.isEmpty)
    }
}

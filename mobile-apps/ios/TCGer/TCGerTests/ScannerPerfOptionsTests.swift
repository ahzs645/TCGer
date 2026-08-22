import UIKit
import XCTest
@testable import TCGer

/// Parity tests for the `ScannerPerfOptions` experimental speedups: each
/// optimization must produce the same answers as the legacy path it replaces.
final class ScannerPerfOptionsTests: XCTestCase {
    private let perfKeys = [
        ScannerPerfOptions.vectorizedANNDefaultsKey,
        ScannerPerfOptions.allowedIndexCacheDefaultsKey,
        ScannerPerfOptions.stagedHypothesesDefaultsKey,
        ScannerPerfOptions.batchedOrientationDefaultsKey,
        ScannerPerfOptions.warmStartDefaultsKey,
        ScannerPerfOptions.concurrentOrientationsDefaultsKey,
        ScannerPerfOptions.fastCaptureDefaultsKey,
    ]

    override func setUp() {
        super.setUp()
        perfKeys.forEach { UserDefaults.standard.removeObject(forKey: $0) }
    }

    override func tearDown() {
        perfKeys.forEach { UserDefaults.standard.removeObject(forKey: $0) }
        super.tearDown()
    }

    // MARK: - Vectorized ANN parity

    /// Deterministic pseudo-random vectors (seeded LCG, no test flakiness).
    private func makeVectors(count: Int, dimension: Int, seed: UInt64) -> [[Float]] {
        var state = seed
        func next() -> Float {
            state = state &* 6364136223846793005 &+ 1442695040888963407
            return Float(Int64(bitPattern: state >> 11)) / Float(Int64.max >> 11)
        }
        return (0..<count).map { _ in (0..<dimension).map { _ in next() } }
    }

    private func rankings(
        vectors: [[Float]],
        query: [Float],
        limit: Int,
        allowed: Set<Int>,
        vectorized: Bool
    ) async throws -> [ANNVectorMatch] {
        UserDefaults.standard.set(vectorized, forKey: ScannerPerfOptions.vectorizedANNDefaultsKey)
        defer {
            UserDefaults.standard.removeObject(forKey: ScannerPerfOptions.vectorizedANNDefaultsKey)
        }
        // Fresh store per call so lazy representations never leak across configs.
        let store = AnnoyIndexStore(vectors: vectors)
        return try await store.nearestNeighbors(for: query, limit: limit, allowedIndices: allowed)
    }

    func testVectorizedANNMatchesScalarRanking() async throws {
        let vectors = makeVectors(count: 300, dimension: 64, seed: 42)
        let query = makeVectors(count: 1, dimension: 64, seed: 7)[0]
        let allowed = Set(0..<300)

        let scalar = try await rankings(
            vectors: vectors, query: query, limit: 10, allowed: allowed, vectorized: false
        )
        let fast = try await rankings(
            vectors: vectors, query: query, limit: 10, allowed: allowed, vectorized: true
        )

        XCTAssertEqual(scalar.map(\.index), fast.map(\.index))
        for (lhs, rhs) in zip(scalar, fast) {
            XCTAssertEqual(lhs.distance, rhs.distance, accuracy: 1e-5)
        }
    }

    func testVectorizedANNRespectsAllowedIndexFilter() async throws {
        let vectors = makeVectors(count: 200, dimension: 32, seed: 9)
        let query = makeVectors(count: 1, dimension: 32, seed: 3)[0]
        let allowed: Set<Int> = Set(stride(from: 1, to: 200, by: 3)).union([999_999])

        let scalar = try await rankings(
            vectors: vectors, query: query, limit: 5, allowed: allowed, vectorized: false
        )
        let fast = try await rankings(
            vectors: vectors, query: query, limit: 5, allowed: allowed, vectorized: true
        )

        XCTAssertEqual(scalar.map(\.index), fast.map(\.index))
        XCTAssertTrue(fast.allSatisfy { allowed.contains($0.index) })
    }

    func testVectorizedANNTreatsDimensionMismatchAsInfiniteDistance() async throws {
        var vectors = makeVectors(count: 20, dimension: 16, seed: 5)
        vectors[4] = [1, 2, 3] // ragged row
        let query = makeVectors(count: 1, dimension: 16, seed: 11)[0]
        let allowed = Set(0..<20)

        let scalar = try await rankings(
            vectors: vectors, query: query, limit: 20, allowed: allowed, vectorized: false
        )
        let fast = try await rankings(
            vectors: vectors, query: query, limit: 20, allowed: allowed, vectorized: true
        )

        XCTAssertEqual(Set(scalar.map(\.index)), Set(fast.map(\.index)))
        let scalarRagged = try XCTUnwrap(scalar.first { $0.index == 4 })
        let fastRagged = try XCTUnwrap(fast.first { $0.index == 4 })
        XCTAssertTrue(scalarRagged.distance.isInfinite)
        XCTAssertTrue(fastRagged.distance.isInfinite)

        // A query whose dimension matches nothing must rank everything at
        // infinity on both paths, not go empty.
        let shortQuery: [Float] = [1, 0]
        let scalarMismatch = try await rankings(
            vectors: vectors, query: shortQuery, limit: 20, allowed: allowed, vectorized: false
        )
        let fastMismatch = try await rankings(
            vectors: vectors, query: shortQuery, limit: 20, allowed: allowed, vectorized: true
        )
        XCTAssertEqual(scalarMismatch.count, fastMismatch.count)
        XCTAssertTrue(fastMismatch.allSatisfy(\.distance.isInfinite))
    }

    func testVectorizedANNHandlesZeroQuery() async throws {
        let vectors = makeVectors(count: 30, dimension: 8, seed: 21)
        let zero = [Float](repeating: 0, count: 8)
        let allowed = Set(0..<30)

        let scalar = try await rankings(
            vectors: vectors, query: zero, limit: 30, allowed: allowed, vectorized: false
        )
        let fast = try await rankings(
            vectors: vectors, query: zero, limit: 30, allowed: allowed, vectorized: true
        )
        XCTAssertEqual(scalar.count, fast.count)
        XCTAssertTrue(fast.allSatisfy(\.distance.isInfinite))
        XCTAssertTrue(scalar.allSatisfy(\.distance.isInfinite))
    }

    // MARK: - Allowed-index memo parity

    func testAllowedIndexCacheReturnsSameSets() async {
        let entries = [
            CardIndexMetadataEntry(
                annIndex: 0, cardId: "sv1-1", name: "A", game: "pokemon",
                setCode: "sv1", setName: nil, rarity: nil, imageURL: nil, price: nil
            ),
            CardIndexMetadataEntry(
                annIndex: 1, cardId: "sv1-2", name: "B", game: "pokemon", format: "pocket",
                setCode: "sv1", setName: nil, rarity: nil, imageURL: nil, price: nil
            ),
            CardIndexMetadataEntry(
                annIndex: 2, cardId: "sv2-1", name: "C", game: "pokemon",
                setCode: "sv2", setName: nil, rarity: nil, imageURL: nil, price: nil
            ),
            CardIndexMetadataEntry(
                annIndex: 3, cardId: "mtg-1", name: "D", game: "magic",
                setCode: "one", setName: nil, rarity: nil, imageURL: nil, price: nil
            ),
        ]
        let store = CardIndexMetadataStore(entries: entries)

        UserDefaults.standard.set(false, forKey: ScannerPerfOptions.allowedIndexCacheDefaultsKey)
        let plainAll = await store.physicalCardIndices(for: .pokemon, setCode: nil)
        let plainSet = await store.physicalCardIndices(for: .pokemon, setCode: "SV1")
        let plainMagic = await store.physicalCardIndices(for: .magic, setCode: nil)

        UserDefaults.standard.set(true, forKey: ScannerPerfOptions.allowedIndexCacheDefaultsKey)
        // Twice: first call populates the memo, second must serve from it.
        for _ in 0..<2 {
            let cachedAll = await store.physicalCardIndices(for: .pokemon, setCode: nil)
            let cachedSet = await store.physicalCardIndices(for: .pokemon, setCode: "SV1")
            let cachedSetLower = await store.physicalCardIndices(for: .pokemon, setCode: "sv1")
            let cachedMagic = await store.physicalCardIndices(for: .magic, setCode: nil)
            XCTAssertEqual(cachedAll, plainAll)
            XCTAssertEqual(cachedSet, plainSet)
            XCTAssertEqual(cachedSetLower, plainSet)
            XCTAssertEqual(cachedMagic, plainMagic)
        }
        XCTAssertEqual(plainAll, [0, 2])
        XCTAssertEqual(plainSet, [0])
    }

    // MARK: - Batched orientation embedding parity

    func testBatchedEmbeddingsMatchSerialEmbeddings() async throws {
        let encoder = CardEmbeddingEncoder()
        guard encoder.isAvailable else {
            throw XCTSkip("CardEmbeddings.mlmodelc not bundled in this test host")
        }
        let image = try XCTUnwrap(UIImage(named: "BossOrders")?.cgImage)
        let rotated = try XCTUnwrap(CardCropper().rotated180(image))

        let serialUpright = try await encoder.embedding(for: image)
        let serialRotated = try await encoder.embedding(for: rotated)
        let batched = try await encoder.embeddings(for: [image, rotated])

        XCTAssertEqual(batched.count, 2)
        XCTAssertEqual(batched[0].count, serialUpright.count)
        XCTAssertEqual(batched[1].count, serialRotated.count)
        for (lhs, rhs) in zip(batched[0], serialUpright) {
            XCTAssertEqual(lhs, rhs, accuracy: 1e-4)
        }
        for (lhs, rhs) in zip(batched[1], serialRotated) {
            XCTAssertEqual(lhs, rhs, accuracy: 1e-4)
        }
    }

    // MARK: - Warm start

    /// Warm-up must leave scanning behavior untouched and absorb the lazy
    /// loads: after `warmUp()`, a fresh coordinator's first scan should not
    /// be slower than the cold coordinator's warm (second) scan by more than
    /// noise. Absolute timings are printed, not asserted — Debug Simulator
    /// variance would make a hard threshold flaky.
    @MainActor
    func testWarmUpPreloadsWithoutChangingResults() async throws {
        let image = try XCTUnwrap(UIImage(named: "BossOrders")?.cgImage)

        let cold = CardScannerCoordinator.makeDefault()
        let coldStarted = Date()
        let coldResult = await cold.scan(
            image: image, context: .test(engine: .localOnly), source: .importedPhoto
        )
        let coldFirstMs = Date().timeIntervalSince(coldStarted) * 1_000

        let warmed = CardScannerCoordinator.makeDefault()
        await warmed.warmUp()
        let warmStarted = Date()
        let warmResult = await warmed.scan(
            image: image, context: .test(engine: .localOnly), source: .importedPhoto
        )
        let warmFirstMs = Date().timeIntervalSince(warmStarted) * 1_000

        print(String(
            format: "WARMSTART cold-first %.0fms vs warmed-first %.0fms",
            coldFirstMs, warmFirstMs
        ))
        guard case .success(let coldScan) = coldResult,
              case .success(let warmScan) = warmResult else {
            return XCTFail("bundled fixture must scan on both coordinators")
        }
        XCTAssertEqual(
            coldScan.primary.details.identity.id,
            warmScan.primary.details.identity.id
        )
    }

    // MARK: - End-to-end smoke parity

    /// The bundled fixture must resolve to the same card with every perf
    /// option enabled as it does on the unmodified pipeline.
    @MainActor
    func testAllPerfOptionsPreserveFixtureScanResult() async throws {
        let image = try XCTUnwrap(UIImage(named: "BossOrders")?.cgImage)
        let coordinator = CardScannerCoordinator.makeDefault()

        func scanCardID() async -> String? {
            let result = await coordinator.scan(
                image: image,
                context: .test(engine: .localOnly),
                source: .importedPhoto
            )
            guard case .success(let scan) = result else { return nil }
            return scan.primary.details.identity.id
        }

        perfKeys.forEach { UserDefaults.standard.set(false, forKey: $0) }
        let baseline = await scanCardID()
        XCTAssertNotNil(baseline, "bundled clean fixture must scan on the legacy path")

        perfKeys.forEach { UserDefaults.standard.set(true, forKey: $0) }
        let optimized = await scanCardID()
        XCTAssertEqual(optimized, baseline)
    }
}

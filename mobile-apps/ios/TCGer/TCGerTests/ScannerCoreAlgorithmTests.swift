import XCTest
@testable import TCGer

final class ScannerCoreAlgorithmTests: XCTestCase {
    func testPerceptualHashHammingDistance() {
        XCTAssertEqual(PerceptualHash.hammingDistance(0, 0), 0)
        XCTAssertEqual(PerceptualHash.hammingDistance(0, UInt64.max), 64)
        XCTAssertEqual(PerceptualHash.hammingDistance(0b1010, 0b0011), 2)
        XCTAssertEqual(
            PerceptualHash.hash(for: ScannerTestImage.solid()),
            PerceptualHash.hash(for: ScannerTestImage.solid())
        )
    }

    func testCardHashEntryDecodesHexAndFallbackHash() throws {
        let hex = Data(#"{"id":"one","name":"One","hash":"0x0f"}"#.utf8)
        let fallback = Data(#"{"id":"two","name":"Two","phash":"10"}"#.utf8)

        XCTAssertEqual(try JSONDecoder().decode(CardHashEntry.self, from: hex).perceptualHash, 15)
        XCTAssertEqual(try JSONDecoder().decode(CardHashEntry.self, from: fallback).perceptualHash, 16)
    }

    func testArtworkFingerprintRankingReturnsMostSimilarFirst() {
        let database = [
            entry(id: "orthogonal", vector: [0, 1, 0]),
            entry(id: "near", vector: [0.9, 0.1, 0]),
            entry(id: "exact", vector: [1, 0, 0])
        ]

        let matches = ArtworkFingerprintMatcher.match(
            queryFp: [1, 0, 0],
            queryHSV: nil,
            database: database,
            topN: 2
        )

        XCTAssertEqual(matches.map(\.externalId), ["exact", "near"])
        XCTAssertGreaterThan(matches[0].similarity, matches[1].similarity)
    }

    func testArtworkFingerprintRankingUsesHSVWhenAvailable() {
        let database = [
            ArtworkFingerprintMatcher.Entry(
                externalId: "art-only",
                name: "Art",
                setCode: nil,
                fingerprint: [1, 0],
                fpNorm: 1,
                hsvHist: [0, 1],
                hsvNorm: 1
            ),
            ArtworkFingerprintMatcher.Entry(
                externalId: "hsv-winner",
                name: "HSV",
                setCode: nil,
                fingerprint: [0.8, 0.2],
                fpNorm: sqrt(0.68),
                hsvHist: [1, 0],
                hsvNorm: 1
            )
        ]

        let matches = ArtworkFingerprintMatcher.match(
            queryFp: [1, 0],
            queryHSV: [1, 0],
            database: database
        )

        XCTAssertEqual(matches.first?.externalId, "hsv-winner")
    }

    func testCardFaceGateScoresRejectsAndToleratesDimensionMismatch() {
        let gate = CardFaceRejectionGate(weights: [2, -2], bias: 0, threshold: 0.6)

        XCTAssertGreaterThan(gate.cardFaceScore(for: [1, 0]) ?? 0, 0.8)
        XCTAssertFalse(gate.rejects([1, 0]))
        XCTAssertTrue(gate.rejects([0, 1]))
        XCTAssertNil(gate.cardFaceScore(for: [1]))
        XCTAssertFalse(gate.rejects([1]))
    }

    private func entry(id: String, vector: [Float]) -> ArtworkFingerprintMatcher.Entry {
        let norm = sqrt(vector.reduce(0) { $0 + ($1 * $1) })
        return ArtworkFingerprintMatcher.Entry(
            externalId: id,
            name: id,
            setCode: nil,
            fingerprint: vector,
            fpNorm: norm,
            hsvHist: nil,
            hsvNorm: 0
        )
    }
}

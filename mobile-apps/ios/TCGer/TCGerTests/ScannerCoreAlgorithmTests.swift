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

    func testArtworkFingerprintAcceptanceRequiresStrengthAndSeparation() {
        func match(_ id: String, _ score: Float) -> ArtworkFingerprintMatcher.Match {
            ArtworkFingerprintMatcher.Match(
                externalId: id,
                name: id,
                setCode: nil,
                similarity: score
            )
        }

        XCTAssertFalse(ArtworkFingerprintScannerStrategy.accepts(matches: [
            match("a", 0.99), match("b", 0.985)
        ]))
        XCTAssertFalse(ArtworkFingerprintScannerStrategy.accepts(matches: [
            match("a", 0.94), match("b", 0.80)
        ]))
        XCTAssertTrue(ArtworkFingerprintScannerStrategy.accepts(matches: [
            match("a", 0.98), match("b", 0.95)
        ]))
    }

    func testCardFaceGateScoresRejectsAndToleratesDimensionMismatch() {
        let gate = CardFaceRejectionGate(weights: [2, -2], bias: 0, threshold: 0.6)

        XCTAssertGreaterThan(gate.cardFaceScore(for: [1, 0]) ?? 0, 0.8)
        XCTAssertFalse(gate.rejects([1, 0]))
        XCTAssertTrue(gate.rejects([0, 1]))
        XCTAssertNil(gate.cardFaceScore(for: [1]))
        XCTAssertFalse(gate.rejects([1]))
    }

    func testCardTitleNormalizationIgnoresCaseSpacingAndPunctuation() {
        XCTAssertEqual(CardTitleOCR.normalizedName("Venusaur eX"), "venusaurex")
        XCTAssertEqual(CardTitleOCR.normalizedName("Venusaur-ex"), "venusaurex")
        XCTAssertEqual(CardTitleOCR.normalizedName("Erika’s Exeggcute"), "erikasexeggcute")
    }

    func testMetadataNameMatchIsExactAndReturnsEveryPrinting() async {
        let entries = [
            CardIndexMetadataEntry(
                annIndex: 0,
                cardId: "set-a-1",
                name: "Charizard ex",
                game: "pokemon",
                setCode: "set-a",
                setName: nil,
                rarity: nil,
                imageURL: nil,
                price: nil
            ),
            CardIndexMetadataEntry(
                annIndex: 1,
                cardId: "set-b-2",
                name: "Charizard ex",
                game: "pokemon",
                setCode: "set-b",
                setName: nil,
                rarity: nil,
                imageURL: nil,
                price: nil
            ),
            CardIndexMetadataEntry(
                annIndex: 2,
                cardId: "set-c-3",
                name: "Charizard",
                game: "pokemon",
                setCode: "set-c",
                setName: nil,
                rarity: nil,
                imageURL: nil,
                price: nil
            )
        ]
        let store = CardIndexMetadataStore(entries: entries)
        let match = await store.exactNameMatch(
            for: [CardTitleOCR.Candidate(text: "Charizard eX", confidence: 0.9)],
            game: .pokemon,
            setCode: nil
        )

        XCTAssertEqual(match?.name, "Charizard ex")
        XCTAssertEqual(match?.indices, Set([0, 1]))
        let noisy = await store.exactNameMatch(
            for: [CardTitleOCR.Candidate(text: "Charizord ex", confidence: 0.99)],
            game: .pokemon,
            setCode: nil
        )
        XCTAssertNil(noisy)
    }

    func testDocumentDetectionRejectsLowConfidenceAndImplausibleAreas() {
        XCTAssertTrue(CardCropper.isPlausibleDocumentDetection(
            confidence: 0.9,
            bounds: CGRect(x: 0.25, y: 0.2, width: 0.4, height: 0.5)
        ))
        XCTAssertFalse(CardCropper.isPlausibleDocumentDetection(
            confidence: 0,
            bounds: CGRect(x: 0.25, y: 0.2, width: 0.4, height: 0.5)
        ))
        XCTAssertFalse(CardCropper.isPlausibleDocumentDetection(
            confidence: 0.9,
            bounds: CGRect(x: 0, y: 0, width: 0.98, height: 0.98)
        ))
        XCTAssertFalse(CardCropper.isPlausibleDocumentDetection(
            confidence: 0.9,
            bounds: CGRect(x: 0.4, y: 0.4, width: 0.05, height: 0.05)
        ))
    }

    func testDocumentDetectionRequiresCardShapedQuadAtAnyRotation() {
        XCTAssertTrue(CardCropper.isCardShaped(
            topLeft: CGPoint(x: 0.2, y: 0.9),
            topRight: CGPoint(x: 0.7, y: 0.8),
            bottomLeft: CGPoint(x: 0.1, y: 0.2),
            bottomRight: CGPoint(x: 0.6, y: 0.1)
        ))

        // Same card proportions, but lying sideways.
        XCTAssertTrue(CardCropper.isCardShaped(
            topLeft: CGPoint(x: 0.1, y: 0.7),
            topRight: CGPoint(x: 0.8, y: 0.8),
            bottomLeft: CGPoint(x: 0.2, y: 0.2),
            bottomRight: CGPoint(x: 0.9, y: 0.3)
        ))

        XCTAssertFalse(CardCropper.isCardShaped(
            topLeft: CGPoint(x: 0.1, y: 0.9),
            topRight: CGPoint(x: 0.9, y: 0.9),
            bottomLeft: CGPoint(x: 0.1, y: 0.1),
            bottomRight: CGPoint(x: 0.9, y: 0.1)
        ))
    }

    func testIntersectionOverUnion() {
        XCTAssertEqual(
            CardCropper.intersectionOverUnion(
                CGRect(x: 0, y: 0, width: 1, height: 1),
                CGRect(x: 0, y: 0, width: 1, height: 1)
            ),
            1,
            accuracy: 0.0001
        )
        XCTAssertEqual(
            CardCropper.intersectionOverUnion(
                CGRect(x: 0, y: 0, width: 0.5, height: 0.5),
                CGRect(x: 0.5, y: 0.5, width: 0.5, height: 0.5)
            ),
            0,
            accuracy: 0.0001
        )
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

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

    func testPreferredObservationPrefersTheLargestOfEquallyConfidentRectangles() {
        // Vision reports confidence 1.0 for the card and for panels printed on
        // it, so area has to break the tie.
        let panel = CardCropper.rectangleObservation(
            for: CGRect(x: 0.1, y: 0.6, width: 0.3, height: 0.2)
        )
        let card = CardCropper.rectangleObservation(
            for: CGRect(x: 0.05, y: 0.05, width: 0.9, height: 0.9)
        )
        let preferred = CardCropper.preferredObservation(from: [panel, card])
        XCTAssertEqual(CardCropper.normalizedArea(of: try XCTUnwrap(preferred)), 0.81, accuracy: 0.001)
    }

    func testNormalizedWholeImageMatchesCropTargetAndRotatesLandscape() throws {
        let cropper = CardCropper(detector: nil)
        let portrait = try XCTUnwrap(
            cropper.normalizedWholeImage(from: ScannerTestImage.solid(width: 73, height: 102))
        )
        XCTAssertEqual(CGSize(width: portrait.width, height: portrait.height), CGSize(width: 720, height: 1000))
        // A landscape frame is rotated upright before resizing, mirroring
        // makeNormalizedCrop's behavior for detected landscape cards.
        let landscape = try XCTUnwrap(
            cropper.normalizedWholeImage(from: ScannerTestImage.solid(width: 102, height: 73))
        )
        XCTAssertEqual(CGSize(width: landscape.width, height: landscape.height), CGSize(width: 720, height: 1000))
    }

    func testExtractPromoCodesNormalizesLetterPrefixedCollectorNumbers() {
        XCTAssertEqual(CollectorNumberOCR.extractPromoCodes("SWSH204"), ["swsh204"])
        XCTAssertEqual(CollectorNumberOCR.extractPromoCodes("Promo DP 11 foil"), ["dp11"])
        XCTAssertEqual(CollectorNumberOCR.extractPromoCodes("XY-208"), ["xy208"])
        XCTAssertEqual(CollectorNumberOCR.extractPromoCodes("swsh 042"), ["swsh42"])
        XCTAssertEqual(CollectorNumberOCR.extractPromoCodes("123/456"), [])
        // Matches the id convention used by collectorNumber(fromCardId:).
        XCTAssertEqual(
            CollectorNumberOCR.collectorNumber(fromCardId: "swshp-SWSH204"),
            "swsh204"
        )
    }

    func testMapSubImagePointRoundTripsCropCoordinates() {
        // A 1000x800 image cropped at pixel rect (200, 100, 400, 300)
        // (top-left origin). The sub-image's Vision origin (0,0) is the crop's
        // bottom-left corner: pixel x=200, y=400 from the top → 400 from the
        // bottom of the 800-tall image → normalized (0.2, 0.5).
        let mapped = CardCropper.mapSubImagePoint(
            CGPoint(x: 0, y: 0),
            pixelRect: CGRect(x: 200, y: 100, width: 400, height: 300),
            imageWidth: 1000,
            imageHeight: 800
        )
        XCTAssertEqual(mapped.x, 0.2, accuracy: 1e-9)
        XCTAssertEqual(mapped.y, 0.5, accuracy: 1e-9)
        // The crop's top-right corner: pixel x=600, y=100 from top → 700 from
        // bottom → normalized (0.6, 0.875).
        let topRight = CardCropper.mapSubImagePoint(
            CGPoint(x: 1, y: 1),
            pixelRect: CGRect(x: 200, y: 100, width: 400, height: 300),
            imageWidth: 1000,
            imageHeight: 800
        )
        XCTAssertEqual(topRight.x, 0.6, accuracy: 1e-9)
        XCTAssertEqual(topRight.y, 0.875, accuracy: 1e-9)
    }

    func testQuadrilateralAreaIgnoresBoundingBoxInflationFromRotation() {
        // A card rotated 45 degrees fills half of its axis-aligned bounds.
        let area = CardCropper.quadrilateralArea(
            topLeft: CGPoint(x: 0.5, y: 1),
            topRight: CGPoint(x: 1, y: 0.5),
            bottomRight: CGPoint(x: 0.5, y: 0),
            bottomLeft: CGPoint(x: 0, y: 0.5)
        )
        XCTAssertEqual(area, 0.5, accuracy: 0.0001)
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

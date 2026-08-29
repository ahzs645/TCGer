import XCTest
@preconcurrency import Vision
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

    func testCardTitleSingleEditCorrectionIsBoundedToOneVisualName() {
        let corrected = CardTitleOCR.singleEditCorrection(
            for: [CardTitleOCR.Candidate(text: "Thrór's Man", confidence: 1)],
            shortlistNames: ["Thrór's Map", "Unrelated Card"]
        )
        XCTAssertEqual(corrected?.text, "Thrór's Map")

        XCTAssertNil(CardTitleOCR.singleEditCorrection(
            for: [CardTitleOCR.Candidate(text: "Map", confidence: 1)],
            shortlistNames: ["Man"]
        ))
        XCTAssertNil(CardTitleOCR.singleEditCorrection(
            for: [CardTitleOCR.Candidate(text: "Long Card Nane", confidence: 1)],
            shortlistNames: ["Long Card Name", "Long Card Cane"]
        ))
    }

    func testUniqueTitleEvidenceRescuesOnlyOnePrintingAboveEvidenceFloor() {
        XCTAssertTrue(BoardCardEmbeddingScannerStrategy.acceptsUniqueTitleEvidence(
            score: 0.55,
            printingCount: 1
        ))
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.acceptsUniqueTitleEvidence(
            score: 0.549,
            printingCount: 1
        ))
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.acceptsUniqueTitleEvidence(
            score: 0.80,
            printingCount: 2
        ))
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

    func testSemantic180RotationPreservesDimensionsAndReversesPixels() throws {
        let colors: [UInt8] = [
            255, 0, 0, 255, 0, 255, 0, 255,
            0, 0, 255, 255, 255, 255, 255, 255,
        ]
        let provider = try XCTUnwrap(CGDataProvider(data: Data(colors) as CFData))
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let image = try XCTUnwrap(CGImage(
            width: 2,
            height: 2,
            bitsPerComponent: 8,
            bitsPerPixel: 32,
            bytesPerRow: 8,
            space: colorSpace,
            bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue),
            provider: provider,
            decode: nil,
            shouldInterpolate: false,
            intent: .defaultIntent
        ))

        let rotated = try XCTUnwrap(CardCropper(detector: nil).rotated180(image))
        XCTAssertEqual(rotated.width, image.width)
        XCTAssertEqual(rotated.height, image.height)

        let bytes = try XCTUnwrap(rotated.dataProvider?.data)
        let output = [UInt8](bytes as Data)
        XCTAssertEqual(Array(output[0 ..< 4]), [255, 255, 255, 255])
        let finalPixelOffset = rotated.bytesPerRow + 4
        XCTAssertEqual(Array(output[finalPixelOffset ..< finalPixelOffset + 4]), [255, 0, 0, 255])
    }

    func testSemanticOrientationArbitrationPrefersOnlyStrongerAcceptedResult() {
        // Regression values from scan-session-20260816-165452/frame-0003:
        // upside-down physical Fomantis falsely ranked B2-004 at 0.737, while
        // the semantically upright crop ranks me05-003 substantially higher.
        XCTAssertTrue(BoardCardEmbeddingScannerStrategy.shouldPreferSemantic180(
            uprightScore: 0.737,
            semantic180Score: 0.822
        ))
        XCTAssertTrue(BoardCardEmbeddingScannerStrategy.shouldPreferSemantic180(
            uprightScore: nil,
            semantic180Score: 0.75
        ))
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.shouldPreferSemantic180(
            uprightScore: 0.85,
            semantic180Score: 0.75
        ))
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.shouldPreferSemantic180(
            uprightScore: 0.8,
            semantic180Score: 0.8
        ))
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.shouldPreferSemantic180(
            uprightScore: 0.8,
            semantic180Score: nil
        ))
    }

    func testBinderUsesDetectorBoxOnlyForStronglySkewedRefinement() {
        let imageSize = CGSize(width: 1_000, height: 1_000)
        let axisAligned = CardCropper.rectangleObservation(
            for: CGRect(x: 0.1, y: 0.1, width: 0.3, height: 0.5)
        )
        XCTAssertFalse(BinderPageScanner.shouldUseDetectorBox(
            insteadOf: axisAligned,
            imageSize: imageSize,
            pageAngleDegrees: 0
        ))

        let steep = VNRectangleObservation(
            requestRevision: VNDetectRectanglesRequestRevision1,
            topLeft: CGPoint(x: 0.10, y: 0.70),
            topRight: CGPoint(x: 0.40, y: 0.80),
            bottomRight: CGPoint(x: 0.50, y: 0.30),
            bottomLeft: CGPoint(x: 0.20, y: 0.20)
        )
        XCTAssertTrue(BinderPageScanner.shouldUseDetectorBox(
            insteadOf: steep,
            imageSize: imageSize,
            pageAngleDegrees: 0
        ))
        XCTAssertFalse(BinderPageScanner.shouldUseDetectorBox(
            insteadOf: steep,
            imageSize: imageSize,
            pageAngleDegrees: 18
        ))
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

    func testCardShapedMeasuresNormalizedQuadsInPixelSpace() {
        // A real card occupying most of an 830×1162 binder-page cell: pixel
        // aspect 594/830 ÷ 830/1162 ≈ 0.71/0.95. In normalized units the same
        // quad measures 0.716/0.716 = square-ish 0.95+ and used to be rejected.
        let pageSize = CGSize(width: 830, height: 1162)
        let cardOnPage = (
            topLeft: CGPoint(x: 0.1, y: 0.85),
            topRight: CGPoint(x: 0.1 + 594.0 / 830.0, y: 0.85),
            bottomLeft: CGPoint(x: 0.1, y: 0.85 - 830.0 / 1162.0),
            bottomRight: CGPoint(x: 0.1 + 594.0 / 830.0, y: 0.85 - 830.0 / 1162.0)
        )
        XCTAssertTrue(CardCropper.isCardShaped(
            topLeft: cardOnPage.topLeft,
            topRight: cardOnPage.topRight,
            bottomLeft: cardOnPage.bottomLeft,
            bottomRight: cardOnPage.bottomRight,
            imageSize: pageSize
        ))
        // Unit-space measurement of the same quad reads nearly square — the
        // pre-fix behavior that discarded 58/67 correct refinements.
        XCTAssertFalse(CardCropper.isCardShaped(
            topLeft: cardOnPage.topLeft,
            topRight: cardOnPage.topRight,
            bottomLeft: cardOnPage.bottomLeft,
            bottomRight: cardOnPage.bottomRight
        ))

        // The Rhyperior failure: a too-narrow quad (pixel aspect ~0.55, below
        // the 0.58 floor) whose normalized ratio 0.77 sat inside the band and
        // was wrongly admitted before the fix.
        let narrow = (
            topLeft: CGPoint(x: 0.2, y: 0.8),
            topRight: CGPoint(x: 0.2 + 380.0 / 830.0, y: 0.8),
            bottomLeft: CGPoint(x: 0.2, y: 0.8 - 690.0 / 1162.0),
            bottomRight: CGPoint(x: 0.2 + 380.0 / 830.0, y: 0.8 - 690.0 / 1162.0)
        )
        XCTAssertFalse(CardCropper.isCardShaped(
            topLeft: narrow.topLeft,
            topRight: narrow.topRight,
            bottomLeft: narrow.bottomLeft,
            bottomRight: narrow.bottomRight,
            imageSize: pageSize
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

    func testPageFitRectUnionsQuadsWithMarginAndClampsToFrame() throws {
        let quads = [
            makeQuad(x: 0.1, y: 0.55, width: 0.3, height: 0.4),
            makeQuad(x: 0.5, y: 0.05, width: 0.3, height: 0.4)
        ]

        let rect = try XCTUnwrap(BinderPageScanner.pageFitRect(for: quads))

        XCTAssertEqual(rect.minX, 0.08, accuracy: 0.0001)
        XCTAssertEqual(rect.minY, 0.03, accuracy: 0.0001)
        XCTAssertEqual(rect.maxX, 0.82, accuracy: 0.0001)
        XCTAssertEqual(rect.maxY, 0.97, accuracy: 0.0001)
    }

    func testPageFitRectClampsMarginAtFrameEdge() throws {
        let rect = try XCTUnwrap(BinderPageScanner.pageFitRect(for: [
            makeQuad(x: 0, y: 0, width: 0.5, height: 0.5)
        ]))

        XCTAssertEqual(rect.minX, 0, accuracy: 0.0001)
        XCTAssertEqual(rect.minY, 0, accuracy: 0.0001)
    }

    func testPageFitRectSkipsEmptyAndNearFullFits() {
        XCTAssertNil(BinderPageScanner.pageFitRect(for: []))
        // Cards already spanning the frame: recropping would trim nothing.
        XCTAssertNil(BinderPageScanner.pageFitRect(for: [
            makeQuad(x: 0.01, y: 0.01, width: 0.98, height: 0.98)
        ]))
    }

    func testPageFitRectNeverTrimsInsideTheProtectedGuide() throws {
        // The backs-column case (223944/frame-0009): the detector fires only
        // on the seven face-up cards in the right two columns; the two card
        // backs in the left column produce no quads. Without protection the
        // fit trims the left third of the page away.
        let faceQuads = [
            makeQuad(x: 0.38, y: 0.55, width: 0.26, height: 0.38),
            makeQuad(x: 0.70, y: 0.55, width: 0.26, height: 0.38),
            makeQuad(x: 0.38, y: 0.08, width: 0.26, height: 0.38)
        ]
        let unprotected = try XCTUnwrap(BinderPageScanner.pageFitRect(for: faceQuads))
        XCTAssertGreaterThan(unprotected.minX, 0.3, "sanity: unprotected fit trims the left column")

        // The guide is the user's declared page area; the fit may expand past
        // it for peeking cards but must never cut inside it.
        let guide = CGRect(x: 0.05, y: 0.15, width: 0.9, height: 0.7)
        let protected0 = try XCTUnwrap(
            BinderPageScanner.pageFitRect(for: faceQuads, protecting: guide)
        )
        XCTAssertLessThanOrEqual(protected0.minX, guide.minX)
        XCTAssertLessThanOrEqual(protected0.minY, guide.minY)
        XCTAssertGreaterThanOrEqual(protected0.maxX, guide.maxX)
        XCTAssertGreaterThanOrEqual(protected0.maxY, guide.maxY)
        // The face quads extend above and below the guide; the fit keeps them.
        XCTAssertGreaterThanOrEqual(protected0.maxY, 0.93 + 0.019)

        // A guide spanning nearly the whole viewport means nothing worth
        // trimming remains — the fit becomes a no-op instead of a sliver cut.
        XCTAssertNil(BinderPageScanner.pageFitRect(
            for: faceQuads,
            protecting: CGRect(x: 0.01, y: 0.01, width: 0.98, height: 0.98)
        ))

        // Nil / empty protection preserves the original behavior exactly.
        XCTAssertEqual(
            BinderPageScanner.pageFitRect(for: faceQuads, protecting: nil),
            unprotected
        )
        XCTAssertEqual(
            BinderPageScanner.pageFitRect(for: faceQuads, protecting: .zero),
            unprotected
        )
    }

    func testQuadRemappedIntoFitRectLandsAtProportionalPosition() {
        let quad = makeQuad(x: 0.25, y: 0.25, width: 0.5, height: 0.5)
        let remapped = quad.remapped(into: CGRect(x: 0.25, y: 0.25, width: 0.5, height: 0.5))

        XCTAssertEqual(remapped.bottomLeft.x, 0, accuracy: 0.0001)
        XCTAssertEqual(remapped.bottomLeft.y, 0, accuracy: 0.0001)
        XCTAssertEqual(remapped.topRight.x, 1, accuracy: 0.0001)
        XCTAssertEqual(remapped.topRight.y, 1, accuracy: 0.0001)
    }

    /// Bottom-left-origin normalized rects must flip vertically when cropping
    /// the top-left-origin CGImage.
    func testNormalizedCropFlipsVisionCoordinates() throws {
        let image = ScannerTestImage.solid(width: 100, height: 200)
        let cropped = try XCTUnwrap(BinderPageScanner.crop(
            image,
            toNormalizedRect: CGRect(x: 0.1, y: 0.5, width: 0.5, height: 0.5)
        ))

        XCTAssertEqual(cropped.width, 50)
        XCTAssertEqual(cropped.height, 100)
    }

    private func makeQuad(x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat) -> BinderNormalizedQuad {
        BinderNormalizedQuad(
            topLeft: CGPoint(x: x, y: y + height),
            topRight: CGPoint(x: x + width, y: y + height),
            bottomLeft: CGPoint(x: x, y: y),
            bottomRight: CGPoint(x: x + width, y: y)
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

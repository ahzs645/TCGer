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

    func testTitleAgreementConfirmsFamilyOnlyWhenImageLeaderMatchesAndIsUnrivaled() {
        // Title and unconstrained visual leader name the same card, no rival:
        // the family is confirmed from the 0.55 evidence floor.
        XCTAssertTrue(BoardCardEmbeddingScannerStrategy.titleAgreesWithVisualLeader(
            titleConstrained: true,
            titleName: "Racers' Ring",
            visualLeaderName: "Racers’ Ring",
            visualLeaderScore: 0.79,
            rivalName: nil,
            rivalScore: nil,
            ambiguityMargin: 0.05,
            evidenceScore: 0.79
        ))
        // A same-name rival (another printing family) never blocks agreement.
        XCTAssertTrue(BoardCardEmbeddingScannerStrategy.titleAgreesWithVisualLeader(
            titleConstrained: true,
            titleName: "Nivix Guildmage",
            visualLeaderName: "Nivix Guildmage",
            visualLeaderScore: 0.836,
            rivalName: "Nivix Guildmage",
            rivalScore: 0.83,
            ambiguityMargin: 0.05,
            evidenceScore: 0.836
        ))
        // The image preferred a different card: title alone is not enough.
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.titleAgreesWithVisualLeader(
            titleConstrained: true,
            titleName: "Corpse Appraiser",
            visualLeaderName: "Swamp",
            visualLeaderScore: 0.68,
            rivalName: "Corpse Appraiser",
            rivalScore: 0.67,
            ambiguityMargin: 0.05,
            evidenceScore: 0.67
        ))
        // A different-name rival inside the ambiguity margin keeps the guard.
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.titleAgreesWithVisualLeader(
            titleConstrained: true,
            titleName: "Jungle Hollow",
            visualLeaderName: "Jungle Hollow",
            visualLeaderScore: 0.70,
            rivalName: "Swamp",
            rivalScore: 0.66,
            ambiguityMargin: 0.05,
            evidenceScore: 0.70
        ))
        // Below the evidence floor, or without a title match, nothing applies.
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.titleAgreesWithVisualLeader(
            titleConstrained: true,
            titleName: "Jungle Hollow",
            visualLeaderName: "Jungle Hollow",
            visualLeaderScore: 0.54,
            rivalName: nil,
            rivalScore: nil,
            ambiguityMargin: 0.05,
            evidenceScore: 0.54
        ))
        XCTAssertFalse(BoardCardEmbeddingScannerStrategy.titleAgreesWithVisualLeader(
            titleConstrained: false,
            titleName: nil,
            visualLeaderName: "Jungle Hollow",
            visualLeaderScore: 0.80,
            rivalName: nil,
            rivalScore: nil,
            ambiguityMargin: 0.05,
            evidenceScore: 0.80
        ))
    }

    func testBuiltInAcceptancePoliciesMatchTheShippedProfiles() {
        let magic = ScannerGameAcceptancePolicy.builtin(for: .magic)
        XCTAssertEqual(magic.strongAcceptanceScore, 0.70, accuracy: 1e-9)
        XCTAssertEqual(magic.ambiguityMargin, 0.05, accuracy: 1e-9)
        XCTAssertEqual(magic.titleGate, .binderPage)
        XCTAssertEqual(magic.collectorNumberScope, .family)
        XCTAssertTrue(magic.titleAgreementRescue)

        let pokemon = ScannerGameAcceptancePolicy.builtin(for: .pokemon)
        XCTAssertEqual(pokemon.strongAcceptanceScore, ScannerEncoderVariant.arcface.strongAcceptanceScore, accuracy: 1e-9)
        XCTAssertEqual(pokemon.titleGate, .never)

        // A game the client has never heard of runs the conservative profile.
        XCTAssertEqual(ScannerGameAcceptancePolicy.builtin(for: .all), .fallback)
        XCTAssertEqual(ScannerGameAcceptancePolicy.fallback.strongAcceptanceScore, 0.70, accuracy: 1e-9)
        XCTAssertEqual(ScannerGameAcceptancePolicy.fallback.titleGate, .never)
        XCTAssertEqual(ScannerGameAcceptancePolicy.builtin(for: .magic).queryNormalization, .greyWorldAutocontrast)
        XCTAssertEqual(ScannerGameAcceptancePolicy.builtin(for: .pokemon).queryNormalization, .none)
        XCTAssertEqual(ScannerGameAcceptancePolicy.fallback.queryNormalization, .none)
    }

    func testDeclaredAcceptancePolicyDecodesWithDefaultsAndWinsOverBuiltIn() throws {
        let json = Data("""
        {"schema":"tcger-scanner-acceptance-policy-v1","strongAcceptanceScore":0.68,"titleGate":"intentionalCaptures"}
        """.utf8)
        let declared = try JSONDecoder().decode(ScannerGameAcceptancePolicy.self, from: json)
        XCTAssertTrue(declared.isValid)
        XCTAssertEqual(declared.strongAcceptanceScore, 0.68, accuracy: 1e-9)
        XCTAssertEqual(declared.titleGate, .intentionalCaptures)
        // Unstated fields take the fallback values, not zero.
        XCTAssertEqual(declared.ambiguityMargin, ScannerGameAcceptancePolicy.fallback.ambiguityMargin, accuracy: 1e-9)
        XCTAssertEqual(declared.collectorNumberScope, .family)
        XCTAssertEqual(declared.queryNormalization, .none)
        let normalized = try JSONDecoder().decode(ScannerGameAcceptancePolicy.self, from: Data("""
        {"schema":"tcger-scanner-acceptance-policy-v1","strongAcceptanceScore":0.7,"queryNormalization":"grey-world-autocontrast"}
        """.utf8))
        XCTAssertEqual(normalized.queryNormalization, .greyWorldAutocontrast)

        let resolved = ScannerGameAcceptancePolicy.resolve(game: .magic, declared: declared, environment: [:])
        XCTAssertEqual(resolved.strongAcceptanceScore, 0.68, accuracy: 1e-9)
        XCTAssertTrue(resolved.requiresTitleConfirmation(purpose: .singleCard, source: .photoCapture))
    }

    func testInvalidDeclaredAcceptancePolicyFallsBackToBuiltIn() throws {
        let broken = try JSONDecoder().decode(
            ScannerGameAcceptancePolicy.self,
            from: Data(#"{"strongAcceptanceScore":1.7}"#.utf8)
        )
        XCTAssertFalse(broken.isValid)
        let resolved = ScannerGameAcceptancePolicy.resolve(game: .magic, declared: broken, environment: [:])
        XCTAssertEqual(resolved, ScannerGameAcceptancePolicy.builtin(for: .magic))

        let wrongSchema = try JSONDecoder().decode(
            ScannerGameAcceptancePolicy.self,
            from: Data(#"{"schema":"tcger-scanner-acceptance-policy-v9","strongAcceptanceScore":0.7}"#.utf8)
        )
        XCTAssertFalse(wrongSchema.isValid)
    }

    func testAcceptancePolicyEnvironmentOverridesApplyLast() {
        let perGame = ScannerGameAcceptancePolicy.resolve(
            game: .magic,
            declared: nil,
            environment: ["SCANNER_STRONG_ACCEPT_MAGIC": "0.75"]
        )
        XCTAssertEqual(perGame.strongAcceptanceScore, 0.75, accuracy: 1e-9)
        XCTAssertEqual(
            ScannerGameAcceptancePolicy.resolve(
                game: .pokemon,
                declared: nil,
                environment: ["SCANNER_STRONG_ACCEPT_MAGIC": "0.75"]
            ).strongAcceptanceScore,
            ScannerGameAcceptancePolicy.builtin(for: .pokemon).strongAcceptanceScore,
            accuracy: 1e-9
        )

        let legacy = ScannerGameAcceptancePolicy.resolve(
            game: .magic,
            declared: nil,
            environment: ["SCANNER_MTG_LEGACY_POLICY": "1"]
        )
        XCTAssertEqual(legacy, ScannerGameAcceptancePolicy.legacyMagic())
        XCTAssertEqual(legacy.titleGate, .intentionalCaptures)
        XCTAssertEqual(legacy.collectorNumberScope, .representative)
        XCTAssertFalse(legacy.titleAgreementRescue)
        XCTAssertTrue(legacy.requiresTitleConfirmation(purpose: .singleCard, source: .importedPhoto))
        XCTAssertFalse(legacy.requiresTitleConfirmation(purpose: .singleCard, source: .livePreview))
    }

    func testHubCollapseRejectsManyUnrelatedHighNeighboursButNotGenuineMatches() {
        let policy = ScannerGameAcceptancePolicy.builtin(for: .magic)
        // The Stone Quarry failure: unrelated rows all above 0.90.
        XCTAssertTrue(policy.isHubCollapse([
            ("Radha, Heart of Keld", 0.995), ("Instill Energy", 0.954),
            ("The Bath Song", 0.934), ("Song of Eärendil", 0.911), ("Forest", 0.91),
        ]))
        // Two DIFFERENT names at hub similarity is already impossible for a
        // real card (23:37 frame 3's box crop: Plains 0.99 / Forest 0.99);
        // measured on 160 labeled genuine crops, no correct crop ever shows two.
        XCTAssertTrue(policy.isHubCollapse([
            ("Plains", 0.99), ("Forest", 0.99), ("Forest", 0.99), ("Plains", 0.99), ("Plains", 0.99),
        ]))
        // A genuine strong match with same-name printings and distant rivals.
        XCTAssertFalse(policy.isHubCollapse([
            ("Nazgûl", 0.94), ("Nazgûl", 0.93), ("Nazgûl", 0.93), ("Karplusan Forest", 0.60),
        ]))
        XCTAssertFalse(policy.isHubCollapse([
            ("Crew Captain", 0.936), ("Brokers Charm", 0.61), ("Maestros Charm", 0.58),
        ]))
        // Only the top-K window counts.
        XCTAssertFalse(policy.isHubCollapse([
            ("A", 0.95), ("B", 0.60), ("C", 0.60), ("D", 0.60), ("E", 0.60), ("F", 0.95), ("G", 0.95),
        ]))
        // Disabled by policy (legacy Magic profile).
        XCTAssertFalse(ScannerGameAcceptancePolicy.legacyMagic().isHubCollapse([
            ("A", 0.99), ("B", 0.98), ("C", 0.97),
        ]))
        XCTAssertFalse(ScannerGameAcceptancePolicy(strongAcceptanceScore: 0.7, ambiguityMargin: 0.05, hubTopK: 0).isValid)
    }

    func testGalleryExclusionsDropNonCardRowsOnlyForMagic() {
        for name in ["Double-Faced Substitute Card", "Jan Tomcani Bio", "Tom van de Logt Bio (2001)",
                     "Koth of the Hammer Emblem", "Punchcard", "Ixalan Checklist"] {
            XCTAssertTrue(ScannerGalleryExclusions.excludes(name: name, game: .magic), name)
        }
        for name in ["Mindful Biomancer", "Pollywog Symbiote", "Stone Quarry", "Emblem of the Warmind"] {
            XCTAssertFalse(ScannerGalleryExclusions.excludes(name: name, game: .magic), name)
        }
        XCTAssertFalse(ScannerGalleryExclusions.excludes(name: "Double-Faced Substitute Card", game: .pokemon))

        let substitute = CardIndexMetadataEntry(
            annIndex: 0, cardId: "x", name: "Double-Faced Substitute Card", game: "magic",
            setCode: "sznr", setName: nil, rarity: nil, imageURL: nil, price: nil
        )
        XCTAssertFalse(substitute.isPhysicalScanEligible)
        let card = CardIndexMetadataEntry(
            annIndex: 1, cardId: "y", name: "Stone Quarry", game: "magic",
            setCode: "c19", setName: nil, rarity: nil, imageURL: nil, price: nil
        )
        XCTAssertTrue(card.isPhysicalScanEligible)
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

    func testNestedDetectionsAreDroppedAsArtPanelsWhileNeighboursSurvive() {
        // Full-resolution boxes from scan-session-20260830-171145 frame 22:
        // the art panel (listed first because it out-scored the card) sits
        // entirely inside the card's own detection.
        let card = CGRect(x: 0.31, y: 0.30, width: 0.33, height: 0.35)
        let panel = CGRect(x: 0.34, y: 0.42, width: 0.27, height: 0.14)
        XCTAssertEqual(CardObjectDetector.indicesSuppressingNestedBoxes([panel, card]), [1])
        XCTAssertEqual(CardObjectDetector.indicesSuppressingNestedBoxes([card, panel]), [0])

        // Binder neighbours overlap only at their borders and both remain.
        let left = CGRect(x: 0.05, y: 0.1, width: 0.28, height: 0.38)
        let right = CGRect(x: 0.31, y: 0.1, width: 0.28, height: 0.38)
        XCTAssertEqual(CardObjectDetector.indicesSuppressingNestedBoxes([left, right]), [0, 1])

        // A smaller card half-covered by a larger one is occlusion, not a
        // panel: only 50% of its area is inside, below the containment share.
        let big = CGRect(x: 0.0, y: 0.0, width: 0.5, height: 0.6)
        let overlapped = CGRect(x: 0.4, y: 0.1, width: 0.2, height: 0.3)
        XCTAssertEqual(CardObjectDetector.indicesSuppressingNestedBoxes([big, overlapped]), [0, 1])

        // Identical boxes never suppress each other; empty boxes are dropped.
        XCTAssertEqual(CardObjectDetector.indicesSuppressingNestedBoxes([card, card]), [0, 1])
        XCTAssertEqual(CardObjectDetector.indicesSuppressingNestedBoxes([.zero, card]), [1])
    }

    func testQueryColorNormalizationMatchesPillowSemantics() {
        // Autocontrast: a histogram occupying [64, 191] stretches to [0, 255];
        // with a 1 % cutoff the outermost 1 % of pixels are discarded first.
        var histogram = [Int](repeating: 0, count: 256)
        for value in 64...191 { histogram[value] = 100 }
        let table = QueryColorNormalization.autocontrastTable(histogram: histogram, cutoffPercent: 0)
        XCTAssertEqual(table[64], 0)
        XCTAssertEqual(table[191], 255)
        XCTAssertEqual(table[0], 0)
        XCTAssertEqual(table[255], 255)
        XCTAssertEqual(Int(table[128]), Int(Double(128 - 64) * 255.0 / 127.0))
        // 12,800 pixels; 1 % = 128 pixels = bins 64 and part of 65 from the
        // low end, so the new low is 65 (Pillow leaves the partial bin).
        let cut = QueryColorNormalization.autocontrastTable(histogram: histogram, cutoffPercent: 1)
        XCTAssertEqual(cut[65], 0)
        XCTAssertEqual(cut[190], 255)
        // A flat (single-value) histogram is left as identity.
        var flat = [Int](repeating: 0, count: 256); flat[100] = 500
        XCTAssertEqual(QueryColorNormalization.autocontrastTable(histogram: flat, cutoffPercent: 1)[100], 100)

        // Grey world: a warm cast (R 150, G 128, B 100) is pulled to a common mean.
        let gains = QueryColorNormalization.greyWorldGains(means: [150, 128, 100])
        XCTAssertEqual(gains[0] * 150, 126, accuracy: 0.01)
        XCTAssertEqual(gains[2] * 100, 126, accuracy: 0.01)
        XCTAssertEqual(QueryColorNormalization.greyWorldGains(means: [0, 10, 20])[0], 1)

        // End to end on RGBA pixels: a warm-cast flat field with two extreme
        // pixels becomes neutral and full-range; alpha is untouched.
        var pixels: [UInt8] = []
        for _ in 0..<98 { pixels += [150, 128, 100, 255] }
        pixels += [200, 178, 150, 255, 100, 78, 50, 255]
        QueryColorNormalization.normalizeRGBA(&pixels, pixelCount: 100)
        let mid = Array(pixels[0..<3])
        XCTAssertEqual(Int(mid[0]), Int(mid[1]), accuracy: 2)
        XCTAssertEqual(Int(mid[1]), Int(mid[2]), accuracy: 2)
        XCTAssertEqual(pixels[3], 255)
    }

    func testOrientationContradictionVoidsCropsThatWouldBeTwoDifferentCards() {
        typealias S = BoardCardEmbeddingScannerStrategy
        // 23:37 frame 4 box crop: Island 0.94 one way up, Plains 0.85 the other.
        XCTAssertTrue(S.isOrientationContradiction([("Island", 0.94), ("Plains", 0.85)], strongAcceptanceScore: 0.70))
        // Frame 3: Island 0.82 / Plains 0.99.
        XCTAssertTrue(S.isOrientationContradiction([("Island", 0.82), ("Plains", 0.99)], strongAcceptanceScore: 0.70))
        // A genuine crop: the twin never reaches strong accept on another name.
        XCTAssertFalse(S.isOrientationContradiction([("Tranquil Cove", 0.77), ("Plains", 0.62)], strongAcceptanceScore: 0.70))
        // Same name both ways up (symmetric art, reprints) is not a contradiction.
        XCTAssertFalse(S.isOrientationContradiction([("Nazgûl", 0.91), ("Nazgûl", 0.88)], strongAcceptanceScore: 0.70))
        XCTAssertFalse(S.isOrientationContradiction([("Island", 0.94)], strongAcceptanceScore: 0.70))
        // The operating point is the game's own strong-accept score.
        XCTAssertTrue(S.isOrientationContradiction([("A", 0.66), ("B", 0.67)], strongAcceptanceScore: 0.65))
        XCTAssertFalse(S.isOrientationContradiction([("A", 0.66), ("B", 0.67)], strongAcceptanceScore: 0.70))
    }

    func testTheFramedDetectionBeatsAMoreConfidentBystanderCard() {
        // scan-session-20260830-171145 frame 27 (guide crop): Darksteel Ingot
        // on the table at 0.94, off-centre; the held Crosis's Charm at 0.89
        // under the frame centre.
        let ingot = CGRect(x: 0.48, y: 0.0, width: 0.51, height: 0.45)
        let charm = CGRect(x: 0.15, y: 0.41, width: 0.66, height: 0.42)
        XCTAssertEqual(CardCropper.preferredDetectionIndex([ingot, charm]), 1)
        XCTAssertEqual(CardCropper.preferredDetectionIndex([charm, ingot]), 0)
        // Two framed cards: confidence order decides.
        let overlapping = CGRect(x: 0.3, y: 0.3, width: 0.4, height: 0.4)
        XCTAssertEqual(CardCropper.preferredDetectionIndex([charm, overlapping]), 0)
        // Nothing under the centre: confidence order stands.
        let corner = CGRect(x: 0.0, y: 0.0, width: 0.3, height: 0.3)
        XCTAssertEqual(CardCropper.preferredDetectionIndex([ingot, corner]), 0)
        XCTAssertNil(CardCropper.preferredDetectionIndex([]))
    }

    func testFullFrameQuadsMustShareTheDetectorBoxOrientation() {
        // scan-session-20260830-171145 frame 11 (812×1138): detector box
        // 593×772 px portrait; Vision's rectangle candidate is the 431×329 px
        // landscape art panel, its document candidate the 486×715 px card.
        let imageSize = CGSize(width: 812, height: 1138)
        let detectorBox = CGRect(x: 0.10, y: 0.09, width: 0.73, height: 0.68)
        let panel = CardCropper.rectangleObservation(for: CGRect(x: 0.2, y: 0.4, width: 0.53, height: 0.29))
        XCTAssertFalse(CardCropper.matchesDetectorOrientation(panel, detectorBox: detectorBox, imageSize: imageSize))
        let card = CardCropper.rectangleObservation(for: CGRect(x: 0.15, y: 0.15, width: 0.60, height: 0.63))
        XCTAssertTrue(CardCropper.matchesDetectorOrientation(card, detectorBox: detectorBox, imageSize: imageSize))

        // A sleeved card in a loose binder box (Pokémon 231419 frame 41:
        // quad covers 0.27 of the box) is still portrait in a portrait box.
        let looseBox = CGRect(x: 0.0, y: 0.1, width: 1.0, height: 0.79)
        let sleeved = CardCropper.rectangleObservation(for: CGRect(x: 0.3, y: 0.2, width: 0.43, height: 0.65))
        XCTAssertTrue(CardCropper.matchesDetectorOrientation(sleeved, detectorBox: looseBox, imageSize: imageSize))

        // A tilted card keeps portrait edges while its box goes near-square,
        // which decides nothing: the previous gates alone apply.
        let squareBox = CGRect(x: 0.05, y: 0.15, width: 0.9, height: 0.66)
        XCTAssertNil(CardCropper.orientation(width: squareBox.width * imageSize.width, height: squareBox.height * imageSize.height))
        XCTAssertTrue(CardCropper.matchesDetectorOrientation(panel, detectorBox: squareBox, imageSize: imageSize))

        // A landscape-held card: the box is landscape, so its portrait art
        // panel is the mismatch and the landscape card quad agrees.
        let landscapeBox = CGRect(x: 0.02, y: 0.3, width: 0.96, height: 0.48)
        let landscapeCard = CardCropper.rectangleObservation(for: CGRect(x: 0.05, y: 0.32, width: 0.9, height: 0.44))
        let portraitPanel = CardCropper.rectangleObservation(for: CGRect(x: 0.1, y: 0.35, width: 0.3, height: 0.38))
        XCTAssertTrue(CardCropper.matchesDetectorOrientation(landscapeCard, detectorBox: landscapeBox, imageSize: imageSize))
        XCTAssertFalse(CardCropper.matchesDetectorOrientation(portraitPanel, detectorBox: landscapeBox, imageSize: imageSize))
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

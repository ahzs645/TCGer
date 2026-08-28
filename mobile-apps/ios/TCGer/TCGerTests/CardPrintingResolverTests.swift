import CoreGraphics
import XCTest
@testable import TCGer

final class CardPrintingResolverTests: XCTestCase {
    func testQuickScanUsesNewestPrintingInMatchedFamily() {
        let older = candidate(id: "old", family: "art:pikachu-1", releaseDate: "2020-01-01")
        let newer = candidate(id: "new", family: "art:pikachu-1", releaseDate: "2024-02-02")

        let decision = CardPrintingResolver.resolve(
            primary: older,
            candidates: [newer],
            mode: .quickLatest
        )

        XCTAssertEqual(decision.selected?.details.identity.id, "new")
        XCTAssertEqual(decision.provenance, .latestFallback)
        XCTAssertFalse(decision.requiresSelection)
    }

    func testExactModeRequiresChoiceForIdenticalArtworkPrintings() {
        let first = candidate(id: "a", family: "art:pikachu-1", releaseDate: "2020-01-01")
        let second = candidate(id: "b", family: "art:pikachu-1", releaseDate: "2024-02-02")

        let decision = CardPrintingResolver.resolve(
            primary: first,
            candidates: [second],
            mode: .exactPrinting
        )

        XCTAssertNil(decision.selected)
        XCTAssertTrue(decision.requiresSelection)
        XCTAssertEqual(decision.provenance, .unresolved)
    }

    func testVerifiedPrintingOverridesQuickFallback() {
        let older = candidate(id: "old", family: "art:pikachu-1", releaseDate: "2020-01-01")
        let newer = candidate(id: "new", family: "art:pikachu-1", releaseDate: "2024-02-02")

        let decision = CardPrintingResolver.resolve(
            primary: newer,
            candidates: [older],
            mode: .quickLatest,
            verifiedExactPrintingID: "old"
        )

        XCTAssertEqual(decision.selected?.details.identity.id, "old")
        XCTAssertEqual(decision.provenance, .verified)
    }

    private func candidate(id: String, family: String, releaseDate: String) -> CardScanCandidate {
        CardScanCandidate(
            details: CardDetails(
                identity: CardIdentity(
                    id: id,
                    name: "Pikachu",
                    game: .pokemon,
                    setCode: id.uppercased(),
                    setName: id,
                    recognitionFamilyID: family,
                    exactPrintingID: id,
                    releaseDate: releaseDate
                ),
                rarity: nil,
                imageURL: nil,
                price: nil
            ),
            confidence: CardScanConfidence(score: 0.9, reason: nil),
            originatingStrategy: .mlDetector
        )
    }
}

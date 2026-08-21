import XCTest
@testable import TCGer

final class SealedSetResolverTests: XCTestCase {
    func testResolvesProviderAbbreviationBySetName() throws {
        let product = makeProduct(name: "Pitch Black Sleeved Booster Pack", setCode: "PBL")
        let pitchBlack = makeSet(code: "me05", name: "Pitch Black")

        let resolved = SealedSetResolver.linkedSet(
            for: product,
            in: [makeSet(code: "base1", name: "Base Set"), pitchBlack]
        )

        XCTAssertEqual(try XCTUnwrap(resolved).code, "me05")
    }

    func testPrefersExactCodeMatch() throws {
        let product = makeProduct(name: "Pitch Black Booster Pack", setCode: "PBL")
        let exact = makeSet(code: "PBL", name: "Promotional Battle League")

        let resolved = SealedSetResolver.linkedSet(
            for: product,
            in: [makeSet(code: "me05", name: "Pitch Black"), exact]
        )

        XCTAssertEqual(try XCTUnwrap(resolved).code, "PBL")
    }

    func testDoesNotUsePartialWordMatches() {
        let product = makeProduct(name: "Baseball Collection Box", setCode: "UNKNOWN")

        XCTAssertNil(
            SealedSetResolver.linkedSet(
                for: product,
                in: [makeSet(code: "base1", name: "Base")]
            )
        )
    }

    private func makeProduct(name: String, setCode: String) -> SealedProduct {
        SealedProduct(
            id: "sealed-product",
            tcg: "pokemon",
            name: name,
            productType: "booster",
            setCode: setCode,
            cardsPerPack: nil,
            packsPerBox: nil,
            releaseDate: nil,
            imageUrl: nil,
            msrp: nil,
            upc: nil
        )
    }

    private func makeSet(code: String, name: String) -> TcgSet {
        TcgSet(
            code: code,
            name: name,
            tcg: "pokemon",
            releaseDate: nil,
            totalCards: nil,
            standardCards: nil,
            iconUrl: nil,
            logoUrl: nil
        )
    }
}

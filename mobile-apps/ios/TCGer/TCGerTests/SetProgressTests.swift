import XCTest
@testable import TCGer

final class SetProgressTests: XCTestCase {
    func testStandardAndMasterTotalsUseDifferentChecklists() {
        let set = TcgSet(
            code: "sv3pt5",
            name: "151",
            tcg: "pokemon",
            releaseDate: "2023-09-22",
            totalCards: 207,
            standardCards: 165,
            iconUrl: nil,
            logoUrl: nil
        )

        XCTAssertEqual(SetProgressCalculator.total(for: set, mode: .standard), 165)
        XCTAssertEqual(SetProgressCalculator.total(for: set, mode: .master), 207)
    }

    func testStandardChecklistExcludesPokemonSecretNumbers() {
        XCTAssertTrue(SetProgressCalculator.includes(
            collectorNumber: "165/165",
            tcg: "pokemon",
            standardLimit: 165,
            mode: .standard
        ))
        XCTAssertFalse(SetProgressCalculator.includes(
            collectorNumber: "166/165",
            tcg: "pokemon",
            standardLimit: 165,
            mode: .standard
        ))
        XCTAssertTrue(SetProgressCalculator.includes(
            collectorNumber: "166/165",
            tcg: "pokemon",
            standardLimit: 165,
            mode: .master
        ))
    }

    func testFocusedOrderNormalizesAndDeduplicates() {
        XCTAssertEqual(
            FocusedSetOrder.normalized([" Pokemon::SV3PT5 ", "pokemon::sv3pt5", "magic::lea", ""]),
            ["pokemon::sv3pt5", "magic::lea"]
        )
    }
}

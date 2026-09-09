import XCTest
@testable import TCGer
final class GradingContractTests: XCTestCase {
    private struct Fixture: Decodable {
        let name: String
        let input: GradingScenario
        let expected: Expected
        struct Expected: Decodable {
            let verdict: String; let population: Int; let pricedPopulation: Int
            let expectedGain: Double?; let expectedValue: Double?; let totalCost: Double?; let rawNet: Double?; let breakEven: String?
        }
    }
    func testSharedEconomicFixtures() throws {
        var root = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: root.appendingPathComponent("mobile-parity/fixtures/grading-calculations.json").path), root.path != "/" { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("mobile-parity/fixtures/grading-calculations.json"))
        for fixture in try JSONDecoder().decode([Fixture].self, from: data) {
            let result = try XCTUnwrap(fixture.input.calculate(), fixture.name)
            XCTAssertEqual(result.verdict, fixture.expected.verdict, fixture.name)
            XCTAssertEqual(result.population, fixture.expected.population, fixture.name)
            XCTAssertEqual(result.pricedPopulation, fixture.expected.pricedPopulation, fixture.name)
            if let gain = fixture.expected.expectedGain { XCTAssertEqual(try XCTUnwrap(result.expectedGain), gain, accuracy: 0.000001, fixture.name) }
            else { XCTAssertNil(result.expectedGain, fixture.name) }
            if let value = fixture.expected.expectedValue { XCTAssertEqual(try XCTUnwrap(result.expectedValue), value, accuracy: 0.000001, fixture.name) }
            if let value = fixture.expected.totalCost { XCTAssertEqual(result.totalCost, value, accuracy: 0.000001) }
            if let value = fixture.expected.rawNet { XCTAssertEqual(result.rawNet, value, accuracy: 0.000001) }
            if let value = fixture.expected.breakEven { XCTAssertEqual(result.breakEven, value) }
        }
    }
}

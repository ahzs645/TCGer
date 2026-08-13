import XCTest
@testable import TCGer

final class CollectionValueChartSupportTests: XCTestCase {
    func testSelectedIndexRoundsAndClampsToAvailablePoints() {
        XCTAssertEqual(CollectionValueChartSupport.selectedIndex(forPlotX: 1.6, pointCount: 4), 2)
        XCTAssertEqual(CollectionValueChartSupport.selectedIndex(forPlotX: -20, pointCount: 4), 0)
        XCTAssertEqual(CollectionValueChartSupport.selectedIndex(forPlotX: 20, pointCount: 4), 3)
    }

    func testSelectedIndexRejectsEmptyAndInvalidInputs() {
        XCTAssertNil(CollectionValueChartSupport.selectedIndex(forPlotX: 0, pointCount: 0))
        XCTAssertNil(CollectionValueChartSupport.selectedIndex(forPlotX: .nan, pointCount: 3))
    }

    func testDisplayDateFormatsServerDayAndPreservesUnknownInput() {
        XCTAssertNotEqual(CollectionValueChartSupport.displayDate("2026-08-13"), "2026-08-13")
        XCTAssertEqual(CollectionValueChartSupport.displayDate("not-a-date"), "not-a-date")
    }
}

import SwiftUI
import XCTest
@testable import TCGer

final class ColorPickerAccessibilityTests: XCTestCase {
    func testEveryBinderColorHasAUniqueAccessibilityName() {
        let names = ColorPickerGrid.accessibilityColorNames

        XCTAssertEqual(names.count, Color.binderColors.count)
        XCTAssertEqual(Set(names).count, names.count)
        XCTAssertFalse(names.contains { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
    }
}

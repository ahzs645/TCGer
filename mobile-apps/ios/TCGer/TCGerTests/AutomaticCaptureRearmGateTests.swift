import XCTest
@testable import TCGer

final class AutomaticCaptureRearmGateTests: XCTestCase {
    func testAcceptedCaptureDisarmsUntilCardLeaves() {
        var gate = AutomaticCaptureRearmGate()
        gate.acceptedCapture()
        XCTAssertFalse(gate.isArmed)
        XCTAssertFalse(gate.observe(cardPresent: true))
        XCTAssertTrue(gate.observe(cardPresent: false))
        XCTAssertTrue(gate.isArmed)
    }

    func testNextCardRearmsExplicitly() {
        var gate = AutomaticCaptureRearmGate()
        gate.acceptedCapture()
        gate.nextCard()
        XCTAssertTrue(gate.isArmed)
    }
}

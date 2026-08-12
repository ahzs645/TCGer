import XCTest
@testable import TCGer

final class ScannerCameraThrottleTests: XCTestCase {
    func testIdlesAfterEmptyAnalysisStreakAndWakesOnCard() {
        var throttle = ScannerCameraThrottle()
        for _ in 0..<(ScannerCameraThrottle.emptyAnalysesBeforeIdle - 1) {
            XCTAssertFalse(throttle.noteAnalysis(cardVisible: false))
        }
        XCTAssertTrue(throttle.noteAnalysis(cardVisible: false))
        XCTAssertFalse(throttle.noteAnalysis(cardVisible: true))
    }

    func testCardMidStreakResetsTheEmptyCount() {
        var throttle = ScannerCameraThrottle()
        for _ in 0..<(ScannerCameraThrottle.emptyAnalysesBeforeIdle - 1) {
            XCTAssertFalse(throttle.noteAnalysis(cardVisible: false))
        }
        XCTAssertFalse(throttle.noteAnalysis(cardVisible: true))
        for _ in 0..<(ScannerCameraThrottle.emptyAnalysesBeforeIdle - 1) {
            XCTAssertFalse(throttle.noteAnalysis(cardVisible: false))
        }
        XCTAssertTrue(throttle.noteAnalysis(cardVisible: false))
    }

    func testOverlayIdlesImmediatelyAndReleasesOnTheNextFrame() {
        var throttle = ScannerCameraThrottle()
        for _ in 0..<35 {
            XCTAssertTrue(throttle.noteOverlay(true))
        }
        // The overlay pinned the empty count at zero, so dismissal returns to
        // the scanning rate on the very next frame — empty viewfinder or not.
        XCTAssertFalse(throttle.noteOverlay(false))
    }

    func testOverlayClearsAnAccumulatedEmptyStreak() {
        var throttle = ScannerCameraThrottle()
        for _ in 0..<(ScannerCameraThrottle.emptyAnalysesBeforeIdle - 1) {
            _ = throttle.noteAnalysis(cardVisible: false)
        }
        XCTAssertTrue(throttle.noteOverlay(true))
        XCTAssertFalse(throttle.noteOverlay(false))
        XCTAssertFalse(throttle.noteAnalysis(cardVisible: false))
    }

    /// Two constants in two files that must not drift: analyses run at most
    /// once a second, so the idle threshold expressed in seconds must stay
    /// above the consensus match window — otherwise a candidate that is mid-
    /// confirmation could idle the camera while the user holds the card.
    func testIdleThresholdClearsTheConsensusMatchWindow() {
        XCTAssertGreaterThan(
            Double(ScannerCameraThrottle.emptyAnalysesBeforeIdle),
            LiveScanConsensus.Configuration.standard.matchWindow
        )
    }
}

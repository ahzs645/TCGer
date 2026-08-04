import XCTest
@testable import TCGer

final class LiveScanConsensusTests: XCTestCase {
    func testRequiresConsecutiveAgreementBeforeAccepting() {
        var consensus = LiveScanConsensus()
        let now = Date()

        XCTAssertEqual(
            consensus.observe(key: "pokemon:swsh9-132", at: now),
            .pending(count: 1, required: 2)
        )
        XCTAssertEqual(
            consensus.observe(key: "pokemon:swsh9-132", at: now.addingTimeInterval(1)),
            .accepted
        )
    }

    func testDifferentCandidateRestartsConfirmation() {
        var consensus = LiveScanConsensus()
        let now = Date()

        _ = consensus.observe(key: "pokemon:first", at: now)
        XCTAssertEqual(
            consensus.observe(key: "pokemon:second", at: now.addingTimeInterval(1)),
            .pending(count: 1, required: 2)
        )
    }

    func testExpiredCandidateRestartsConfirmation() {
        var consensus = LiveScanConsensus()
        let now = Date()

        _ = consensus.observe(key: "pokemon:first", at: now)
        XCTAssertEqual(
            consensus.observe(key: "pokemon:first", at: now.addingTimeInterval(4)),
            .pending(count: 1, required: 2)
        )
    }

    func testSuppressesDuplicateUntilCardLeavesFrame() {
        var consensus = LiveScanConsensus()
        let now = Date()

        _ = consensus.observe(key: "pokemon:first", at: now)
        XCTAssertEqual(
            consensus.observe(key: "pokemon:first", at: now.addingTimeInterval(1)),
            .accepted
        )
        XCTAssertEqual(
            consensus.observe(key: "pokemon:first", at: now.addingTimeInterval(2)),
            .duplicateSuppressed
        )

        _ = consensus.observeNoMatch()
        XCTAssertEqual(
            consensus.observe(key: "pokemon:first", at: now.addingTimeInterval(3)),
            .duplicateSuppressed
        )
        _ = consensus.observeNoMatch()
        _ = consensus.observeNoMatch()
        XCTAssertEqual(
            consensus.observe(key: "pokemon:first", at: now.addingTimeInterval(4)),
            .pending(count: 1, required: 2)
        )
    }

    func testSuppressesDifferentCandidateUntilCardLeavesFrame() {
        var consensus = LiveScanConsensus()
        let now = Date()

        _ = consensus.observe(key: "pokemon:first-printing", at: now)
        _ = consensus.observe(key: "pokemon:first-printing", at: now.addingTimeInterval(1))

        XCTAssertEqual(
            consensus.observe(key: "pokemon:near-twin", at: now.addingTimeInterval(2)),
            .duplicateSuppressed
        )
    }
}

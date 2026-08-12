import XCTest
@testable import TCGer

/// Policy tests for the strategy's single-slot footer-OCR cache: reuse is
/// allowed only for a near-identical crop embedding (the same steady card),
/// so a swapped card — even a near twin — re-reads its footer.
final class ScannerOCRCacheTests: XCTestCase {
    private func makeStrategy() -> BoardCardEmbeddingScannerStrategy {
        BoardCardEmbeddingScannerStrategy()
    }

    func testCacheStartsEmpty() {
        XCTAssertNil(makeStrategy().cachedFooterReading(matching: [1, 0]))
    }

    func testReadingIsReusedForANearIdenticalEmbedding() {
        let strategy = makeStrategy()
        _ = strategy.footerReading(
            for: ScannerTestImage.solid(),
            embedding: [1, 0],
            source: .livePreview
        )
        XCTAssertNotNil(strategy.cachedFooterReading(matching: [1, 0]))
        // cosine ≈ 0.995 — the same card wobbling in hand.
        XCTAssertNotNil(strategy.cachedFooterReading(matching: [0.995, 0.0999]))
    }

    func testReadingIsNotReusedBelowTheCosineBar() {
        let strategy = makeStrategy()
        _ = strategy.footerReading(
            for: ScannerTestImage.solid(),
            embedding: [1, 0],
            source: .livePreview
        )
        // cosine ≈ 0.96 < 0.97 — close, but not "the same steady card".
        XCTAssertNil(strategy.cachedFooterReading(matching: [0.96, 0.28]))
        // Orthogonal — a different card entirely.
        XCTAssertNil(strategy.cachedFooterReading(matching: [0, 1]))
    }

    func testMismatchedEmbeddingLengthNeverHits() {
        let strategy = makeStrategy()
        _ = strategy.footerReading(
            for: ScannerTestImage.solid(),
            embedding: [1, 0],
            source: .livePreview
        )
        XCTAssertNil(strategy.cachedFooterReading(matching: [1, 0, 0]))
        XCTAssertNil(strategy.cachedFooterReading(matching: []))
    }

    func testIntentionalCaptureSeedsTheCacheForLaterLiveFrames() {
        let strategy = makeStrategy()
        _ = strategy.footerReading(
            for: ScannerTestImage.solid(),
            embedding: [0, 1],
            source: .photoCapture
        )
        XCTAssertNotNil(strategy.cachedFooterReading(matching: [0, 1]))
    }
}

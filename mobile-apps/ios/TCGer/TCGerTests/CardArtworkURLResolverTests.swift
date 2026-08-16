import Foundation
import XCTest
@testable import TCGer

final class CardArtworkURLResolverTests: XCTestCase {
    private let full = "https://images.example.test/card/high.webp"
    private let thumbnail = "https://images.example.test/card/low.webp"

    func testOfflinePreviewUsesCachedThumbnailWhenFullImageIsMissing() throws {
        let thumbnailURL = try XCTUnwrap(URL(string: thumbnail))

        let resolved = CardArtworkURLResolver.resolve(
            preferred: full,
            alternate: thumbnail,
            isConnected: false,
            isCached: { $0 == thumbnailURL }
        )

        XCTAssertEqual(resolved, thumbnailURL)
    }

    func testOfflinePreviewStillPrefersCachedFullImage() throws {
        let fullURL = try XCTUnwrap(URL(string: full))
        let thumbnailURL = try XCTUnwrap(URL(string: thumbnail))

        let resolved = CardArtworkURLResolver.resolve(
            preferred: full,
            alternate: thumbnail,
            isConnected: false,
            isCached: { $0 == fullURL || $0 == thumbnailURL }
        )

        XCTAssertEqual(resolved, fullURL)
    }

    func testOnlinePreviewKeepsFullResolutionPreference() throws {
        let fullURL = try XCTUnwrap(URL(string: full))

        let resolved = CardArtworkURLResolver.resolve(
            preferred: full,
            alternate: thumbnail,
            isConnected: true,
            isCached: { _ in false }
        )

        XCTAssertEqual(resolved, fullURL)
    }
}

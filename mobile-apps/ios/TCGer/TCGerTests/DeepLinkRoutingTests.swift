import XCTest
@testable import TCGer

final class DeepLinkRoutingTests: XCTestCase {
    func testWidgetBinderURLPreservesBinderIdentifier() throws {
        let url = try XCTUnwrap(URL(string: "tcger://binder/binder-123"))
        XCTAssertEqual(
            EnvironmentStore.deepLinkDestination(for: url),
            .binder(id: "binder-123")
        )
    }

    func testWidgetWishlistURLPreservesWishlistIdentifier() throws {
        let url = try XCTUnwrap(URL(string: "tcger://wishlist/wishlist-456"))
        XCTAssertEqual(
            EnvironmentStore.deepLinkDestination(for: url),
            .wishlist(id: "wishlist-456")
        )
    }

    func testScannerWidgetURLPreservesSupportedGame() throws {
        let url = try XCTUnwrap(URL(string: "tcger://scan?game=pokemon"))
        XCTAssertEqual(
            EnvironmentStore.deepLinkDestination(for: url),
            .scan(game: "pokemon")
        )
    }

    func testPackOpeningWidgetURLRoutesDirectlyToPackOpening() throws {
        let customURL = try XCTUnwrap(URL(string: "tcger://packs"))
        let universalURL = try XCTUnwrap(URL(string: "https://tcger.ahmadjalil.com/packs"))

        XCTAssertEqual(EnvironmentStore.deepLinkDestination(for: customURL), .packOpening)
        XCTAssertEqual(EnvironmentStore.deepLinkDestination(for: universalURL), .packOpening)
    }

    func testSearchShortcutURLPreservesDecodedQuery() throws {
        let url = try XCTUnwrap(URL(string: "tcger://search?q=Black%20Lotus"))
        XCTAssertEqual(
            EnvironmentStore.deepLinkDestination(for: url),
            .search(query: "Black Lotus")
        )
    }

    func testUniversalLinkUsesSameTypedDestination() throws {
        let url = try XCTUnwrap(
            URL(string: "https://tcger.ahmadjalil.com/binder/binder-123")
        )
        XCTAssertEqual(
            EnvironmentStore.deepLinkDestination(for: url),
            .binder(id: "binder-123")
        )
    }

    func testShortcutUniversalLinksPreserveScannerAndSearchInput() throws {
        let scanner = try XCTUnwrap(URL(string: "https://tcger.ahmadjalil.com/scan"))
        let search = try XCTUnwrap(
            URL(string: "https://tcger.ahmadjalil.com/search?q=Black%20Lotus")
        )

        XCTAssertEqual(EnvironmentStore.deepLinkDestination(for: scanner), .scan(game: nil))
        XCTAssertEqual(
            EnvironmentStore.deepLinkDestination(for: search),
            .search(query: "Black Lotus")
        )
    }

    func testUntrustedWebHostAndUnknownAppRouteAreRejected() throws {
        let untrusted = try XCTUnwrap(URL(string: "https://example.com/binder/binder-123"))
        let unknown = try XCTUnwrap(URL(string: "tcger://not-a-route"))
        XCTAssertNil(EnvironmentStore.deepLinkDestination(for: untrusted))
        XCTAssertNil(EnvironmentStore.deepLinkDestination(for: unknown))
    }

    func testOverflowDestinationRoutesThroughMore() {
        let tabs: [AppTab] = [.home, .collections, .sets, .scan, .wishlists, .settings]
        let layout = AppTabLayout(tabs: tabs)

        XCTAssertEqual(layout.primaryTabs, [.home, .collections, .sets, .scan])
        XCTAssertEqual(layout.overflowTabs, [.wishlists, .settings])
        XCTAssertEqual(layout.presentation(for: .collections), .primary(.collections))
        XCTAssertEqual(layout.presentation(for: .wishlists), .more(.wishlists))
    }

    func testFiveOrFewerTabsDoNotCreateMoreTab() {
        let tabs: [AppTab] = [.home, .collections, .sets, .scan, .settings]
        let layout = AppTabLayout(tabs: tabs)

        XCTAssertEqual(layout.primaryTabs, tabs)
        XCTAssertTrue(layout.overflowTabs.isEmpty)
        XCTAssertEqual(layout.presentation(for: .settings), .primary(.settings))
    }

    func testActivityTabFollowsNotificationFeatureCapability() {
        XCTAssertTrue(AppTab.activity.isSupported(by: .allEnabled))
        XCTAssertFalse(
            AppTab.activity.isSupported(
                by: ServerFeatures(notifications: false)
            )
        )
    }

    func testServerOnlyTabsAreIdentifiedForOnDeviceFiltering() {
        XCTAssertTrue(AppTab.decks.requiresServerConnection)
        XCTAssertTrue(AppTab.trades.requiresServerConnection)
        XCTAssertTrue(AppTab.activity.requiresServerConnection)

        XCTAssertFalse(AppTab.home.requiresServerConnection)
        XCTAssertFalse(AppTab.collections.requiresServerConnection)
        XCTAssertFalse(AppTab.settings.requiresServerConnection)
    }

    @MainActor
    func testEachRoutingLayerClaimsARequestOnlyOnce() throws {
        let store = EnvironmentStore()
        let url = try XCTUnwrap(URL(string: "tcger://binder/binder-123"))
        store.handleDeepLink(url)
        let request = try XCTUnwrap(store.pendingDeepLinkRequest)

        XCTAssertTrue(store.claimDeepLinkRequest(request, for: .appShell))
        XCTAssertFalse(store.claimDeepLinkRequest(request, for: .appShell))
        XCTAssertTrue(store.claimDeepLinkRequest(request, for: .collections))
        XCTAssertFalse(store.claimDeepLinkRequest(request, for: .collections))
    }
}

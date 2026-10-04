import XCTest
@testable import TCGer

@MainActor
final class WidgetSessionTests: XCTestCase {
    func testSessionChangesClearPrivateSnapshotAndRejectLateProducer() throws {
        let storage = try XCTUnwrap(UserDefaults(suiteName: "WidgetSession-" + UUID().uuidString))
        let widgets = try XCTUnwrap(UserDefaults(suiteName: "WidgetSnapshot-" + UUID().uuidString))
        let environment = EnvironmentStore(storage: storage, widgetDefaults: widgets)
        let originalSession = environment.widgetSessionID
        widgets.set("Private binder", forKey: "widget.binders")
        widgets.set("keep", forKey: "unrelated")
        environment.signOut()
        XCTAssertNil(widgets.object(forKey: "widget.binders"))
        XCTAssertEqual(widgets.string(forKey: "unrelated"), "keep")
        environment.updateWidgetData(collections: [], sessionID: originalSession)
        XCTAssertNil(widgets.object(forKey: "widget.lastUpdated"))
        environment.serverConfiguration = .onDevice
        environment.enableLocalSession(force: true)
        XCTAssertNotNil(widgets.object(forKey: "widget.lastUpdated"))
        widgets.removeObject(forKey: "widget.lastUpdated")
        environment.updateWidgetData(collections: [], sessionID: originalSession)
        XCTAssertNil(widgets.object(forKey: "widget.lastUpdated"))
        widgets.set("Private wishlist", forKey: "widget.wishlists")
        environment.serverConfiguration = ServerConfiguration(baseURL: "https://other.test")
        XCTAssertNil(widgets.object(forKey: "widget.wishlists"))
        let beforeCredentialChange = environment.widgetSessionID
        environment.authToken = "new-credential"
        XCTAssertNotEqual(environment.widgetSessionID, beforeCredentialChange)
    }
}

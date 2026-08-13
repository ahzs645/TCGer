import XCTest
import WebKit
@testable import TCGer

final class PackOpeningResourceTests: XCTestCase {
    func testMIMETypesNeededByTheEmbeddedExperience() {
        XCTAssertEqual(PackOpeningResource.mimeType(for: "html"), "text/html")
        XCTAssertEqual(PackOpeningResource.mimeType(for: "JS"), "text/javascript")
        XCTAssertEqual(PackOpeningResource.mimeType(for: "webp"), "image/webp")
        XCTAssertEqual(PackOpeningResource.mimeType(for: "obj"), "text/plain")
    }

    func testEntryDocumentSharesTheAssetOrigin() {
        XCTAssertEqual(PackOpeningResource.entryURL.scheme, PackOpeningResource.scheme)
        XCTAssertEqual(PackOpeningResource.entryURL.host, PackOpeningResource.assetHost)
    }

    func testResourceResolutionStaysInsideBundleRoot() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("ok".utf8).write(to: root.appendingPathComponent("index.html"))

        XCTAssertEqual(
            PackOpeningResource.fileURL(for: PackOpeningResource.entryURL, root: root)?.lastPathComponent,
            "index.html"
        )
        XCTAssertNil(PackOpeningResource.fileURL(
            for: URL(string: "tcger-pack://bundle/../outside.txt")!,
            root: root
        ))
        XCTAssertNil(PackOpeningResource.fileURL(
            for: URL(string: "https://bundle/index.html")!,
            root: root
        ))
    }

    func testSharedAssetRequestsMapToTheR2Origin() {
        let request = URL(string: "tcger-pack://assets/pack/manifest.json")!
        XCTAssertEqual(
            PackOpeningResource.remoteURL(
                for: request,
                baseURL: URL(string: "https://assets.example.com")!
            )?.absoluteString,
            "https://assets.example.com/pack/manifest.json"
        )
        XCTAssertNil(PackOpeningResource.remoteURL(
            for: URL(string: "tcger-pack://bundle/index.html")!,
            baseURL: URL(string: "https://assets.example.com")!
        ))
        XCTAssertNil(PackOpeningResource.remoteURL(
            for: URL(string: "tcger-pack://assets/catalogs/manifest.json")!,
            baseURL: URL(string: "https://assets.example.com")!
        ))
    }

    func testSharedAssetRequestsCanFallBackToTheEmbeddedPackDirectory() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let pack = root.appendingPathComponent("pack", isDirectory: true)
        try FileManager.default.createDirectory(at: pack, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try Data("{}".utf8).write(to: pack.appendingPathComponent("manifest.json"))

        XCTAssertEqual(
            PackOpeningResource.fileURL(
                for: URL(string: "tcger-pack://assets/pack/manifest.json")!,
                root: root
            )?.lastPathComponent,
            "manifest.json"
        )
    }

    func testPublishedCoverArtworkDoesNotShipInTheEmbeddedPackBundle() throws {
        let root = try XCTUnwrap(PackOpeningResource.rootURL())
        let manifestURL = root.appendingPathComponent("pack/manifest.json")
        let object = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: manifestURL)) as? [String: Any]
        )
        let covers = try XCTUnwrap(object["covers"] as? [String: [String: Any]])
        XCTAssertTrue(covers.isEmpty)
        XCTAssertFalse(FileManager.default.fileExists(
            atPath: root.appendingPathComponent("pack/covers", isDirectory: true).path
        ))
    }

    func testCompletedPullSessionDecodesFromTheJavaScriptBridge() {
        let body: [String: Any] = [
            "type": "saveRequested",
            "session": [
                "id": "opening-1",
                "packLabel": "Aurora",
                "openedAt": "2026-08-12T15:49:00.000Z",
                "packs": [[[
                    "cardId": "swsh7-44",
                    "name": "Bergmite",
                    "rarity": "Common",
                    "tier": "common",
                    "collectorNumber": "44",
                    "tcg": "pokemon",
                    "setCode": "swsh7",
                    "setName": "Evolving Skies",
                    "imageUrl": "https://example.com/high.webp",
                    "imageUrlSmall": "https://example.com/low.webp"
                ]]]
            ]
        ]

        let session = PackOpeningBridgeDecoder.pullSession(from: body)
        XCTAssertEqual(session?.id, "opening-1")
        XCTAssertEqual(session?.packs.count, 1)
        XCTAssertEqual(session?.pulls.first?.card.id, "swsh7-44")
        XCTAssertEqual(session?.setCode, "swsh7")
        XCTAssertEqual(session?.resultArtworkURLs.first?.absoluteString, "https://example.com/low.webp")
    }

    func testNativePackInterfaceStateDecodesFromTheJavaScriptBridge() {
        let body: [String: Any] = [
            "type": "nativeState",
            "state": [
                "phase": "reveal",
                "selectedPackID": "base-charizard",
                "selectedPackLabel": "Base Charizard",
                "packCount": 1,
                "packOptions": [[
                    "id": "base-charizard",
                    "label": "Base Charizard",
                    "setID": "base1",
                    "setLabel": "Base Set",
                    "variationLabel": "Charizard"
                ]],
                "revealedCount": 3,
                "totalCards": 10,
                "currentPackNumber": 1,
                "totalPacks": 1,
                "canSave": true,
                "session": [
                    "id": "opening-native-1",
                    "packLabel": "Base Charizard",
                    "openedAt": "2026-08-12T23:36:00.000Z",
                    "packs": []
                ]
            ]
        ]

        let state = PackOpeningBridgeDecoder.interfaceState(from: body)
        XCTAssertEqual(state?.phase, .reveal)
        XCTAssertEqual(state?.selectedPackLabel, "Base Charizard")
        XCTAssertEqual(state?.packOptions.first?.id, "base-charizard")
        XCTAssertEqual(state?.packSets.first?.label, "Base Set")
        XCTAssertEqual(state?.selectedVariationLabel, "Charizard")
        XCTAssertEqual(state?.revealedCount, 3)
        XCTAssertEqual(state?.session?.id, "opening-native-1")
    }

    func testPackArtworkChoicesAreFilteredByTheSelectedSet() {
        let options = [
            PackOpeningInterfaceState.PackOption(
                id: "base-venusaur",
                label: "Base · Venusaur",
                setID: "base1",
                setLabel: "Base Set",
                variationLabel: "Venusaur"
            ),
            PackOpeningInterfaceState.PackOption(
                id: "base-blastoise",
                label: "Base · Blastoise",
                setID: "base1",
                setLabel: "Base Set",
                variationLabel: "Blastoise"
            ),
            PackOpeningInterfaceState.PackOption(
                id: "swsh7:aurora",
                label: "Evolving Skies · Aurora",
                setID: "swsh7",
                setLabel: "Evolving Skies",
                variationLabel: "Aurora wrapper"
            )
        ]
        let state = PackOpeningInterfaceState(
            phase: .select,
            selectedPackID: "base-blastoise",
            selectedPackLabel: "Base · Blastoise",
            packCount: 1,
            packOptions: options,
            revealedCount: 0,
            totalCards: 0,
            currentPackNumber: 0,
            totalPacks: 0,
            canSave: false,
            warning: nil,
            session: nil
        )

        XCTAssertEqual(state.packSets.map(\.label), ["Base Set", "Evolving Skies"])
        XCTAssertEqual(state.selectedSetLabel, "Base Set")
        XCTAssertEqual(
            state.selectedSetOptions.map(\.resolvedVariationLabel),
            ["Venusaur", "Blastoise"]
        )
        XCTAssertFalse(state.selectedSetOptions.contains { $0.resolvedSetID == "swsh7" })
    }

    func testNativePackCommandUsesTheExpectedBridgeShape() {
        let command = PackOpeningCommand.setPackCount(5)
        XCTAssertEqual(command.payload["type"] as? String, "setPackCount")
        XCTAssertEqual(command.payload["count"] as? Int, 5)
        XCTAssertNotEqual(PackOpeningCommand.advance.id, PackOpeningCommand.advance.id)
    }

    @MainActor
    func testWarmRendererReplaysReadyStateWhenInteractiveHostAttaches() {
        let coordinator = PackOpeningWebCoordinator()
        coordinator.emit(.ready)
        coordinator.emit(.interfaceState(.loading))

        var replayed: [PackOpeningBridgeEvent] = []
        coordinator.setEventHandler({ replayed.append($0) }, replay: true)

        XCTAssertEqual(replayed, [.ready, .interfaceState(.loading)])
    }

    @MainActor
    func testWarmWebViewMovesBetweenContainersWithoutBeingDetachedByTheOldHost() {
        let webView = WKWebView()
        let warmHost = PackOpeningWebContainerView()
        let interactiveHost = PackOpeningWebContainerView()

        warmHost.attach(webView)
        XCTAssertTrue(webView.superview === warmHost)

        interactiveHost.attach(webView)
        warmHost.detachWebView()
        XCTAssertTrue(webView.superview === interactiveHost)

        interactiveHost.detachWebView()
        XCTAssertNil(webView.superview)
    }

    @MainActor
    func testRemoteSchemeCallbacksAreDeliveredOnTheMainThread() async {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ImmediateResponseURLProtocol.self]
        let session = URLSession(configuration: configuration)
        let handler = PackOpeningSchemeHandler(
            remoteBaseURL: URL(string: "https://assets.example.com")!,
            session: session
        )
        let finished = expectation(description: "Scheme task finished")
        let schemeTask = RecordingURLSchemeTask(
            request: URLRequest(url: URL(string: "tcger-pack://assets/pack/card-backs/pokemon.png")!),
            onFinish: { finished.fulfill() }
        )

        handler.webView(WKWebView(), start: schemeTask)
        await fulfillment(of: [finished], timeout: 2)

        XCTAssertEqual(schemeTask.callbackCount, 3)
        XCTAssertTrue(schemeTask.callbacksWereOnMainThread)
    }
}

private final class ImmediateResponseURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "image/png"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data([0x89, 0x50, 0x4E, 0x47]))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private final class RecordingURLSchemeTask: NSObject, WKURLSchemeTask {
    let request: URLRequest
    private let onFinish: () -> Void
    private(set) var callbackCount = 0
    private(set) var callbacksWereOnMainThread = true

    init(request: URLRequest, onFinish: @escaping () -> Void) {
        self.request = request
        self.onFinish = onFinish
    }

    func didReceive(_ response: URLResponse) {
        recordCallback()
    }

    func didReceive(_ data: Data) {
        recordCallback()
    }

    func didFinish() {
        recordCallback()
        onFinish()
    }

    func didFailWithError(_ error: any Error) {
        recordCallback()
        onFinish()
    }

    private func recordCallback() {
        callbackCount += 1
        callbacksWereOnMainThread = callbacksWereOnMainThread && Thread.isMainThread
    }
}

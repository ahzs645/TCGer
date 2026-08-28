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

    func testRemoteCardTextureRequestsOnlyAllowTheTCGDexAssetHost() {
        let tcgdex = URL(string: "https://assets.tcgdex.net/en/me/me05/001/high.webp")!
        var allowed = URLComponents()
        allowed.scheme = PackOpeningResource.scheme
        allowed.host = PackOpeningResource.assetHost
        allowed.path = PackOpeningResource.remoteTexturePath
        allowed.queryItems = [URLQueryItem(name: "url", value: tcgdex.absoluteString)]

        XCTAssertEqual(
            PackOpeningResource.remoteURL(
                for: allowed.url!,
                baseURL: URL(string: "https://assets.example.com")!
            ),
            tcgdex
        )

        allowed.queryItems = [URLQueryItem(
            name: "url",
            value: "https://untrusted.example.com/card.png"
        )]
        XCTAssertNil(PackOpeningResource.remoteURL(
            for: allowed.url!,
            baseURL: URL(string: "https://assets.example.com")!
        ))
    }

    func testManifestBypassesWebKitCacheWhileContentAddressedAssetsRemainCacheFirst() {
        let manifest = URL(string: "https://assets.example.com/pack/manifest.json")!
        let wrapper = URL(string: "https://assets.example.com/pack/objects/wrapper.png")!

        XCTAssertTrue(PackOpeningResource.isManifest(manifest))
        XCTAssertFalse(PackOpeningResource.isManifest(wrapper))
        XCTAssertEqual(
            PackOpeningResource.cachePolicy(for: manifest),
            .reloadIgnoringLocalCacheData
        )
        XCTAssertEqual(
            PackOpeningResource.cachePolicy(for: wrapper),
            .returnCacheDataElseLoad
        )
        XCTAssertEqual(PackOpeningResource.requestTimeout(for: manifest), 3)
        XCTAssertEqual(PackOpeningResource.requestTimeout(for: wrapper), 20)
    }

    func testPackOpeningAssetCachePersistsBytesByRemoteURL() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let cache = PackOpeningAssetCache(directory: directory)
        let wrapper = URL(string: "https://assets.example.com/pack/objects/wrapper.png")!
        let manifest = URL(string: "https://assets.example.com/pack/manifest.json")!
        cache.store(Data("wrapper".utf8), for: wrapper)
        cache.store(Data("manifest".utf8), for: manifest)

        XCTAssertTrue(cache.contains(wrapper))
        XCTAssertEqual(cache.byteCount(for: wrapper), Int64(Data("wrapper".utf8).count))
        XCTAssertEqual(cache.data(for: wrapper), Data("wrapper".utf8))
        XCTAssertEqual(cache.data(for: manifest), Data("manifest".utf8))

        cache.remove(wrapper)
        XCTAssertFalse(cache.contains(wrapper))
        XCTAssertNil(cache.data(for: wrapper))
        XCTAssertEqual(cache.data(for: manifest), Data("manifest".utf8))
    }

    func testOfflineSetDefinitionsMatchRendererAndMetadataIdentifiers() {
        XCTAssertEqual(PackOfflineSetDefinition.matching("base1")?.metadataSetCode, "base1")
        XCTAssertEqual(PackOfflineSetDefinition.matching("me5")?.metadataSetCode, "me05")
        XCTAssertEqual(PackOfflineSetDefinition.matching("ME05")?.packPool, "me5")
        XCTAssertNil(PackOfflineSetDefinition.matching("swsh7"))
    }

    @MainActor
    func testDownloadedSetRemainsOpenableWhenNetworkRouteIsUnusable() throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

        let record = PackOfflineDownloadRecord(
            setID: "base1",
            downloadedAt: Date(timeIntervalSince1970: 1_700_000_000),
            cardCount: 102,
            byteCount: 1_024,
            removableURLs: []
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(record).write(to: directory.appendingPathComponent("base1.json"))

        let manager = PackOfflineDownloadManager(directory: directory)
        XCTAssertTrue(manager.canOpen(setID: "base1", isConnected: false))
        XCTAssertFalse(manager.canOpen(setID: "me5", isConnected: false))
        XCTAssertTrue(manager.canOpen(setID: "me5", isConnected: true))
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

    func testEmbeddedRendererIncludesPullRateSourcesForEveryProbabilityModel() throws {
        let root = try XCTUnwrap(PackOpeningResource.rootURL())
        let script = try String(
            contentsOf: root.appendingPathComponent("pack-opening.js"),
            encoding: .utf8
        )

        XCTAssertTrue(script.contains("tcgtalk.com/guides/pitch-black-pull-rates"))
        XCTAssertTrue(script.contains("cs.sjsu.edu/~stamp/cv/papers/pokemon.pdf"))
        XCTAssertTrue(script.contains("PokemonTCG/comments/paitho"))
    }

    func testEmbeddedRendererKeepsRevealSwipesInsidePackScene() throws {
        let root = try XCTUnwrap(PackOpeningResource.rootURL())
        let script = try String(
            contentsOf: root.appendingPathComponent("pack-opening.js"),
            encoding: .utf8
        )

        XCTAssertFalse(script.contains("inspectRequested"))
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
        XCTAssertEqual(
            Set(session?.resultArtworkURLs.map(\.absoluteString) ?? []),
            ["https://example.com/low.webp", "https://example.com/high.webp"]
        )
    }

    func testNativePackInterfaceStateDecodesFromTheJavaScriptBridge() {
        let body: [String: Any] = [
            "type": "nativeState",
            "state": [
                "phase": "reveal",
                "selectedPackID": "base-charizard",
                "selectedPackLabel": "Base Charizard",
                "packCount": 1,
                "openingMode": "normal",
                "packBackwards": false,
                "currentCardFaceUp": true,
                "packOptions": [[
                    "id": "base-charizard",
                    "label": "Base Charizard",
                    "setID": "base1",
                    "setLabel": "Base Set",
                    "variationLabel": "Charizard",
                    "packPoolID": "base1",
                    "oddsReference": [
                        "title": "Pokémon Trading Card Sequences",
                        "url": "https://www.cs.sjsu.edu/~stamp/cv/papers/pokemon.pdf",
                        "sampleSize": 153,
                        "note": "Historical sample; not official factory odds."
                    ]
                ]],
                "cardPools": [[
                    "id": "base1",
                    "label": "Base Set",
                    "cards": [[
                        "cardId": "base1-4",
                        "name": "Charizard",
                        "rarity": "Holo Rare",
                        "tier": "chase",
                        "collectorNumber": "4",
                        "tcg": "pokemon",
                        "setCode": "base1",
                        "setName": "Base Set",
                        "imageUrl": "https://example.com/charizard-high.webp",
                        "imageUrlSmall": "https://example.com/charizard-low.webp"
                    ]]
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
        XCTAssertEqual(state?.packOptions.first?.packPoolID, "base1")
        XCTAssertEqual(state?.availableCardPools.first?.cards.first?.name, "Charizard")
        XCTAssertEqual(state?.selectedOddsReference?.sampleSize, 153)
        XCTAssertEqual(state?.selectedOddsReference?.sampleDescription, "Based on 153 observed packs")
        XCTAssertEqual(
            state?.selectedOddsReference?.destination?.host,
            "www.cs.sjsu.edu"
        )
        XCTAssertEqual(state?.revealedCount, 3)
        XCTAssertEqual(state?.currentCardFaceUp, true)
        XCTAssertEqual(state?.session?.id, "opening-native-1")
        XCTAssertEqual(state?.selectedCardPool?.id, "base1")
        XCTAssertEqual(state?.selectedCardPool?.cards.first?.name, "Charizard")
    }

    func testPackArtworkChoicesAreFilteredByTheSelectedSet() {
        let baseOdds = PackOpeningInterfaceState.PackOption.OddsReference(
            title: "Pokémon Trading Card Sequences",
            url: "https://www.cs.sjsu.edu/~stamp/cv/papers/pokemon.pdf",
            sampleSize: 153,
            note: "Historical sample; not official factory odds."
        )
        let options = [
            PackOpeningInterfaceState.PackOption(
                id: "base-venusaur",
                label: "Base · Venusaur",
                setID: "base1",
                setLabel: "Base Set",
                variationLabel: "Venusaur",
                packPoolID: "base1",
                oddsReference: baseOdds
            ),
            PackOpeningInterfaceState.PackOption(
                id: "base-blastoise",
                label: "Base · Blastoise",
                setID: "base1",
                setLabel: "Base Set",
                variationLabel: "Blastoise",
                packPoolID: "base1",
                oddsReference: baseOdds
            ),
            PackOpeningInterfaceState.PackOption(
                id: "swsh7:aurora",
                label: "Evolving Skies · Aurora",
                setID: "swsh7",
                setLabel: "Evolving Skies",
                variationLabel: "Aurora wrapper",
                packPoolID: "swsh7",
                oddsReference: nil
            )
        ]
        let state = PackOpeningInterfaceState(
            phase: .select,
            selectedPackID: "base-blastoise",
            selectedPackLabel: "Base · Blastoise",
            packCount: 1,
            openingMode: .normal,
            packBackwards: false,
            currentCardFaceUp: true,
            packOptions: options,
            cardPools: [],
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
        XCTAssertEqual(state.selectedPackDisplayLabel, "Base Set · Blastoise")
        XCTAssertEqual(
            state.selectedSetOptions.map(\.resolvedVariationLabel),
            ["Venusaur", "Blastoise"]
        )
        XCTAssertFalse(state.selectedSetOptions.contains { $0.resolvedSetID == "swsh7" })
        XCTAssertEqual(state.selectedOddsReference, baseOdds)
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
    func testBundledRendererBecomesReadyWithoutRemotePackResources() async {
        let session = PackOpeningWebSession()
        let ready = expectation(description: "Bundled pack renderer became ready")
        var rendererError: String?
        var didBecomeReady = false

        session.setEventHandler({ event in
            switch event {
            case .ready where !didBecomeReady:
                didBecomeReady = true
                ready.fulfill()
            case .error(let message):
                rendererError = message
            default:
                break
            }
        }, replay: false)
        session.setPrefersBundledResources(true)
        session.reload()

        await fulfillment(of: [ready], timeout: 10)
        XCTAssertNil(rendererError)
        XCTAssertTrue(session.isReady)
        XCTAssertNotNil(session.latestInterfaceState)
        XCTAssertFalse(session.latestInterfaceState?.packOptions.isEmpty ?? true)
        XCTAssertTrue(
            session.latestInterfaceState?.packOptions.allSatisfy {
                $0.oddsReference?.destination != nil
            } ?? false
        )
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

    @MainActor
    func testCachedManifestStartsRendererWithoutWaitingForRemoteRefresh() async throws {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        defer { try? FileManager.default.removeItem(at: directory) }

        let remoteBaseURL = URL(string: "https://assets.example.com")!
        let remoteManifestURL = remoteBaseURL.appendingPathComponent("pack/manifest.json")
        let cache = PackOpeningAssetCache(directory: directory)
        cache.store(Data(#"{"mesh":"/pack/models/pack.obj","covers":{}}"#.utf8), for: remoteManifestURL)

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StalledResponseURLProtocol.self]
        let handler = PackOpeningSchemeHandler(
            remoteBaseURL: remoteBaseURL,
            session: URLSession(configuration: configuration),
            assetCache: cache
        )
        var remoteAssetsUsable: Bool?
        handler.setRemoteAvailabilityHandler { remoteAssetsUsable = $0 }
        let finished = expectation(description: "Cached manifest delivered")
        let schemeTask = RecordingURLSchemeTask(
            request: URLRequest(url: URL(string: "tcger-pack://assets/pack/manifest.json")!),
            onFinish: { finished.fulfill() }
        )

        handler.webView(WKWebView(), start: schemeTask)
        await fulfillment(of: [finished], timeout: 0.5)

        XCTAssertEqual(schemeTask.callbackCount, 3)
        XCTAssertTrue(schemeTask.callbacksWereOnMainThread)
        XCTAssertEqual(remoteAssetsUsable, false)
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

private final class StalledResponseURLProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        // Intentionally never completes: the cached response must already have
        // unblocked WebKit while this simulates a weak, unusable route.
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

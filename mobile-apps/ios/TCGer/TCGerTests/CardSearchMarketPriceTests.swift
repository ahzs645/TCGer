import Foundation
import XCTest
@testable import TCGer

@MainActor
final class CardSearchMarketPriceTests: XCTestCase {
    private var previousSource: String?
    private var previousPriorities: Data?

    override func setUp() {
        super.setUp()
        previousSource = UserDefaults.standard.string(forKey: PricingSource.storageKey)
        previousPriorities = UserDefaults.standard.data(forKey: PricingSourcePreferences.storageKey)
        UserDefaults.standard.set(PricingSource.scryfall.rawValue, forKey: PricingSource.storageKey)
        UserDefaults.standard.removeObject(forKey: PricingSourcePreferences.storageKey)
    }

    override func tearDown() {
        UserDefaults.standard.set(previousSource, forKey: PricingSource.storageKey)
        UserDefaults.standard.set(previousPriorities, forKey: PricingSourcePreferences.storageKey)
        SearchPriceURLProtocol.handler = nil
        super.tearDown()
    }

    private func service() -> APIService {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SearchPriceURLProtocol.self]
        return APIService(session: URLSession(configuration: configuration))
    }

    private func card(tcg: String = "magic", attributes: [String: JSONValue]? = nil) -> Card {
        Card(id: UUID().uuidString, name: "Lightning Bolt", tcg: tcg,
             setCode: "M10", setName: "Magic 2010", rarity: "Common",
             imageUrl: nil, imageUrlSmall: nil, price: 99, collectorNumber: "146",
             releasedAt: nil, attributes: attributes)
    }

    func testSearchUsesScryfallIdentifierAndRealZeroWithoutMutatingStoredCard() async throws {
        let original = card(attributes: ["scryfall_id": .string("printing-identifier")])
        SearchPriceURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/cards/printing-identifier")
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNotNil(request.value(forHTTPHeaderField: "User-Agent"))
            XCTAssertNotNil(request.value(forHTTPHeaderField: "Accept"))
            return (200, #"{"prices":{"usd":"0.00","eur":"1.50"}}"#)
        }
        let quote = try await service().searchMarketEstimate(for: original, config: .onDevice, token: "local")
        XCTAssertEqual(quote?.price, 0)
        XCTAssertEqual(quote?.source, "scryfall")
        XCTAssertEqual(quote?.cached, false)
        XCTAssertEqual(original.price, 99)
    }

    func testSearchQuoteUsesExistingProviderCache() async throws {
        let original = card()
        var calls = 0
        SearchPriceURLProtocol.handler = { _ in
            calls += 1
            return (200, #"{"prices":{"usd":"1.90"}}"#)
        }
        let api = service()
        let first = try await api.searchMarketEstimate(for: original, config: .onDevice, token: "local")
        let second = try await api.searchMarketEstimate(for: original, config: .onDevice, token: "local")
        XCTAssertEqual(first?.price, 1.9)
        XCTAssertEqual(second?.price, 1.9)
        XCTAssertEqual(second?.cached, true)
        XCTAssertEqual(calls, 1)
    }

    func testUnavailableAndForeignCurrencyQuotesDoNotBecomeDollarEstimates() async throws {
        for (status, body) in [(404, "{}"), (200, #"{"prices":{"usd":null}}"#),
                               (200, #"{"prices":{"usd":"-1"}}"#),
                               (200, #"{"prices":{"usd":null,"eur":"1.50"}}"#)] {
            SearchPriceURLProtocol.handler = { _ in (status, body) }
            let original = card()
            let quote = try await service().searchMarketEstimate(for: original, config: .onDevice, token: "local")
            XCTAssertNil(quote)
            XCTAssertEqual(original.price, 99)
        }
    }

    func testUnsupportedGameAndServerSearchDoNotContactFreeProviders() async throws {
        SearchPriceURLProtocol.handler = { _ in XCTFail("Unexpected market request"); return (500, "{}") }
        let unsupported = try await service().searchMarketEstimate(for: card(tcg: "yugioh"), config: .onDevice, token: "local")
        let remote = try await service().searchMarketEstimate(for: card(), config: ServerConfiguration(baseURL: "https://example.test"), token: "token")
        XCTAssertNil(unsupported)
        XCTAssertNil(remote)
    }

    func testPokemonSearchUsesFreeTCGCSVWithExactProductAndCachedRelaunch() async throws {
        UserDefaults.standard.set(PricingSource.automatic.rawValue, forKey: PricingSource.storageKey)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let transport: TCGCSVPriceClient.Transport = { request in
            XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
            XCTAssertNil(request.value(forHTTPHeaderField: "x-api-key"))
            let body: String
            switch request.url!.path {
            case "/last-updated.txt": body = "2026-10-04T12:00:00.000Z"
            case "/tcgplayer/3/groups": body = #"{"success":true,"results":[{"groupId":3170,"name":"SWSH12: Silver Tempest","abbreviation":"SWSH12","categoryId":3}]}"#
            case "/tcgplayer/3/3170/products": body = #"{"success":true,"results":[{"productId":451396,"name":"Lugia VSTAR","groupId":3170,"categoryId":3,"extendedData":[{"name":"Number","value":"139/195"}]}]}"#
            case "/tcgplayer/3/3170/prices": body = #"{"success":true,"results":[{"productId":451396,"subTypeName":"Holofoil","marketPrice":6.96}]}"#
            default: throw URLError(.unsupportedURL)
            }
            return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!)
        }
        let original = Card(id: "swsh12-139", name: "Lugia VSTAR", tcg: "pokemon",
                            setCode: "swsh12", setName: "Silver Tempest", rarity: nil,
                            imageUrl: nil, imageUrlSmall: nil, price: nil, collectorNumber: "139", releasedAt: nil,
                            attributes: ["tcgplayer_id": .number(451396)])
        let api = APIService(tcgcsvPrices: TCGCSVPriceClient(directory: directory, transport: transport))
        let first = try await api.searchMarketEstimate(for: original, config: .onDevice, token: "local")
        XCTAssertEqual(first?.price, 6.96)
        XCTAssertTrue(first?.source.contains("TCGCSV") == true)
        let offline = APIService(tcgcsvPrices: TCGCSVPriceClient(directory: directory, transport: { _ in throw URLError(.notConnectedToInternet) }))
        let cached = try await offline.searchMarketEstimate(for: original, config: .onDevice, token: "local")
        XCTAssertEqual(cached?.price, 6.96)
        XCTAssertEqual(cached?.cached, true)
    }

    func testOwnedAndDemoResultsAreVisibleWithoutInstalledGames() {
        let cards = [LocalSampleCatalog.makeCards().pikaBase, LocalSampleCatalog.makeCards().boltM10]
        let local = CardSearchResultGrouping.groups(cards: cards, selectedGame: .all, enabledGames: [], includeUninstalled: true)
        XCTAssertEqual(Set(local.flatMap(\.1).map(\.id)), Set(cards.map(\.id)))
        let remote = CardSearchResultGrouping.groups(cards: cards, selectedGame: .all, enabledGames: [.magic], includeUninstalled: false)
        XCTAssertEqual(remote.flatMap(\.1).map(\.id), [cards[1].id])
    }

    func testTypedLocalSearchPreservesProviderIdentifiersAcrossRelaunch() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = FileLocalStorePersistenceRepository(rootDirectory: directory)
        let store = LocalStore(persistenceRepository: repository)
        try store.loadSampleData()
        let api = APIService(localStore: LocalStore(persistenceRepository: repository))
        let response = try await api.searchCards(config: .onDevice, token: "local", query: "Lightning Bolt")
        let printing = try XCTUnwrap(response.cards.first { $0.id == "sample-magic-lightning-bolt-m10" })
        XCTAssertEqual(printing.justTCGIdentifiers.scryfallId, "435589bb-27c6-4a6d-9d63-394d5092b9d8")
        XCTAssertEqual(printing.justTCGIdentifiers.tcgplayerId, "32656")
        XCTAssertEqual(printing.price, 2.1)
        XCTAssertFalse(CardSearchResultGrouping.groups(cards: response.cards, selectedGame: .all, enabledGames: [], includeUninstalled: true).isEmpty)
    }

    func testSupersededSuccessFailureAndSourceChangesCannotPublish() async {
        for fail in [false, true] {
            let request = CardSearchPriceRequest()
            let started = expectation(description: "old request started")
            var resume: CheckedContinuation<Void, Never>?
            let old = Task {
                await request.load(context: "old-source") {
                    await withCheckedContinuation { resume = $0; started.fulfill() }
                    if fail { throw URLError(.timedOut) }
                    return CardSearchMarketEstimate(price: 1, source: "old", cached: false)
                }
            }
            await fulfillment(of: [started], timeout: 2)
            XCTAssertNil(request.value(for: "new-source"))
            await request.load(context: "new-source") { CardSearchMarketEstimate(price: 2, source: "new", cached: false) }
            resume?.resume()
            await old.value
            XCTAssertEqual(request.value(for: "new-source")?.price, 2)
            XCTAssertNil(request.value(for: "old-source"))
        }
    }

    func testLogoutAndCancelledTasksCannotPublishAndFailuresKeepSearchUsable() async {
        let request = CardSearchPriceRequest()
        let started = expectation(description: "request started")
        var resume: CheckedContinuation<Void, Never>?
        let task = Task {
            await request.load(context: "session-a") {
                await withCheckedContinuation { resume = $0; started.fulfill() }
                return CardSearchMarketEstimate(price: 1, source: "old", cached: false)
            }
        }
        await fulfillment(of: [started], timeout: 2)
        request.cancel()
        task.cancel()
        resume?.resume()
        await task.value
        XCTAssertNil(request.value(for: "session-a"))
        await request.load(context: "offline") { throw URLError(.notConnectedToInternet) }
        XCTAssertNil(request.value(for: "offline"))
    }
}

private final class SearchPriceURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (status, body) = try Self.handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(body.utf8))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

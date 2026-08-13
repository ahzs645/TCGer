import Foundation
import XCTest
@testable import TCGer

final class TCGDexPocketCatalogTests: XCTestCase {
    override func tearDown() {
        PocketURLProtocol.handler = nil
        super.tearDown()
    }

    func testDecodesAndMapsPocketSeriesAndRichCardMetadata() throws {
        let series = try JSONDecoder().decode(
            TCGDexPocketSeries.self,
            from: Data(Self.seriesJSON.utf8)
        )
        let card = try JSONDecoder().decode(
            TCGDexPocketCard.self,
            from: Data(Self.cardJSON.utf8)
        )

        let snapshot = try TCGDexPocketCatalogAdapter.map(
            series: series,
            cardDetails: [card.id: card]
        )

        let mappedSet = try XCTUnwrap(snapshot.sets.first)
        XCTAssertEqual(mappedSet.code, "A1")
        XCTAssertEqual(mappedSet.pokemonFormat, .pocket)
        XCTAssertEqual(mappedSet.boosters?.map(\.name), ["Mewtwo"])
        XCTAssertEqual(mappedSet.logoUrl, "https://assets.tcgdex.net/en/tcgp/A1/logo.webp")

        let mappedCard = try XCTUnwrap(snapshot.cards.first)
        XCTAssertEqual(mappedCard.tcg, TCGGame.pokemon.rawValue)
        XCTAssertEqual(mappedCard.artist, "Narumi Sato")
        XCTAssertEqual(mappedCard.imageUrl, "https://assets.tcgdex.net/en/tcgp/A1/001/high.webp")
        XCTAssertEqual(mappedCard.imageUrlSmall, "https://assets.tcgdex.net/en/tcgp/A1/001/low.webp")
        XCTAssertEqual(mappedCard.pokemonPrint?.format, .pocket)
        XCTAssertEqual(mappedCard.pokemonPrint?.pocket?.hp, 70)
        XCTAssertEqual(mappedCard.pokemonPrint?.pocket?.effect, "Heal 10 damage.")
        XCTAssertEqual(mappedCard.pokemonPrint?.pocket?.abilities?.first?.name, "Growing Up")
        XCTAssertEqual(mappedCard.pokemonPrint?.pocket?.attacks?.first?.damage, "20+")
        XCTAssertEqual(mappedCard.pokemonPrint?.pocket?.boosters?.first?.id, "boo_A1-mewtwo")
    }

    func testEndpointConstructionRejectsUnsafeIdentifiers() throws {
        let endpoints = try TCGDexPocketEndpoints()
        XCTAssertEqual(
            try endpoints.card(id: "A1-001").absoluteString,
            "https://api.tcgdex.net/v2/en/cards/A1-001"
        )
        XCTAssertEqual(
            try endpoints.set(id: "A1a").absoluteString,
            "https://api.tcgdex.net/v2/en/sets/A1a"
        )
        XCTAssertThrowsError(try endpoints.card(id: "../cards/A1-001"))
        XCTAssertThrowsError(try TCGDexPocketEndpoints(baseURL: URL(string: "http://example.test")!))
    }

    func testClientValidatesHTTPStatusBeforeDecoding() async throws {
        PocketURLProtocol.handler = { request in
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 503,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )
            )
            return (response, Data(Self.seriesJSON.utf8))
        }

        do {
            _ = try await makeClient().fetchSeries()
            XCTFail("Expected HTTP status validation to fail")
        } catch TCGDexPocketClient.ClientError.httpStatus(let status) {
            XCTAssertEqual(status, 503)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testClientHonorsTaskCancellation() async throws {
        PocketURLProtocol.handler = { request in
            let response = try XCTUnwrap(
                HTTPURLResponse(
                    url: try XCTUnwrap(request.url),
                    statusCode: 200,
                    httpVersion: nil,
                    headerFields: ["Content-Type": "application/json"]
                )
            )
            return (response, Data(Self.seriesJSON.utf8))
        }
        let client = makeClient()
        let task = Task {
            try await Task.sleep(for: .seconds(1))
            return try await client.fetchSeries()
        }
        task.cancel()

        do {
            _ = try await task.value
            XCTFail("Expected cancellation")
        } catch is CancellationError {
            // Expected.
        } catch let error as URLError where error.code == .cancelled {
            // URLSession may surface cancellation as URLError instead.
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    func testImageURLRequiresHTTPSAndKnownQuality() {
        XCTAssertNil(TCGDexPocketCatalogAdapter.imageURL(base: "http://example.test/card", quality: "high"))
        XCTAssertNil(TCGDexPocketCatalogAdapter.imageURL(base: "https://example.test/card", quality: "original"))
        XCTAssertEqual(
            TCGDexPocketCatalogAdapter.imageURL(
                base: "https://example.test/card/high.png",
                quality: "low"
            ),
            "https://example.test/card/high.png"
        )
    }

    private func makeClient() -> TCGDexPocketClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PocketURLProtocol.self]
        return TCGDexPocketClient(session: URLSession(configuration: configuration))
    }

    private static let seriesJSON = #"""
    {
      "id": "tcgp",
      "name": "Pokémon TCG Pocket",
      "releaseDate": "2024-10-30",
      "sets": [{
        "cardCount": {"official": 226, "total": 286},
        "id": "A1",
        "logo": "https://assets.tcgdex.net/en/tcgp/A1/logo",
        "name": "Genetic Apex",
        "symbol": "https://assets.tcgdex.net/univ/tcgp/A1/symbol",
        "releaseDate": "2024-10-30",
        "serie": {"id": "tcgp", "name": "Pokémon TCG Pocket"},
        "boosters": [{"id": "boo_A1-mewtwo", "name": "Mewtwo"}],
        "cards": [{
          "id": "A1-001",
          "image": "https://assets.tcgdex.net/en/tcgp/A1/001",
          "localId": "001",
          "name": "Bulbasaur"
        }]
      }]
    }
    """#

    private static let cardJSON = #"""
    {
      "id": "A1-001",
      "category": "Pokémon",
      "illustrator": "Narumi Sato",
      "image": "https://assets.tcgdex.net/en/tcgp/A1/001",
      "localId": "001",
      "name": "Bulbasaur",
      "rarity": "One Diamond",
      "set": {
        "cardCount": {"official": 226, "total": 286},
        "id": "A1",
        "logo": "https://assets.tcgdex.net/en/tcgp/A1/logo",
        "name": "Genetic Apex",
        "symbol": "https://assets.tcgdex.net/univ/tcgp/A1/symbol"
      },
      "variants": {"firstEdition": false, "holo": false, "normal": true, "reverse": false, "wPromo": false},
      "effect": "Heal 10 damage.",
      "hp": 70,
      "types": ["Grass"],
      "description": "A seed was planted on its back at birth.",
      "stage": "Basic",
      "abilities": [{"type": "Ability", "name": "Growing Up", "effect": "Once during your turn..."}],
      "attacks": [{"cost": ["Grass"], "name": "Vine Whip", "effect": "Flip a coin.", "damage": "20+"}],
      "weaknesses": [{"type": "Fire", "value": "+20"}],
      "retreat": 1,
      "legal": {"standard": true, "expanded": false},
      "boosters": [{"id": "boo_A1-mewtwo", "name": "Mewtwo"}]
    }
    """#
}

private final class PocketURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.unknown))
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

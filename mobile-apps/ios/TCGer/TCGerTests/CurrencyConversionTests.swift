import Foundation
import XCTest
@testable import TCGer

final class CurrencyConversionTests: XCTestCase {
    override func tearDown() {
        CurrencyURLProtocolStub.handler = nil
        CurrencyDisplayState.shared.configure(currencyCode: "USD", rate: nil)
        super.tearDown()
    }

    func testCADRateUsesBankOfCanadaAndCachesResponse() async throws {
        let suiteName = "CurrencyConversionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CurrencyURLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        var requestCount = 0
        CurrencyURLProtocolStub.handler = { request in
            requestCount += 1
            let components = try XCTUnwrap(
                URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)
            )
            XCTAssertEqual(components.path, "/v2/rate/USD/CAD")
            XCTAssertEqual(
                components.queryItems?.first(where: { $0.name == "providers" })?.value,
                "BOC"
            )
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (
                response,
                Data(#"{"date":"2026-08-19","base":"USD","quote":"CAD","rate":1.3824}"#.utf8)
            )
        }

        let converter = CurrencyConverter(session: session, defaults: defaults)
        let first = try await converter.rate(from: "usd", to: "cad")
        let second = try await converter.rate(from: "USD", to: "CAD")

        XCTAssertEqual(first.exchangeRate.rate, Decimal(string: "1.3824"))
        XCTAssertEqual(first.providerName, "Bank of Canada via Frankfurter")
        XCTAssertEqual(second, first)
        XCTAssertEqual(requestCount, 1)
    }

    func testHistoricalRateUsesPurchaseDateAndCachesEachDaySeparately() async throws {
        let suiteName = "CurrencyConversionTests.\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suiteName))
        defaults.removePersistentDomain(forName: suiteName)
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CurrencyURLProtocolStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        var requestedDates: [String] = []
        CurrencyURLProtocolStub.handler = { request in
            let components = try XCTUnwrap(
                URLComponents(url: try XCTUnwrap(request.url), resolvingAgainstBaseURL: false)
            )
            let date = try XCTUnwrap(
                components.queryItems?.first(where: { $0.name == "date" })?.value
            )
            requestedDates.append(date)
            let rate = date == "2020-01-02" ? "1.2990" : "1.3410"
            let response = HTTPURLResponse(
                url: try XCTUnwrap(request.url),
                statusCode: 200,
                httpVersion: nil,
                headerFields: ["Content-Type": "application/json"]
            )!
            return (
                response,
                Data("{\"date\":\"\(date)\",\"base\":\"USD\",\"quote\":\"EUR\",\"rate\":\(rate)}".utf8)
            )
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = try XCTUnwrap(TimeZone(secondsFromGMT: 0))
        let firstDate = try XCTUnwrap(calendar.date(from: DateComponents(year: 2020, month: 1, day: 2)))
        let secondDate = try XCTUnwrap(calendar.date(from: DateComponents(year: 2021, month: 3, day: 4)))
        let converter = CurrencyConverter(session: session, defaults: defaults)

        let first = try await converter.rate(from: "USD", to: "EUR", on: firstDate)
        let cachedFirst = try await converter.rate(from: "USD", to: "EUR", on: firstDate)
        let second = try await converter.rate(from: "USD", to: "EUR", on: secondDate)

        XCTAssertEqual(first, cachedFirst)
        XCTAssertEqual(first.exchangeRate.rate, Decimal(string: "1.2990"))
        XCTAssertEqual(second.exchangeRate.rate, Decimal(string: "1.3410"))
        XCTAssertEqual(requestedDates, ["2020-01-02", "2021-03-04"])
    }

    func testCurrencyDisplayStateConvertsUSDUsingDecimalRate() throws {
        let rate = CachedExchangeRate(
            exchangeRate: ExchangeRate(
                date: "2026-08-19",
                base: "USD",
                quote: "CAD",
                rate: try XCTUnwrap(Decimal(string: "1.3824"))
            ),
            fetchedAt: Date(),
            providerName: "Bank of Canada via Frankfurter"
        )
        CurrencyDisplayState.shared.configure(currencyCode: "CAD", rate: rate)

        let converted = CurrencyDisplayState.shared.convertedAmount(100)

        XCTAssertEqual(converted.0, Decimal(string: "138.24"))
        XCTAssertEqual(converted.1, "CAD")
    }

    func testCurrencyDisplayStateKeepsSourceCurrencyWithoutMatchingRate() {
        CurrencyDisplayState.shared.configure(currencyCode: "EUR", rate: nil)

        let converted = CurrencyDisplayState.shared.convertedAmount(19.99)

        XCTAssertEqual(converted.0, Decimal(string: "19.99"))
        XCTAssertEqual(converted.1, "USD")
    }
}

private final class CurrencyURLProtocolStub: URLProtocol, @unchecked Sendable {
    static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
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

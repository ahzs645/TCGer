import Foundation

nonisolated struct ExchangeRate: Codable, Equatable, Sendable {
    let date: String
    let base: String
    let quote: String
    let rate: Decimal
}

nonisolated struct SupportedCurrency: Codable, Identifiable, Hashable, Sendable {
    let isoCode: String
    let name: String
    let symbol: String?

    var id: String { isoCode }

    private enum CodingKeys: String, CodingKey {
        case isoCode = "iso_code"
        case name
        case symbol
    }

    static let fallback: [SupportedCurrency] = [
        SupportedCurrency(isoCode: "USD", name: "United States Dollar", symbol: "$"),
        SupportedCurrency(isoCode: "CAD", name: "Canadian Dollar", symbol: "$"),
        SupportedCurrency(isoCode: "EUR", name: "Euro", symbol: "€"),
        SupportedCurrency(isoCode: "GBP", name: "British Pound", symbol: "£"),
        SupportedCurrency(isoCode: "AUD", name: "Australian Dollar", symbol: "$"),
        SupportedCurrency(isoCode: "JPY", name: "Japanese Yen", symbol: "¥"),
        SupportedCurrency(isoCode: "CHF", name: "Swiss Franc", symbol: "CHF")
    ]
}

nonisolated struct CachedExchangeRate: Codable, Equatable, Sendable {
    let exchangeRate: ExchangeRate
    let fetchedAt: Date
    let providerName: String

    func isFresh(at date: Date, lifetime: TimeInterval) -> Bool {
        date.timeIntervalSince(fetchedAt) < lifetime
    }
}

nonisolated enum CurrencyConversionError: LocalizedError {
    case invalidCurrencyCode
    case badServerResponse
    case missingRate

    var errorDescription: String? {
        switch self {
        case .invalidCurrencyCode:
            return "The selected currency code is not valid."
        case .badServerResponse:
            return "The exchange-rate service returned an unexpected response."
        case .missingRate:
            return "No exchange rate is available for this currency pair."
        }
    }
}

actor CurrencyConverter {
    static let shared = CurrencyConverter()

    private static let baseURL = URL(string: "https://api.frankfurter.dev/v2")!
    private static let cacheLifetime: TimeInterval = 12 * 60 * 60

    private let session: URLSession
    private let defaults: UserDefaults
    private var memoryCache: [String: CachedExchangeRate] = [:]

    init(session: URLSession = .shared, defaults: UserDefaults = .standard) {
        self.session = session
        self.defaults = defaults
    }

    func supportedCurrencies() async throws -> [SupportedCurrency] {
        let url = Self.baseURL.appending(path: "currencies")
        let (data, response) = try await session.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw CurrencyConversionError.badServerResponse
        }
        return try JSONDecoder().decode([SupportedCurrency].self, from: data)
            .sorted { $0.isoCode < $1.isoCode }
    }

    func rate(
        from source: String,
        to destination: String,
        on date: Date? = nil,
        force: Bool = false,
        now: Date = Date()
    ) async throws -> CachedExchangeRate {
        let source = source.uppercased()
        let destination = destination.uppercased()
        guard Self.isCurrencyCode(source), Self.isCurrencyCode(destination) else {
            throw CurrencyConversionError.invalidCurrencyCode
        }
        if source == destination {
            return CachedExchangeRate(
                exchangeRate: ExchangeRate(
                    date: Self.dateFormatter.string(from: now),
                    base: source,
                    quote: destination,
                    rate: 1
                ),
                fetchedAt: now,
                providerName: "No conversion needed"
            )
        }

        let key = Self.cacheKey(from: source, to: destination, on: date)
        let cached = memoryCache[key] ?? Self.loadCachedRate(forKey: key, from: defaults)
        if !force,
           let cached,
           date != nil || cached.isFresh(at: now, lifetime: Self.cacheLifetime) {
            memoryCache[key] = cached
            return cached
        }

        do {
            let fresh = try await fetchRate(from: source, to: destination, on: date, now: now)
            memoryCache[key] = fresh
            Self.saveCachedRate(fresh, forKey: key, to: defaults)
            return fresh
        } catch {
            if let cached {
                memoryCache[key] = cached
                return cached
            }
            throw error
        }
    }

    private func fetchRate(
        from source: String,
        to destination: String,
        on date: Date?,
        now: Date
    ) async throws -> CachedExchangeRate {
        let shouldUseBankOfCanada = destination == "CAD"
        do {
            return try await fetchRate(
                from: source,
                to: destination,
                provider: shouldUseBankOfCanada ? "BOC" : nil,
                providerName: shouldUseBankOfCanada
                    ? "Bank of Canada via Frankfurter"
                    : "Frankfurter central-bank blend",
                date: date,
                now: now
            )
        } catch where shouldUseBankOfCanada {
            return try await fetchRate(
                from: source,
                to: destination,
                provider: nil,
                providerName: "Frankfurter central-bank blend",
                date: date,
                now: now
            )
        }
    }

    private func fetchRate(
        from source: String,
        to destination: String,
        provider: String?,
        providerName: String,
        date: Date?,
        now: Date
    ) async throws -> CachedExchangeRate {
        var components = URLComponents(
            url: Self.baseURL
                .appending(path: "rate")
                .appending(path: source)
                .appending(path: destination),
            resolvingAgainstBaseURL: false
        )
        var queryItems: [URLQueryItem] = []
        if let provider { queryItems.append(URLQueryItem(name: "providers", value: provider)) }
        if let date {
            queryItems.append(URLQueryItem(name: "date", value: Self.dateFormatter.string(from: date)))
        }
        components?.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components?.url else {
            throw CurrencyConversionError.invalidCurrencyCode
        }
        let (data, response) = try await session.data(from: url)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw CurrencyConversionError.badServerResponse
        }
        let exchangeRate = try JSONDecoder().decode(ExchangeRate.self, from: data)
        guard exchangeRate.rate > 0 else {
            throw CurrencyConversionError.missingRate
        }
        return CachedExchangeRate(
            exchangeRate: exchangeRate,
            fetchedAt: now,
            providerName: providerName
        )
    }

    private static func isCurrencyCode(_ value: String) -> Bool {
        value.count == 3 && value.allSatisfy { $0.isASCII && $0.isLetter }
    }

    private static func cacheKey(from source: String, to destination: String, on date: Date? = nil) -> String {
        let day = date.map { ".\(dateFormatter.string(from: $0))" } ?? ""
        return "tcg.currency.rate.\(source).\(destination)\(day)"
    }

    static func loadCachedRate(
        from source: String,
        to destination: String,
        defaults: UserDefaults = .standard
    ) -> CachedExchangeRate? {
        loadCachedRate(forKey: cacheKey(from: source, to: destination), from: defaults)
    }

    private static func loadCachedRate(
        forKey key: String,
        from defaults: UserDefaults
    ) -> CachedExchangeRate? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(CachedExchangeRate.self, from: data)
    }

    private static func saveCachedRate(
        _ rate: CachedExchangeRate,
        forKey key: String,
        to defaults: UserDefaults
    ) {
        guard let data = try? JSONEncoder().encode(rate) else { return }
        defaults.set(data, forKey: key)
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

final class CurrencyDisplayState: @unchecked Sendable {
    static let shared = CurrencyDisplayState()
    static let currencyDefaultsKey = "tcg.currency.display"

    private let lock = NSLock()
    private var currencyCode = "USD"
    private var rate: CachedExchangeRate?

    private init() {}

    var currentCurrencyCode: String {
        lock.lock()
        defer { lock.unlock() }
        return currencyCode
    }

    func configure(currencyCode: String, rate: CachedExchangeRate?) {
        lock.lock()
        self.currencyCode = currencyCode.uppercased()
        self.rate = rate
        lock.unlock()
    }

    func convertedAmount(_ amount: Double, sourceCurrency: String = "USD") -> (Decimal, String) {
        lock.lock()
        let destination = currencyCode
        let snapshot = rate
        lock.unlock()

        let source = sourceCurrency.uppercased()
        let decimal = Decimal(string: String(amount), locale: Locale(identifier: "en_US_POSIX"))
            ?? Decimal(amount)
        guard source != destination else { return (decimal, destination) }
        guard source == "USD",
              snapshot?.exchangeRate.base.uppercased() == source,
              snapshot?.exchangeRate.quote.uppercased() == destination,
              let exchangeRate = snapshot?.exchangeRate.rate else {
            return (decimal, source)
        }
        return (decimal * exchangeRate, destination)
    }

    func formatted(_ amount: Double, sourceCurrency: String = "USD") -> String {
        let (converted, currency) = convertedAmount(amount, sourceCurrency: sourceCurrency)
        return converted.formatted(.currency(code: currency))
    }
}

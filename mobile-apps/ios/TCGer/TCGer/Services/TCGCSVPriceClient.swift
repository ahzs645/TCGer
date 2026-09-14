import Foundation
import CryptoKit

// Native HTTP is intentional: the browser CORS restriction does not apply here.
// This cache contains market references, never condition-specific or graded prices.
nonisolated struct TCGCSVLookup: Sendable {
    var name: String
    var setName: String?
    var setCode: String?
    var number: String?
    var productID: Int? = nil
    var finish: String? = nil
    var language: String? = nil
}
nonisolated struct TCGCSVQuote: Sendable {
    var price: Double
    var sourceAsOf: String
    var printing: String
    var backup: Bool
    var cached: Bool
    var sourceLabel: String { "TCGCSV market · \(printing) · \(sourceAsOf.prefix(10))\(backup ? " · backup" : "")" }
}
nonisolated struct TCGCSVGroup: Codable, Sendable {
    var groupId: Int
    var name: String
    var abbreviation: String?
    var categoryId: Int
}
nonisolated struct TCGCSVProduct: Codable, Sendable {
    struct Field: Codable, Sendable { var name: String; var value: String }
    var productId: Int
    var name: String
    var groupId: Int
    var categoryId: Int
    var extendedData: [Field]?
}
nonisolated struct TCGCSVPrice: Codable, Sendable {
    var productId: Int
    var subTypeName: String
    var marketPrice: Double?
}
nonisolated struct TCGCSVSet: Codable, Sendable {
    var groupId: Int
    var sourceAsOf: String
    var products: [TCGCSVProduct]
    var prices: [TCGCSVPrice]
}
nonisolated enum TCGCSVMatch {
    static func normalized(_ value: String?) -> String {
        (value ?? "").precomposedStringWithCanonicalMapping.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
    static func number(_ value: String?) -> String {
        let first = normalized(value).components(separatedBy: "/")[0]
        return String(first.drop(while: { $0 == "0" }))
    }
    static func group(_ lookup: TCGCSVLookup, in groups: [TCGCSVGroup]) -> Int? {
        let name = normalized(lookup.setName), code = normalized(lookup.setCode)
        let matches = groups.filter {
            let full = normalized($0.name)
            let short = normalized($0.name.components(separatedBy: ":").dropFirst().joined(separator: ":"))
            return $0.categoryId == 3 && ((!name.isEmpty && (name == full || name == short)) ||
                (!code.isEmpty && code == normalized($0.abbreviation)))
        }
        return matches.count == 1 ? matches[0].groupId : nil
    }
    static func quote(_ lookup: TCGCSVLookup, in set: TCGCSVSet, backup: Bool, cached: Bool) -> TCGCSVQuote? {
        guard ["", "en", "english"].contains(normalized(lookup.language)) else { return nil }
        let products = set.products.filter { product in
            guard product.categoryId == 3, product.groupId == set.groupId,
                  let cardNumber = product.extendedData?.first(where: { $0.name == "Number" })?.value,
                  !number(cardNumber).isEmpty else { return false } // Excludes sealed products.
            if let id = lookup.productID { return product.productId == id }
            return !number(lookup.number).isEmpty && number(cardNumber) == number(lookup.number) &&
                normalized(product.name) == normalized(lookup.name)
        }
        guard products.count == 1 else { return nil }
        var prices = set.prices.filter { $0.productId == products[0].productId }
        let finish = normalized(lookup.finish)
        let aliases = ["normal": "normal", "regular": "normal", "nonfoil": "normal", "non-foil": "normal", "nonholo": "normal", "non-holo": "normal",
                       "foil": "holofoil", "holo": "holofoil", "holofoil": "holofoil", "reverse": "reverse holofoil", "reverse-holo": "reverse holofoil", "reverse_holo": "reverse holofoil", "reverse holo": "reverse holofoil"]
        if finish.isEmpty {
            // Default reference is only safe when exactly one non-reverse printing exists.
            guard prices.allSatisfy({ ["normal", "holofoil", "reverse holofoil"].contains(normalized($0.subTypeName)) }) else { return nil }
            prices = prices.filter { normalized($0.subTypeName) != "reverse holofoil" }
        } else {
            let wanted = aliases[finish] ?? finish
            prices = prices.filter { normalized($0.subTypeName) == wanted }
        }
        guard prices.count == 1, let market = prices[0].marketPrice, market.isFinite, market >= 0 else { return nil }
        return TCGCSVQuote(price: market, sourceAsOf: set.sourceAsOf, printing: prices[0].subTypeName, backup: backup, cached: cached)
    }
}

actor TCGCSVPriceClient {
    static let shared = TCGCSVPriceClient(directory: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TCGCSVPrices"))
    typealias Transport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
    private struct Envelope<T: Codable & Sendable>: Codable, Sendable { var success: Bool; var results: [T] }
    private struct Asset: Codable, Sendable { var file: String; var sha256: String; var bytes: Int }
    private struct Backup: Codable, Sendable { var schema: String; var sourceAsOf: String; var groups: [TCGCSVGroup]; var sets: [String: Asset] }
    private struct SavedSet: Codable, Sendable { var data: TCGCSVSet; var backup: Bool; var checkedAt: Double }
    private struct State: Codable, Sendable {
        var groups: [TCGCSVGroup] = []
        var stamp = ""
        var checkedAt: Double = 0
        var blockedUntil: Double = 0
        var backup: Backup? = nil
        var backupCheckedAt: Double = 0
        var attempts: [String: Double] = [:]
        var backupAttempts: [String: Double] = [:]
        var sets: [String: SavedSet] = [:]
        var budgetStart: Double = 0
        var requests = 0
    }
    private let directory: URL
    private let transport: Transport
    private let now: @Sendable () -> Date
    private var state = State()
    private var loaded = false
    private var nextRequestAt: Double = 0
    private var inFlight: Task<Void, Never>?
    private let day = 86_400.0
    private let backupBase = "https://assets.tcger.ahmadjalil.com/prices/pokemon/"

    init(directory: URL, now: @escaping @Sendable () -> Date = { Date() }, transport: @escaping Transport = { request in
        let (stream, response) = try await URLSession.shared.bytes(for: request)
        guard response.expectedContentLength <= 8_000_000 else { throw URLError(.dataLengthExceedsMaximum) }
        var data = Data()
        for try await byte in stream {
            guard data.count < 8_000_000 else { throw URLError(.dataLengthExceedsMaximum) }
            data.append(byte)
        }
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        return (data, response)
    }) { self.directory = directory; self.now = now; self.transport = transport }

    private func load() {
        guard !loaded else { return }; loaded = true
        if let data = try? Data(contentsOf: directory.appendingPathComponent("cache.json")), data.count < 64_000_000,
           let saved = try? JSONDecoder().decode(State.self, from: data) { state = saved }
    }
    private func save() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(state) { try? data.write(to: directory.appendingPathComponent("cache.json"), options: .atomic) }
    }
    func cached(_ lookup: TCGCSVLookup) -> TCGCSVQuote? {
        load()
        guard let id = TCGCSVMatch.group(lookup, in: state.groups.isEmpty ? state.backup?.groups ?? [] : state.groups),
              let saved = state.sets[String(id)] else { return nil }
        return TCGCSVMatch.quote(lookup, in: saved.data, backup: saved.backup, cached: true)
    }
    func quote(_ lookup: TCGCSVLookup) async -> TCGCSVQuote? {
        load()
        // Serialize refreshes across all callers; waiters recheck the persisted daily guards.
        while let task = inFlight { await task.value }
        let task = Task {
            await self.refresh(lookup)
            self.inFlight = nil
        }
        inFlight = task
        await task.value
        return cached(lookup)
    }
    private func json<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T { try JSONDecoder().decode(type, from: data) }
    private func get(_ path: String, primary: Bool) async throws -> Data {
        let time = now().timeIntervalSince1970
        if primary && time < state.blockedUntil { throw URLError(.resourceUnavailable) }
        if time - state.budgetStart >= day { state.budgetStart = time; state.requests = 0 }
        guard state.requests < 1500 else { throw URLError(.resourceUnavailable) }
        let delay = nextRequestAt - time
        if delay > 0 { try await Task.sleep(for: .seconds(delay)) }
        nextRequestAt = now().timeIntervalSince1970 + 0.25
        state.requests += 1
        save()
        var request = URLRequest(url: URL(string: (primary ? "https://tcgcsv.com/" : backupBase) + path)!)
        request.timeoutInterval = 20
        request.setValue("TCGer/1.0 (iOS native price cache)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/json,text/plain;q=0.9", forHTTPHeaderField: "Accept")
        let (data, response) = try await transport(request)
        if primary && [429, 503].contains(response.statusCode) {
            let raw = response.value(forHTTPHeaderField: "Retry-After") ?? ""
            let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
            let retry = Double(raw) ?? formatter.date(from: raw)?.timeIntervalSince(now()) ?? 600
            state.blockedUntil = now().timeIntervalSince1970 + max(600, retry)
            save()
        }
        guard response.statusCode == 200, data.count <= 8_000_000 else { throw URLError(.badServerResponse) }
        return data
    }
    private func stampDate(_ value: String) -> Date? {
        let basic = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter(); fractional.formatOptions.insert(.withFractionalSeconds)
        return basic.date(from: value) ?? fractional.date(from: value)
    }
    private func validStamp(_ value: String) -> Bool {
        guard let date = stampDate(value) else { return false }
        return date <= now().addingTimeInterval(3600)
    }
    private func backupManifest() async throws -> Backup {
        if now().timeIntervalSince1970 - state.backupCheckedAt < day, let backup = state.backup { return backup }
        // Failed backup attempts are cooled down too.
        if now().timeIntervalSince1970 - state.backupCheckedAt < 600 { throw URLError(.resourceUnavailable) }
        state.backupCheckedAt = now().timeIntervalSince1970; save()
        let data = try await get("manifest.json", primary: false)
        let backup = try json(Backup.self, data)
        guard backup.schema == "tcger-pokemon-prices-backup-v1", validStamp(backup.sourceAsOf), backup.groups.count <= 1000 else { throw URLError(.cannotParseResponse) }
        state.backup = backup; save(); return backup
    }
    private func refresh(_ lookup: TCGCSVLookup) async {
        defer { save() }
        guard ["", "en", "english"].contains(TCGCSVMatch.normalized(lookup.language)) else { return }
        let time = now().timeIntervalSince1970
        do {
            if time - state.checkedAt >= day {
                let raw = try await get("last-updated.txt", primary: true)
                let stamp = String(decoding: raw, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
                guard validStamp(stamp) else { throw URLError(.cannotParseResponse) }
                if state.stamp != stamp || state.groups.isEmpty {
                    let data = try await get("tcgplayer/3/groups", primary: true)
                    let envelope = try json(Envelope<TCGCSVGroup>.self, data)
                    guard envelope.success, !envelope.results.isEmpty, envelope.results.count <= 1000 else { throw URLError(.cannotParseResponse) }
                    state.groups = envelope.results
                }
                state.stamp = stamp; state.checkedAt = time; save()
            }
            guard let id = TCGCSVMatch.group(lookup, in: state.groups) else { return }
            let key = String(id)
            if let saved = state.sets[key], !saved.backup, saved.data.sourceAsOf == state.stamp { return }
            if time - (state.attempts[key] ?? 0) < day { return }
            state.attempts[key] = time; save()
            let productData = try await get("tcgplayer/3/\(id)/products", primary: true)
            let priceData = try await get("tcgplayer/3/\(id)/prices", primary: true)
            let products = try json(Envelope<TCGCSVProduct>.self, productData)
            let prices = try json(Envelope<TCGCSVPrice>.self, priceData)
            guard products.success, prices.success else { throw URLError(.cannotParseResponse) }
            let set = TCGCSVSet(groupId: id, sourceAsOf: state.stamp, products: products.results, prices: prices.results)
            store(set, backup: false)
        } catch {
            if error is CancellationError { return }
            state.blockedUntil = max(state.blockedUntil, time + 600)
            do {
                let manifest = try await backupManifest()
                guard let id = TCGCSVMatch.group(lookup, in: manifest.groups), let asset = manifest.sets[String(id)] else { return }
                if let saved = state.sets[String(id)], (stampDate(saved.data.sourceAsOf) ?? .distantPast) >= (stampDate(manifest.sourceAsOf) ?? .distantPast) { return }
                if time - (state.backupAttempts[String(id)] ?? 0) < 600 { return }
                state.backupAttempts[String(id)] = time; save()
                guard asset.file == "objects/\(asset.sha256).json", asset.sha256.count == 64,
                      asset.sha256.allSatisfy({ "0123456789abcdef".contains($0) }), asset.bytes <= 8_000_000 else { return }
                let bytes = try await get(asset.file, primary: false)
                guard bytes.count == asset.bytes, SHA256.hash(data: bytes).map({ String(format: "%02x", $0) }).joined() == asset.sha256 else { return }
                let set = try json(TCGCSVSet.self, bytes)
                guard set.groupId == id, set.sourceAsOf == manifest.sourceAsOf else { return }
                store(set, backup: true)
            } catch { /* Keep the last verified set and its source date. */ }
        }
    }
    private func store(_ set: TCGCSVSet, backup: Bool) {
        if let saved = state.sets[String(set.groupId)],
           (stampDate(saved.data.sourceAsOf) ?? .distantPast) > (stampDate(set.sourceAsOf) ?? .distantPast) { return }
        state.sets[String(set.groupId)] = SavedSet(data: set, backup: backup, checkedAt: now().timeIntervalSince1970)
        // Bound disk use without evicting a whole collection during normal use.
        while state.sets.count > 256, let oldest = state.sets.min(by: { $0.value.checkedAt < $1.value.checkedAt })?.key { state.sets.removeValue(forKey: oldest) }
    }
}

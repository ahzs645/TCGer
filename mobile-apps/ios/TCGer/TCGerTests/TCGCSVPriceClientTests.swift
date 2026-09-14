import XCTest
import CryptoKit
@testable import TCGer

private actor TCGCSVFixture {
    var requests: [String] = []
    var responses: [String: (Int, Data, String?)] = [:]
    func set(_ path: String, _ body: String, code: Int = 200, retry: String? = nil) {
        responses[path] = (code, Data(body.utf8), retry)
    }
    func fetch(_ request: URLRequest) throws -> (Data, HTTPURLResponse) {
        let path = request.url!.host! + request.url!.path
        requests.append(path)
        XCTAssertNotNil(request.value(forHTTPHeaderField: "User-Agent"))
        guard let (code, data, retry) = responses[path] else { throw URLError(.notConnectedToInternet) }
        return (data, HTTPURLResponse(url: request.url!, statusCode: code, httpVersion: nil, headerFields: retry.map { ["Retry-After": $0] })!)
    }
    func count() -> Int { requests.count }
}

@MainActor final class TCGCSVPriceClientTests: XCTestCase {
    let lookup = TCGCSVLookup(name: "Lugia VSTAR", setName: "Silver Tempest", setCode: "swsh12", number: "139")
    let groups = #"[{"groupId":3170,"name":"SWSH12: Silver Tempest","abbreviation":"SWSH12","categoryId":3}]"#
    let products = #"[{"productId":451396,"name":"Lugia VSTAR","groupId":3170,"categoryId":3,"extendedData":[{"name":"Number","value":"139/195"}]}]"#
    let prices = #"[{"productId":451396,"subTypeName":"Holofoil","marketPrice":6.96}]"#
    let stamp = "2026-09-13T20:05:38.000Z"
    func setJSON(prices: String? = nil) -> String { "{\"groupId\":3170,\"sourceAsOf\":\"\(stamp)\",\"products\":\(products),\"prices\":\(prices ?? self.prices)}" }
    func directory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }
    private func client(_ directory: URL, _ fixture: TCGCSVFixture) -> TCGCSVPriceClient {
        TCGCSVPriceClient(directory: directory, now: { Date(timeIntervalSince1970: 1_789_430_400) }, transport: { try await fixture.fetch($0) })
    }
    private func configure(_ fixture: TCGCSVFixture) async {
        await fixture.set("tcgcsv.com/last-updated.txt", stamp)
        await fixture.set("tcgcsv.com/tcgplayer/3/groups", "{\"success\":true,\"results\":\(groups)}")
        await fixture.set("tcgcsv.com/tcgplayer/3/3170/products", "{\"success\":true,\"results\":\(products)}")
        await fixture.set("tcgcsv.com/tcgplayer/3/3170/prices", "{\"success\":true,\"results\":\(prices)}")
    }
    func testExactMatchingPreservesPrintingAndNullMarket() throws {
        let group = try JSONDecoder().decode([TCGCSVGroup].self, from: Data(groups.utf8))
        XCTAssertEqual(TCGCSVMatch.group(lookup, in: group), 3170)
        XCTAssertNil(TCGCSVMatch.group(lookup, in: group + group))
        let set = try JSONDecoder().decode(TCGCSVSet.self, from: Data(setJSON().utf8))
        XCTAssertEqual(TCGCSVMatch.quote(lookup, in: set, backup: false, cached: false)?.price, 6.96)
        var other = lookup; other.number = "138"
        XCTAssertNil(TCGCSVMatch.quote(other, in: set, backup: false, cached: false))
        other = lookup; other.finish = "reverse-holo"
        XCTAssertNil(TCGCSVMatch.quote(other, in: set, backup: false, cached: false))
        other = lookup; other.language = "Japanese"
        XCTAssertNil(TCGCSVMatch.quote(other, in: set, backup: false, cached: false))
        let editions = #"[{"productId":451396,"subTypeName":"1st Edition Holofoil","marketPrice":50},{"productId":451396,"subTypeName":"Unlimited Holofoil","marketPrice":5}]"#
        let ambiguous = try JSONDecoder().decode(TCGCSVSet.self, from: Data(setJSON(prices: editions).utf8))
        XCTAssertNil(TCGCSVMatch.quote(lookup, in: ambiguous, backup: false, cached: false))
        other = lookup; other.finish = "1st Edition Holofoil"
        XCTAssertEqual(TCGCSVMatch.quote(other, in: ambiguous, backup: false, cached: false)?.price, 50)
        let missing = try JSONDecoder().decode(TCGCSVSet.self, from: Data(setJSON(prices: #"[{"productId":451396,"subTypeName":"Holofoil","marketPrice":null,"lowPrice":3}]"#).utf8))
        XCTAssertNil(TCGCSVMatch.quote(lookup, in: missing, backup: false, cached: false))
    }
    func testDailyCachePersistsAcrossRelaunchAndCoalescesCalls() async {
        let fixture = TCGCSVFixture(); await configure(fixture)
        let dir = directory(); defer { try? FileManager.default.removeItem(at: dir) }
        let service = client(dir, fixture)
        let request = lookup
        async let first = service.quote(request)
        async let second = service.quote(request)
        let results = await [first, second]
        XCTAssertEqual(results.compactMap { $0?.price }, [6.96, 6.96])
        let count = await fixture.count(); XCTAssertEqual(count, 4)
        let restarted = client(dir, fixture)
        let cached = await restarted.cached(lookup)
        XCTAssertEqual(cached?.sourceAsOf, stamp)
        _ = await restarted.quote(lookup)
        let after = await fixture.count(); XCTAssertEqual(after, 4)
    }
    func testRateLimitUsesVerifiedBackupAndKeepsItOffline() async {
        let fixture = TCGCSVFixture()
        await fixture.set("tcgcsv.com/last-updated.txt", "", code: 429, retry: "3600")
        let shard = setJSON()
        let hash = SHA256.hash(data: Data(shard.utf8)).map { String(format: "%02x", $0) }.joined()
        let manifest = "{\"schema\":\"tcger-pokemon-prices-backup-v1\",\"sourceAsOf\":\"\(stamp)\",\"groups\":\(groups),\"sets\":{\"3170\":{\"file\":\"objects/\(hash).json\",\"sha256\":\"\(hash)\",\"bytes\":\(shard.utf8.count)}}}"
        await fixture.set("assets.tcger.ahmadjalil.com/prices/pokemon/manifest.json", manifest)
        await fixture.set("assets.tcger.ahmadjalil.com/prices/pokemon/objects/\(hash).json", shard)
        let dir = directory(); defer { try? FileManager.default.removeItem(at: dir) }
        let service = client(dir, fixture)
        let result = await service.quote(lookup)
        XCTAssertEqual(result?.price, 6.96); XCTAssertEqual(result?.backup, true)
        let offline = TCGCSVFixture()
        let restarted = client(dir, offline)
        let saved = await restarted.quote(lookup)
        XCTAssertEqual(saved?.sourceAsOf, stamp)
        let count = await offline.count(); XCTAssertEqual(count, 0)
    }
    func testBadBackupChecksumNeverReplacesCache() async {
        let fixture = TCGCSVFixture()
        let hash = String(repeating: "0", count: 64)
        let shard = setJSON()
        let manifest = "{\"schema\":\"tcger-pokemon-prices-backup-v1\",\"sourceAsOf\":\"\(stamp)\",\"groups\":\(groups),\"sets\":{\"3170\":{\"file\":\"objects/\(hash).json\",\"sha256\":\"\(hash)\",\"bytes\":\(shard.utf8.count)}}}"
        await fixture.set("assets.tcger.ahmadjalil.com/prices/pokemon/manifest.json", manifest)
        await fixture.set("assets.tcger.ahmadjalil.com/prices/pokemon/objects/\(hash).json", shard)
        let dir = directory(); defer { try? FileManager.default.removeItem(at: dir) }
        let service = client(dir, fixture)
        let result = await service.quote(lookup); XCTAssertNil(result)
        _ = await service.quote(lookup)
        let count = await fixture.count(); XCTAssertEqual(count, 3)
    }
}

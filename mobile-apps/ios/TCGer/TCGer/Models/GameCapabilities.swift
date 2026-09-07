import Foundation

nonisolated struct GameFinish: Codable, Hashable, Sendable {
    let code: String
    let label: String
    let foil: Bool
}
nonisolated struct GamePrintings: Codable, Hashable, Sendable {
    let version: Int
    let selection: String
    let finishes: [GameFinish]
}
nonisolated struct GameSymbol: Codable, Hashable, Sendable {
    let id: String
    let label: String
    let kind: String
    let imageUrl: String
}
nonisolated struct GameCardPresentation: Codable, Hashable, Sendable {
    var packageId: String?
    var printings: GamePrintings?
    var symbols: [GameSymbol]?
}
nonisolated extension Card {
    var gamePresentation: GameCardPresentation? {
        guard let value = attributes?["tcger"], let bytes = try? JSONEncoder().encode(value) else { return nil }
        return try? JSONDecoder().decode(GameCardPresentation.self, from: bytes)
    }
}
nonisolated struct GameDeckEligibility: Codable, Hashable, Sendable {
    let property: String
    let values: [JSONValue]
    func matches(_ card: [String: JSONValue]) -> Bool {
        let actual = property.split(separator: ".").reduce(JSONValue.object(card)) { value, key in
            if case .object(let object) = value { return object[String(key)] ?? .null }
            return .null
        }
        if case .array(let items) = actual { return items.contains(where: values.contains) }
        return values.contains(actual)
    }
}
nonisolated struct GameDeckZone: Codable, Hashable, Sendable, Identifiable {
    let id: String; let label: String; let min: Int; let max: Int
    let eligibility: [GameDeckEligibility]?
}
nonisolated struct GameDeckCopyException: Codable, Hashable, Sendable {
    let when: GameDeckEligibility; let maxCopies: Int
}
nonisolated struct GameDeckFormat: Codable, Hashable, Sendable, Identifiable {
    let id: String; let label: String; let zones: [GameDeckZone]; let defaultZone: String
    let maxCopies: Int?; let copyIdentity: String?; let copyLimitExceptions: [GameDeckCopyException]?
    let requireLegality: Bool?
}
nonisolated struct GameDeckRules: Codable, Hashable, Sendable {
    let version: Int; let defaultFormat: String; let formats: [GameDeckFormat]
    func validateContract() throws {
        func validId(_ value: String) -> Bool { value.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil }
        func validEligibility(_ rule: GameDeckEligibility) -> Bool {
            rule.property.range(of: "^(name|rarity|supertype|baseExternalId|printingKey|attributes\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)$", options: .regularExpression) != nil &&
            (1...200).contains(rule.values.count) && rule.values.allSatisfy { value in
                switch value { case .string, .number, .bool: true; default: false }
            }
        }
        for format in formats {
            guard validId(format.id), !format.label.isEmpty, format.label.count <= 100,
                  format.maxCopies.map({ (0...10000).contains($0) }) ?? true,
                  format.copyIdentity == nil || ["name", "baseExternalId"].contains(format.copyIdentity!),
                  (format.copyLimitExceptions?.count ?? 0) <= 32,
                  format.copyLimitExceptions?.allSatisfy({ validEligibility($0.when) && (0...10000).contains($0.maxCopies) }) ?? true else { throw GameCapabilityError.invalidContract }
            for zone in format.zones {
                guard validId(zone.id), !zone.label.isEmpty, zone.label.count <= 100,
                      (zone.eligibility?.count ?? 0) <= 16, zone.eligibility?.allSatisfy(validEligibility) ?? true else { throw GameCapabilityError.invalidContract }
            }
        }
        guard version == 1, !formats.isEmpty, formats.count <= 32,
              Set(formats.map(\.id)).count == formats.count, formats.contains(where: { $0.id == defaultFormat }),
              formats.allSatisfy({ format in
                  !format.zones.isEmpty && format.zones.count <= 16 && Set(format.zones.map(\.id)).count == format.zones.count &&
                  format.zones.contains(where: { $0.id == format.defaultZone }) &&
                  format.zones.allSatisfy { $0.min >= 0 && $0.max >= $0.min && $0.max <= 10000 }
              }) else { throw GameCapabilityError.invalidContract }
    }
}
nonisolated enum GameCapabilityError: Error { case invalidContract, catalogMismatch, unsupported }

nonisolated struct GamePriceQuote: Codable, Hashable, Sendable {
    let cardId: String; let printingKey: String?; let finishCode: String?; let condition: String?; let language: String?
    let amount: Double; let currency: String; let source: String; let sourceUrl: String?
    let observedAt: String; let expiresAt: String
}
nonisolated struct GamePriceSnapshot: Codable, Hashable, Sendable {
    let schema: String; let gameId: String; let quotes: [GamePriceQuote]
    func quote(cardId: String, currency: String, printingKey: String? = nil, finishCode: String? = nil, condition: String? = nil, language: String? = nil, now: Date = Date()) -> GamePriceQuote? {
        quotes.filter { quote in
            quote.cardId == cardId && quote.currency == currency && quote.printingKey == printingKey && quote.finishCode == finishCode && quote.condition == condition && quote.language == language &&
            gameCapabilityDate(quote.observedAt).map { $0 <= now } == true && gameCapabilityDate(quote.expiresAt).map { now < $0 } == true
        }.sorted { $0.observedAt > $1.observedAt }.first
    }
}
nonisolated func gameCapabilityDate(_ value: String) -> Date? {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withInternetDateTime]
    if let date = formatter.date(from: value) { return date }
    formatter.formatOptions = [.withFullDate]
    return formatter.date(from: value)
}
nonisolated struct GamePackPoolEntry: Codable, Hashable, Sendable { let cardId: String; let weight: Double }
nonisolated struct GamePackSlot: Codable, Hashable, Sendable { let count: Int; let pool: [GamePackPoolEntry]; let withoutReplacement: Bool? }
nonisolated struct GamePackDefinition: Codable, Hashable, Sendable, Identifiable {
    let id: String; let name: String; let setCode: String; let cardBackUrl: String?; let slots: [GamePackSlot]
    func open(random: () -> Double = { Double.random(in: 0..<1) }) throws -> [String] {
        var result: [String] = []
        for slot in slots {
            var pool = slot.pool
            guard slot.count > 0, slot.count <= 100, !pool.isEmpty, pool.allSatisfy({ $0.weight.isFinite && $0.weight > 0 }), slot.withoutReplacement != true || slot.count <= pool.count else { throw GameCapabilityError.invalidContract }
            for _ in 0..<slot.count {
                let sample = random()
                guard sample.isFinite, sample >= 0, sample < 1 else { throw GameCapabilityError.invalidContract }
                var remaining = sample * pool.reduce(0) { $0 + $1.weight }
                let index = pool.indices.first { index in remaining -= pool[index].weight; return remaining < 0 || index == pool.count - 1 }!
                result.append(pool[index].cardId)
                if slot.withoutReplacement == true { pool.remove(at: index) }
            }
        }
        return result
    }
}
nonisolated struct GamePackLibrary: Codable, Hashable, Sendable {
    let schema: String; let gameId: String; let packs: [GamePackDefinition]
}

nonisolated extension GamePriceSnapshot {
    func validateContract() throws {
        guard schema == "tcger-price-snapshot-v1", quotes.count <= 1_000_000, quotes.allSatisfy({ q in
            !q.cardId.isEmpty && q.amount.isFinite && q.amount >= 0 && q.currency.range(of: "^[A-Z]{3}$", options: .regularExpression) != nil && !q.source.isEmpty && q.source.count <= 100 &&
            gameCapabilityDate(q.observedAt).flatMap { start in gameCapabilityDate(q.expiresAt).map { start < $0 } } == true
        }) else { throw GameCapabilityError.invalidContract }
    }
}
nonisolated extension GamePackLibrary {
    func validateContract() throws {
        guard schema == "tcger-pack-library-v1", packs.count <= 10000, Set(packs.map(\.id)).count == packs.count else { throw GameCapabilityError.invalidContract }
        for pack in packs {
            guard !pack.name.isEmpty, pack.name.count <= 100, !pack.setCode.isEmpty, !pack.slots.isEmpty, pack.slots.count <= 32 else { throw GameCapabilityError.invalidContract }
            for slot in pack.slots {
                guard (1...100).contains(slot.count), !slot.pool.isEmpty, slot.pool.count <= 100000,
                      Set(slot.pool.map(\.cardId)).count == slot.pool.count,
                      slot.pool.allSatisfy({ !$0.cardId.isEmpty && $0.weight.isFinite && $0.weight > 0 && $0.weight <= 1_000_000 }),
                      slot.withoutReplacement != true || slot.count <= slot.pool.count else { throw GameCapabilityError.invalidContract }
            }
        }
    }
}
nonisolated struct GameLegalityPeriod: Codable, Hashable, Sendable {
    let format: String; let legal: Bool; let validFrom: String?; let validTo: String?
}
nonisolated func gameCardLegality(format: String, legality: [String: Bool], periods: [GameLegalityPeriod], sanctionedPlayLegal: Bool? = nil, now: Date = Date()) -> Bool? {
    if sanctionedPlayLegal == false { return false }
    let dated = periods.filter { $0.format == format }
    if dated.isEmpty { return legality[format] }
    return dated.filter { period in
        (period.validFrom == nil || period.validFrom.flatMap(gameCapabilityDate).map { $0 <= now } == true) &&
        (period.validTo == nil || period.validTo.flatMap(gameCapabilityDate).map { now < $0 } == true)
    }.sorted { ($0.validFrom.flatMap(gameCapabilityDate) ?? .distantPast) > ($1.validFrom.flatMap(gameCapabilityDate) ?? .distantPast) }.first?.legal
}

nonisolated extension GamePrintings {
    func validateContract() throws {
        guard version == 1, ["printing", "functional"].contains(selection), finishes.count <= 200,
              Set(finishes.map(\.code)).count == finishes.count,
              finishes.allSatisfy({ (1...80).contains($0.code.count) && (1...100).contains($0.label.count) }) else { throw GameCapabilityError.invalidContract }
    }
}
nonisolated extension GameSymbol {
    func validateContract() throws {
        guard (1...80).contains(id.count), (1...100).contains(label.count), ["rarity", "resource", "type"].contains(kind), imageUrl.count <= 2048,
              let url = URL(string: imageUrl), url.scheme == "https", url.host != nil else { throw GameCapabilityError.invalidContract }
    }
}

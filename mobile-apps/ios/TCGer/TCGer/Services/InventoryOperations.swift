// @tcger-feature {"id":"inventory.sales","platform":"ios","status":"implemented","modes":["local","server"]}
import CryptoKit
import Foundation

/// A frozen purchase/sale attempt survives a dropped response or relaunch. The
/// server and LocalStore commit the receipt with the inventory change, so replay
/// asks for that receipt instead of creating a second set of copies or a sale.
struct InventorySaleRequest: Codable, Sendable {
    let operationId: String
    let collectionId: String
    let copyIds: [String]
    let amount: Double
    let currency: String
    let removeFromInventory: Bool
    var platform: String? = nil
    var costBasis: Double? = nil
    var fees: Double? = nil
    var shippingCost: Double? = nil
    var acquiredAt: String? = nil
    var notes: String? = nil
    var date: String? = nil
}

struct InventorySaleReceipt: Codable, Equatable, Sendable {
    let operationId: String
    let transactionId: String
    let copyIds: [String]
    let removedCopyIds: [String]
    let amount: Double
    let currency: String
}

struct InventoryIntakeRow: Codable, Sendable {
    let rowId: String
    let card: Card
    let details: BinderCardAddDetails
}

struct InventoryIntakeDraft: Codable, Sendable {
    let operationId: String
    let collectionId: String
    let source: String
    let rows: [InventoryIntakeRow]
    var sealedInventoryId: String? = nil
    var openedQuantity: Int? = nil
    var openedAt: String? = nil
    var notes: String? = nil
}

struct InventoryIntakeReceipt: Codable, Equatable, Sendable {
    struct Row: Codable, Equatable, Sendable {
        let rowId: String
        let entryIds: [String]
    }
    let operationId: String
    let entryIds: [String]
    let rows: [Row]
    var openingId: String? = nil
}

enum PendingInventoryOperation: Codable, Identifiable, Sendable {
    case sale(InventorySaleRequest)
    case intake(InventoryIntakeDraft)

    var id: String {
        switch self {
        case .sale(let request): request.operationId
        case .intake(let draft): draft.operationId
        }
    }

    var title: String {
        switch self {
        case .sale(let request): "Sale · \(request.copyIds.count) copies · \(request.currency) \(request.amount)"
        case .intake(let draft): "\(draft.source == "physical-opening" ? "Physical opening" : "Scan intake") · \(draft.rows.count) rows"
        }
    }
}

@MainActor
final class InventoryOperationJournal {
    static let shared = InventoryOperationJournal()
    private let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("InventoryOperations", isDirectory: true)
    }

    /// Account IDs are confirmed by authentication. A credential digest is only
    /// the fallback for legacy servers without a stable user ID. No secret is
    /// written to the journal or its filename.
    static func scope(config: ServerConfiguration, userID: String?, token: String) -> String {
        if config.isOnDevice { return digest("local-device-inventory") }
        let identity = userID.map { "account:\($0)" } ?? "credential:\(digest(token))"
        // Share the cache's URL normalization, retaining this account's pending
        // operation when a default port, host case, or trailing slash changes.
        return CacheManager.CacheKey.collections(config: config, token: identity)
            ?? digest(config.baseURL + "|" + identity)
    }

    private static func digest(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    func pending(scope: String) throws -> [PendingInventoryOperation] {
        let url = directory.appendingPathComponent(scope + ".json")
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        // A corrupt recovery journal must be visible; treating it as empty
        // would silently allow a duplicate retry with a fresh operation ID.
        return try JSONDecoder().decode([PendingInventoryOperation].self, from: Data(contentsOf: url))
    }

    func save(_ operation: PendingInventoryOperation, scope: String) throws {
        var operations = try pending(scope: scope)
        if let existing = operations.first(where: { $0.id == operation.id }) {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            guard try encoder.encode(existing) == encoder.encode(operation) else {
                throw APIService.APIError.serverError(status: 409, message: "This saved attempt has different details. Resume the original attempt in Settings → Pending saves.")
            }
            return
        }
        operations.append(operation)
        try write(operations, scope: scope)
    }

    func complete(id: String, scope: String) throws {
        try write(pending(scope: scope).filter { $0.id != id }, scope: scope)
    }

    private func write(_ operations: [PendingInventoryOperation], scope: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(operations)
        try data.write(to: directory.appendingPathComponent(scope + ".json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
}

extension APIService {
    func deleteCopyFromBinder(config: ServerConfiguration, token: String, binderId: String, copyId: String) async throws {
        if config.isOnDevice {
            try localStore.deletePhysicalCopy(binderId: binderId, copyId: copyId)
        } else {
            let (data, response) = try await makeRequest(config: config, path: "collections/\(Self.pathSegment(binderId))/copies/\(Self.pathSegment(copyId))", method: "DELETE", token: token)
            guard response.statusCode == 204 || response.statusCode == 200 else {
                if response.statusCode == 401 { throw APIError.unauthorized }
                throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
            }
        }
        invalidateInventoryCache(config: config, token: token)
    }

    func recordInventorySale(config: ServerConfiguration, token: String, request: InventorySaleRequest) async throws -> InventorySaleReceipt {
        let receipt: InventorySaleReceipt
        if config.isOnDevice {
            receipt = try localStore.recordInventorySale(request)
        } else {
            let (data, response) = try await makeRequest(config: config, path: "finance/sales", method: "POST", token: token, body: request)
            guard response.statusCode == 200 || response.statusCode == 201 else {
                if response.statusCode == 401 { throw APIError.unauthorized }
                throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
            }
            receipt = try JSONDecoder().decode(InventorySaleReceipt.self, from: data)
        }
        let legacyIDs = request.copyIds.contains { $0.contains("#") }
        guard receipt.operationId == request.operationId,
              receipt.amount == request.amount, receipt.currency == request.currency,
              receipt.copyIds.count == request.copyIds.count,
              Set(receipt.copyIds).count == receipt.copyIds.count,
              legacyIDs || Set(receipt.copyIds) == Set(request.copyIds),
              Set(receipt.removedCopyIds) == (request.removeFromInventory ? Set(receipt.copyIds) : []) else { throw APIError.decodingError }
        invalidateInventoryCache(config: config, token: token)
        return receipt
    }

    func commitInventoryIntake(config: ServerConfiguration, token: String, draft: InventoryIntakeDraft) async throws -> InventoryIntakeReceipt {
        let receipt: InventoryIntakeReceipt
        if config.isOnDevice {
            receipt = try localStore.commitInventoryIntake(draft)
        } else {
            let (data, response) = try await makeRequest(config: config, path: "collections/\(Self.pathSegment(draft.collectionId))/intake", method: "POST", token: token, body: IntakeRequest(draft: draft))
            guard response.statusCode == 200 || response.statusCode == 201 else {
                if response.statusCode == 401 { throw APIError.unauthorized }
                throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
            }
            receipt = try JSONDecoder().decode(InventoryIntakeReceipt.self, from: data)
        }
        guard receipt.operationId == draft.operationId,
              Set(receipt.rows.map(\.rowId)) == Set(draft.rows.map(\.rowId)),
              receipt.entryIds.count == draft.rows.reduce(0, { $0 + $1.details.quantity }),
              Set(receipt.entryIds).count == receipt.entryIds.count,
              receipt.rows.count == draft.rows.count,
              Set(receipt.rows.flatMap(\.entryIds)) == Set(receipt.entryIds),
              draft.rows.allSatisfy({ expected in receipt.rows.first(where: { $0.rowId == expected.rowId })?.entryIds.count == expected.details.quantity }) else { throw APIError.decodingError }
        invalidateInventoryCache(config: config, token: token)
        return receipt
    }

    private func invalidateInventoryCache(config: ServerConfiguration, token: String) {
        if let key = CacheManager.CacheKey.collections(config: config, token: token) {
            try? collectionCache.remove(forKey: key)
        }
        // The caller publishes the collection-change notification only after
        // checking its captured session, so old accounts cannot refresh widgets.
    }

    private struct IntakeRequest: Encodable {
        let draft: InventoryIntakeDraft
        enum CodingKeys: String, CodingKey { case operationId, source, rows, sealedInventoryId, openedQuantity, openedAt, notes }
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(draft.operationId, forKey: .operationId)
            try container.encode(draft.source, forKey: .source)
            try container.encode(draft.rows.map(IntakeRequestRow.init), forKey: .rows)
            try container.encodeIfPresent(draft.sealedInventoryId, forKey: .sealedInventoryId)
            try container.encodeIfPresent(draft.openedQuantity, forKey: .openedQuantity)
            try container.encodeIfPresent(draft.openedAt, forKey: .openedAt)
            try container.encodeIfPresent(draft.notes, forKey: .notes)
        }
    }

    nonisolated private struct IntakeRequestRow: Encodable {
        let row: InventoryIntakeRow
        init(_ row: InventoryIntakeRow) { self.row = row }
        enum CodingKeys: String, CodingKey { case rowId }
        func encode(to encoder: Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(row.rowId, forKey: .rowId)
            try AddCardToBinderRequest(card: row.card, details: row.details).encode(to: encoder)
        }
    }
}

extension APIService.AddCardToBinderRequest {
    init(card: Card, details: BinderCardAddDetails) {
        self.init(
            cardId: card.id, quantity: details.quantity, condition: details.condition,
            language: details.language, notes: details.notes, price: card.price,
            acquisitionPrice: nil, isFoil: details.isFoil || details.variant.isFoil,
            finishCode: details.variant.finishCode, finishLabel: details.variant.finishLabel,
            edition: details.variant.edition, stamp: details.variant.stamp,
            isSealedPromo: details.variant.isSealedPromo, isOversized: details.variant.isOversized,
            isPeelOff: details.variant.isPeelOff, isSigned: details.isSigned, isAltered: details.isAltered,
            gradingCompany: details.gradingCompany, gradingScore: details.gradingScore,
            certNumber: details.certNumber, storageLocation: details.storageLocation,
            tags: details.tags, newTags: nil,
            cardData: CardData(
                name: card.name, tcg: card.tcg, externalId: card.id, baseExternalId: card.baseExternalId,
                printingKey: card.printingKey, artworkId: card.artworkId, printingKind: card.printingKind,
                sanctionedPlayLegal: card.sanctionedPlayLegal, originalPrintingKey: card.originalPrintingKey,
                setCode: card.setCode, setName: card.setName, rarity: card.rarity,
                imageUrl: card.imageUrl, imageUrlSmall: card.imageUrlSmall, collectorNumber: card.collectorNumber,
                releasedAt: card.releasedAt.map { ISO8601DateFormatter().string(from: $0) },
                setSymbolUrl: card.setSymbolUrl, setLogoUrl: card.setLogoUrl, regulationMark: card.regulationMark,
                language: card.language, supertype: card.supertype, formatLegality: card.formatLegality,
                dexEntries: card.dexEntries, region: card.region, pokemonPrint: card.pokemonPrint,
                attributes: card.attributes, provenance: card.provenance, legalityPeriods: card.legalityPeriods,
                evolution: card.evolution, functionalIdentity: card.functionalIdentity
            )
        )
    }
}

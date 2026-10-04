import Foundation

/// Portable format mapping and legacy decoding are independent of live state.
/// LocalStore owns validation/commit; this codec only prepares decoded values.
enum LocalStoreBackupCodec {
    private struct NativeBackup<Snapshot: Codable>: Codable {
        let format: String
        let schemaVersion: Int
        let exportedAt: Date
        let appVersion: String
        let payload: Snapshot
        let appPreferences: LocalDataAppPreferences?
        let binderPageImages: [String: Data]?
    }
    private struct RecoveryPointEnvelope: Decodable {
        let schemaVersion: Int
        let createdAt: Date
        let payload: Data
    }
    static let portableBackupFormat = "com.tcger.local-data-backup"
    static let portableBackupSchemaVersion = 1
    static func encodeShared(native: Data) throws -> Data {
        let root = try JSONSerialization.jsonObject(with: native) as! [String: Any]
        let payload = root["payload"] as! [String: Any]
        var sections = payload["portableSections"] as? [String: Any] ?? [:]
        var nativeRoot = root
        var nativePayload = payload; nativePayload.removeValue(forKey: "portableSections")
        nativeRoot["payload"] = nativePayload
        sections["ios"] = nativeRoot
        for key in ["transactions", "onlineCodes", "binderPages", "preferences"] { sections[key] = payload[key] }
        sections["binderPageImages"] = root["binderPageImages"]
        sections["smartFolders"] = (root["appPreferences"] as? [String: Any])?["smartFolders"]
        let binders = (payload["collections"] as? [[String: Any]] ?? []).filter { !($0["id"] as? String == "__library__" && ($0["cards"] as? [[String: Any]] ?? []).isEmpty) }.map { binder -> [String: Any] in
            var result = binder
            result["colorHex"] = binder["colorHex"] as? String ?? "315DA8"
            result["cards"] = (binder["cards"] as? [[String: Any]] ?? []).flatMap { card -> [[String: Any]] in
                var identity = card
                identity["id"] = card["externalId"] as? String ?? card["cardId"] as? String ?? card["id"]
                var copies = card["copies"] as? [[String: Any]] ?? []
                if copies.isEmpty {
                    copies = (0..<(card["quantity"] as? Int ?? 1)).map { index in
                        var copy = card; copy["id"] = "legacy-\(card["id"] as? String ?? "")-\(index)"; return copy
                    }
                }
                return copies.map { copy in
                    var result: [String: Any] = ["id": copy["id"]!, "card": identity, "quantity": 1, "details": copy]
                    for key in ["condition", "price", "acquisitionPrice"] { result[key] = copy[key] }
                    return result
                }
            }
            return result
        }
        let lists = (payload["wishlists"] as? [[String: Any]] ?? []).map { list -> [String: Any] in
            var result = list; result["colorHex"] = list["colorHex"] as? String ?? "315DA8"
            result["matchAnyPrinting"] = list["matchAnyPrinting"] as? Bool ?? false
            result["rules"] = list["rules"] as? [[String: Any]] ?? []
            result["cards"] = (list["cards"] as? [[String: Any]] ?? []).map { card -> [String: Any] in
                var identity = card; identity["id"] = card["externalId"]
                var item: [String: Any] = ["id": card["id"]!, "card": identity, "desiredQuantity": card["desiredQuantity"] as? Int ?? 1]
                item["notes"] = card["notes"]; return item
            }; return result
        }
        let sealed = (payload["sealedInventory"] as? [[String: Any]] ?? []).map { item -> [String: Any] in
            var result = item; let product = item["product"] as? [String: Any] ?? [:]
            result["productId"] = product["id"]; result["productName"] = product["name"]; return result
        }
        return try JSONSerialization.data(withJSONObject: ["format": "com.tcger.portable-backup", "formatVersion": 2, "exportedAt": root["exportedAt"]!, "binders": binders, "wishlists": lists, "sealedInventory": sealed, "sections": sections], options: [.prettyPrinted, .sortedKeys])
    }

    static func decodeShared<Snapshot: Codable>(_ document: [String: Any], as type: Snapshot.Type, sealedProducts: [SealedProduct]) throws -> (state: Snapshot, exportedAt: Date?, appPreferences: LocalDataAppPreferences?, binderPageImages: [String: Data]?) {
        guard let version = document["formatVersion"] as? Int, (1...2).contains(version),
              document["format"] == nil || document["format"] as? String == "com.tcger.portable-backup",
              let binders = document["binders"] as? [[String: Any]] else { throw LocalDataTransferError.invalidBackup }
        let now = ISO8601DateFormatter().string(from: Date())
        let sections = document["sections"] as? [String: Any] ?? [:]
        let ios = sections["ios"] as? [String: Any] ?? [:]
        var payload = ios["payload"] as? [String: Any] ?? [:]
        var allTags: [String: [String: Any]] = [:]
        var copyIDs = Set<String>()
        payload["collections"] = try binders.enumerated().map { binderIndex, binder -> [String: Any] in
            guard let name = binder["name"] as? String, !name.isEmpty, let cards = binder["cards"] as? [[String: Any]] else { throw LocalDataTransferError.invalidBackup }
            var result = binder
            let binderID = binder["id"] as? String ?? "portable-binder-\(binderIndex)-\(name)"
            result["id"] = binderID; result["createdAt"] = binder["createdAt"] ?? now; result["updatedAt"] = binder["updatedAt"] ?? now
            var groups: [String: [String: Any]] = [:]; var order: [String] = []
            for (index, owned) in cards.enumerated() {
                guard let card = owned["card"] as? [String: Any], let cardID = card["id"] as? String, !cardID.isEmpty,
                      let game = card["tcg"] as? String, !game.isEmpty, let quantity = owned["quantity"] as? Int, (1...10000).contains(quantity) else { throw LocalDataTransferError.invalidBackup }
                for key in ["price", "acquisitionPrice"] {
                    if let amount = owned[key] as? Double, !amount.isFinite || amount < 0 { throw LocalDataTransferError.invalidBackup }
                }
                let groupID = "\(game.lowercased()):\(cardID)"
                var group = groups[groupID] ?? card
                group["id"] = group["id"] as? String ?? "portable-card-\(index)"
                group["cardId"] = cardID; group["externalId"] = cardID
                var copies = group["copies"] as? [[String: Any]] ?? []
                if groups[groupID] == nil { copies = []; order.append(groupID) }
                for copyIndex in 0..<quantity {
                    var copy = owned["details"] as? [String: Any] ?? [:]
                    let baseID = owned["id"] as? String ?? "\(binderID)-copy-\(index)"
                    let copyID = copyIndex == 0 ? baseID : "\(baseID)-\(copyIndex)"
                    guard copyIDs.insert(copyID).inserted else { throw LocalDataTransferError.invalidBackup }
                    copy["id"] = copyID
                    for key in ["condition", "price", "acquisitionPrice"] { copy[key] = owned[key] }
                    copy["tags"] = (copy["tags"] as? [[String: Any]] ?? []).map { tag -> [String: Any] in
                        var tagged = tag; let label = tag["label"] as? String ?? "Tag"
                        let id = (tag["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "portable-tag-\(label)"
                        tagged["id"] = id; tagged["colorHex"] = tag["colorHex"] as? String ?? "315DA8"; allTags[id] = tagged; return tagged
                    }
                    copies.append(copy)
                }
                group["copies"] = copies; group["quantity"] = copies.count
                group["price"] = copies.first?["price"]; group["condition"] = copies.first?["condition"]
                groups[groupID] = group
            }
            result["cards"] = order.compactMap { groups[$0] }; return result
        }
        payload["tags"] = Array(allTags.values)
        payload["wishlists"] = try (document["wishlists"] as? [[String: Any]] ?? []).enumerated().map { index, list -> [String: Any] in
            guard let name = list["name"] as? String, !name.isEmpty else { throw LocalDataTransferError.invalidBackup }
            var result = list; let id = list["id"] as? String ?? "portable-wishlist-\(index)"
            result["id"] = id; result["createdAt"] = now; result["updatedAt"] = now
            result["rules"] = (list["rules"] as? [[String: Any]] ?? []).enumerated().map { i, rule -> [String: Any] in
                var result = rule; result["id"] = rule["id"] as? String ?? "\(id)-rule-\(i)"; result["createdAt"] = rule["createdAt"] as? String ?? now; result["updatedAt"] = now; return result
            }
            let cards = try (list["cards"] as? [[String: Any]] ?? []).enumerated().map { i, item -> [String: Any] in
                guard var card = item["card"] as? [String: Any], let externalID = card["id"] as? String else { throw LocalDataTransferError.invalidBackup }
                card["externalId"] = externalID; card["id"] = item["id"] as? String ?? "\(id)-card-\(i)"
                card["desiredQuantity"] = item["desiredQuantity"] as? Int ?? 1; card["notes"] = item["notes"]
                card["owned"] = false; card["ownedQuantity"] = 0; card["createdAt"] = now; return card
            }
            result["cards"] = cards; result["totalCards"] = cards.count; result["ownedCards"] = 0; result["completionPercent"] = 0; return result
        }
        payload["sealedInventory"] = try (document["sealedInventory"] as? [[String: Any]] ?? []).enumerated().map { index, item -> [String: Any] in
            var result = item
            if result["product"] == nil {
                guard let productID = item["productId"] as? String, let product = sealedProducts.first(where: { $0.id == productID }) else { throw LocalDataTransferError.invalidBackup }
                result["product"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(product))
            }
            result["id"] = item["id"] as? String ?? "portable-sealed-\(index)"; result["createdAt"] = now; return result
        }
        for key in ["transactions", "onlineCodes", "binderPages"] { payload[key] = sections[key] as? [[String: Any]] ?? payload[key] as? [[String: Any]] ?? [] }
        payload["preferences"] = sections["preferences"] ?? payload["preferences"]
        payload["portableSections"] = sections
        for key in ["nextBinderId", "nextCollectionCardId", "nextCopyId", "nextTagId", "nextWishlistId", "nextWishlistRuleId", "nextTransactionId", "nextOnlineCodeId"] { payload[key] = payload[key] as? Int ?? 1000000 }
        payload["sampleDataLoaded"] = false
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: value) { return date }
            formatter.formatOptions = [.withFullDate]
            if let date = formatter.date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid backup date")
        }
        if let folders = sections["smartFolders"] {
            _ = try decoder.decode([SmartFolder].self, from: JSONSerialization.data(withJSONObject: folders))
        }
        let state = try decoder.decode(Snapshot.self, from: JSONSerialization.data(withJSONObject: payload))
        let images = (sections["binderPageImages"] as? [String: String] ?? [:]).mapValues { Data(base64Encoded: $0) ?? Data() }
        let preferences = try (ios["appPreferences"] as? [String: Any]).map { try decoder.decode(LocalDataAppPreferences.self, from: JSONSerialization.data(withJSONObject: $0)) }
        return (state, (document["exportedAt"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }, preferences, images)
    }

    static func decodePortable<Snapshot: Codable>(
        _ data: Data, as type: Snapshot.Type, sealedProducts: [SealedProduct]
    ) throws -> (
        state: Snapshot,
        exportedAt: Date?,
        appPreferences: LocalDataAppPreferences?,
        binderPageImages: [String: Data]?
    ) {
        guard !data.isEmpty else { throw LocalDataTransferError.emptyBackup }
        if let document = try JSONSerialization.jsonObject(with: data) as? [String: Any],
           document["formatVersion"] != nil {
            return try decodeShared(document, as: type, sealedProducts: sealedProducts)
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let backup = try? decoder.decode(NativeBackup<Snapshot>.self, from: data) {
            guard backup.format == Self.portableBackupFormat else {
                throw LocalDataTransferError.invalidBackup
            }
            guard backup.schemaVersion == Self.portableBackupSchemaVersion else {
                throw LocalDataTransferError.unsupportedSchemaVersion(backup.schemaVersion)
            }
            return (
                backup.payload,
                backup.exportedAt,
                backup.appPreferences,
                backup.binderPageImages
            )
        }

        // A Recovery Point exported from Settings is also a complete backup.
        if let envelope = try? decoder.decode(RecoveryPointEnvelope.self, from: data) {
            guard envelope.schemaVersion == FileLocalStorePersistenceRepository.currentSchemaVersion else {
                throw LocalDataTransferError.unsupportedSchemaVersion(envelope.schemaVersion)
            }
            guard let state = try? JSONDecoder().decode(Snapshot.self, from: envelope.payload) else {
                throw LocalDataTransferError.invalidBackup
            }
            return (state, envelope.createdAt, nil, nil)
        }

        // Accept unwrapped snapshots from early development builds.
        if let state = try? JSONDecoder().decode(Snapshot.self, from: data) {
            return (state, nil, nil, nil)
        }
        throw LocalDataTransferError.invalidBackup
    }

}

import Foundation

extension CatalogStore {
    func card(from entry: CatalogEntry) -> Card {
        let set = set(for: entry)
        let fullImageURL = imageURL(for: entry, thumbnail: false)?.absoluteString
        let thumbnailURL = imageURL(for: entry, thumbnail: true)?.absoluteString
        var attributes: [String: JSONValue] = [:]

        switch entry.tcg {
        case .magic:
            if let type = entry.card.type { attributes["type_line"] = .string(type) }
            if let colors = entry.card.colors {
                attributes["colors"] = .array(colors.map(JSONValue.string))
            }
        case .yugioh:
            if let type = entry.card.type { attributes["type"] = .string(type) }
            if let race = entry.card.race { attributes["race"] = .string(race) }
            if let level = entry.card.level { attributes["level"] = .number(Double(level)) }
        case .pokemon, .all, .onepiece, .lorcana, .dragonball:
            break
        }

        return Card(
            id: entry.card.id,
            name: entry.card.name,
            tcg: entry.tcg.rawValue,
            setCode: entry.card.setCode,
            setName: set?.name,
            rarity: entry.card.rarity,
            imageUrl: fullImageURL,
            imageUrlSmall: thumbnailURL,
            price: nil,
            collectorNumber: entry.card.collectorNumber,
            releasedAt: nil,
            supertype: entry.tcg == .pokemon ? entry.card.type : nil,
            types: entry.tcg == .pokemon ? entry.card.types : nil,
            setSymbolUrl: set?.iconUrl,
            setLogoUrl: set?.logoUrl,
            attributes: attributes.isEmpty ? nil : attributes,
            printingKey: entry.tcg == .yugioh ? entry.card.id : nil,
            artworkId: entry.card.konamiId.map(String.init)
        )
    }

    func tcgSet(from set: CatalogSetEntry, tcg: TCGGame) -> TcgSet {
        TcgSet(
            code: set.code,
            name: set.name,
            tcg: tcg.rawValue,
            releaseDate: set.releasedAt,
            totalCards: set.count,
            standardCards: set.standardCount,
            iconUrl: set.iconUrl,
            iconFallbackUrl: set.iconFallbackUrl,
            logoUrl: set.logoUrl
        )
    }
}

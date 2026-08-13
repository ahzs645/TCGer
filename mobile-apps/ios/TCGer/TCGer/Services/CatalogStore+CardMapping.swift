import Foundation

extension CatalogStore {
    func card(from entry: CatalogEntry) -> Card {
        let set = set(for: entry)
        let fullImageURL = imageURL(for: entry, thumbnail: false)?.absoluteString
        let thumbnailURL = imageURL(for: entry, thumbnail: true)?.absoluteString
        var attributes: [String: JSONValue] = [:]

        if let displayCollectorNumber = displayCollectorNumber(for: entry),
           displayCollectorNumber != entry.card.collectorNumber {
            attributes["collector_number_display"] = .string(displayCollectorNumber)
        }
        if let artist = entry.card.artist {
            attributes["artist"] = .string(artist)
        }
        if let archetype = entry.card.archetype { attributes["archetype"] = .string(archetype) }
        if let classifications = entry.card.classifications {
            attributes["classifications"] = .array(classifications.map(JSONValue.string))
        }
        if let subtypes = entry.card.subtypes {
            attributes["subtypes"] = .array(subtypes.map(JSONValue.string))
        }
        if let variants = entry.card.variants {
            attributes["variants"] = .array(variants.map(JSONValue.string))
        }
        if let source = entry.card.source { attributes["source"] = .string(source) }
        if let character = entry.card.character { attributes["character"] = .string(character) }
        if let era = entry.card.era { attributes["era"] = .string(era) }
        if let specialTrait = entry.card.specialTrait {
            attributes["special_trait"] = .string(specialTrait)
        }
        if let treatments = entry.card.treatments {
            attributes["treatments"] = .array(treatments.map(JSONValue.string))
        }
        if let collectionTags = entry.card.collectionTags {
            attributes["collection_tags"] = .array(collectionTags.map(JSONValue.string))
        }

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

        let pokemonPrint: PokemonPrintMetadata? = {
            let isPocket = set?.serie?.lowercased() == "tcgp"
            guard entry.tcg == .pokemon,
                  isPocket || entry.card.pokemonPocket != nil || entry.card.pokemonWorldChampionship != nil else {
                return nil
            }
            return PokemonPrintMetadata(
                tcgdexId: entry.card.id,
                tcgdexImage: fullImageURL,
                variants: nil,
                finishes: entry.card.pokemonPocket == nil ? ["normal"] : nil,
                category: entry.card.type,
                regulationMark: nil,
                language: "EN",
                formatLegality: nil,
                dexEntries: nil,
                region: nil,
                worldChampionship: entry.card.pokemonWorldChampionship,
                format: isPocket ? .pocket : .tabletop,
                pocket: entry.card.pokemonPocket
            )
        }()

        return Card(
            id: entry.card.id,
            name: entry.card.name,
            tcg: entry.tcg.rawValue,
            setCode: entry.card.setCode,
            setName: set?.name,
            rarity: entry.card.rarity,
            artist: entry.card.artist,
            imageUrl: fullImageURL,
            imageUrlSmall: thumbnailURL,
            price: nil,
            collectorNumber: entry.card.collectorNumber,
            releasedAt: nil,
            supertype: entry.tcg == .pokemon ? entry.card.type : nil,
            types: entry.tcg == .pokemon ? entry.card.types : nil,
            setSymbolUrl: set?.iconUrl,
            setLogoUrl: set?.logoUrl,
            pokemonPrint: pokemonPrint,
            attributes: attributes.isEmpty ? nil : attributes,
            printingKey: entry.card.printingKey ?? (entry.tcg == .yugioh ? entry.card.id : nil),
            artworkId: entry.card.konamiId.map(String.init),
            printingKind: entry.card.printingKind,
            sanctionedPlayLegal: entry.card.sanctionedPlayLegal,
            originalPrintingKey: entry.card.originalPrintingKey
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
            logoUrl: set.logoUrl,
            setType: set.setType,
            releaseYear: set.releaseYear,
            series: set.serie,
            boosters: set.boosters
        )
    }
}

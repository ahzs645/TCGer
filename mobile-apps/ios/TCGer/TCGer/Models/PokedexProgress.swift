import Foundation

nonisolated struct PokedexSpeciesProgress: Identifiable, Hashable, Sendable {
    let entry: PokedexEntry
    let printCount: Int
    let ownedCopies: Int
    let imageURL: String?

    var id: Int { entry.number }
    var isOwned: Bool { ownedCopies > 0 }
}

nonisolated struct PokedexProgressSnapshot: Sendable {
    let species: [PokedexSpeciesProgress]
    let catalogEntriesByNumber: [Int: [CatalogEntry]]
}

nonisolated enum PokedexProgressBuilder {
    static func build(
        catalogCards: [Card],
        collections: [Collection]
    ) -> [PokedexSpeciesProgress] {
        var entriesByNumber = Dictionary(
            uniqueKeysWithValues: NationalPokedex.names.enumerated().map { offset, name in
                let number = offset + 1
                return (number, PokedexEntry(number: number, name: name))
            }
        )
        var printIDsByNumber: [Int: Set<String>] = [:]
        var imageByNumber: [Int: String] = [:]
        var ownedCopiesByNumber: [Int: Int] = [:]

        for card in catalogCards {
            for entry in NationalPokedex.species(for: card) {
                entriesByNumber[entry.number] = entry
                printIDsByNumber[entry.number, default: []].insert(card.id)
                if imageByNumber[entry.number] == nil,
                   let image = card.imageUrlSmall ?? card.imageUrl {
                    imageByNumber[entry.number] = image
                }
            }
        }

        for collection in collections {
            for card in collection.cards where card.quantity > 0 {
                for entry in NationalPokedex.species(for: card) {
                    entriesByNumber[entry.number] = entry
                    ownedCopiesByNumber[entry.number, default: 0] += card.quantity
                    if imageByNumber[entry.number] == nil,
                       let image = card.imageUrlSmall ?? card.imageUrl {
                        imageByNumber[entry.number] = image
                    }
                }
            }
        }

        return entriesByNumber.values.sorted().map { entry in
            PokedexSpeciesProgress(
                entry: entry,
                printCount: printIDsByNumber[entry.number]?.count ?? 0,
                ownedCopies: ownedCopiesByNumber[entry.number] ?? 0,
                imageURL: imageByNumber[entry.number]
            )
        }
    }

    static func build(
        catalogEntries: [CatalogEntry],
        pokemonSetSeriesByCode: [String: String],
        collections: [Collection]
    ) -> PokedexProgressSnapshot {
        var entriesByNumber = Dictionary(
            uniqueKeysWithValues: NationalPokedex.names.enumerated().map { offset, name in
                let number = offset + 1
                return (number, PokedexEntry(number: number, name: name))
            }
        )
        var catalogEntriesByNumber: [Int: [CatalogEntry]] = [:]
        var imageByNumber: [Int: String] = [:]
        var ownedCopiesByNumber: [Int: Int] = [:]

        for catalogEntry in catalogEntries {
            for entry in NationalPokedex.species(for: catalogEntry) {
                entriesByNumber[entry.number] = entry
                catalogEntriesByNumber[entry.number, default: []].append(catalogEntry)
                if imageByNumber[entry.number] == nil,
                   let image = imageURL(
                       for: catalogEntry,
                       pokemonSetSeriesByCode: pokemonSetSeriesByCode
                   ) {
                    imageByNumber[entry.number] = image
                }
            }
        }

        for collection in collections {
            for card in collection.cards where card.quantity > 0 {
                for entry in NationalPokedex.species(for: card) {
                    entriesByNumber[entry.number] = entry
                    ownedCopiesByNumber[entry.number, default: 0] += card.quantity
                    if imageByNumber[entry.number] == nil,
                       let image = card.imageUrlSmall ?? card.imageUrl {
                        imageByNumber[entry.number] = image
                    }
                }
            }
        }

        let species = entriesByNumber.values.sorted().map { entry in
            PokedexSpeciesProgress(
                entry: entry,
                printCount: catalogEntriesByNumber[entry.number]?.count ?? 0,
                ownedCopies: ownedCopiesByNumber[entry.number] ?? 0,
                imageURL: imageByNumber[entry.number]
            )
        }
        return PokedexProgressSnapshot(
            species: species,
            catalogEntriesByNumber: catalogEntriesByNumber
        )
    }

    private static func imageURL(
        for entry: CatalogEntry,
        pokemonSetSeriesByCode: [String: String]
    ) -> String? {
        if let storedURL = entry.card.imageUrlSmall ?? entry.card.imageUrl {
            return storedURL
        }
        guard let setCode = entry.card.setCode,
              let collectorNumber = entry.card.collectorNumber,
              let series = pokemonSetSeriesByCode[setCode] else {
            return nil
        }
        return "https://assets.tcgdex.net/en/\(path(series))/\(path(setCode))/\(path(collectorNumber))/low.webp"
    }

    private static func path(_ component: String) -> String {
        component.addingPercentEncoding(
            withAllowedCharacters: CharacterSet.alphanumerics.union(
                CharacterSet(charactersIn: "-._~")
            )
        ) ?? component
    }
}

nonisolated struct PokedexGeneration: Identifiable, Hashable, Sendable {
    let id: Int
    let name: String
    let range: ClosedRange<Int>

    static let all: [PokedexGeneration] = [
        .init(id: 1, name: "Kanto", range: 1...151),
        .init(id: 2, name: "Johto", range: 152...251),
        .init(id: 3, name: "Hoenn", range: 252...386),
        .init(id: 4, name: "Sinnoh", range: 387...493),
        .init(id: 5, name: "Unova", range: 494...649),
        .init(id: 6, name: "Kalos", range: 650...721),
        .init(id: 7, name: "Alola", range: 722...809),
        .init(id: 8, name: "Galar", range: 810...905),
        .init(id: 9, name: "Paldea", range: 906...1025)
    ]
}

import Foundation

nonisolated struct PokedexSpeciesProgress: Identifiable, Hashable, Sendable {
    let entry: PokedexEntry
    let printCount: Int
    let ownedCopies: Int

    var id: Int { entry.number }
    var isOwned: Bool { ownedCopies > 0 }
    var artworkURL: URL? { PokedexArtwork.url(for: entry.number) }
}

nonisolated enum PokedexArtwork {
    private static let baseURL =
        "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork"

    static func url(for number: Int) -> URL? {
        guard number > 0, number <= NationalPokedex.names.count else { return nil }
        return URL(string: "\(baseURL)/\(number).png")
    }
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
        var ownedCopiesByNumber: [Int: Int] = [:]

        for card in catalogCards {
            for entry in NationalPokedex.species(for: card) {
                entriesByNumber[entry.number] = entry
                printIDsByNumber[entry.number, default: []].insert(card.id)
            }
        }

        for collection in collections {
            for card in collection.cards where card.quantity > 0 {
                for entry in NationalPokedex.species(for: card) {
                    entriesByNumber[entry.number] = entry
                    ownedCopiesByNumber[entry.number, default: 0] += card.quantity
                }
            }
        }

        return entriesByNumber.values.sorted().map { entry in
            PokedexSpeciesProgress(
                entry: entry,
                printCount: printIDsByNumber[entry.number]?.count ?? 0,
                ownedCopies: ownedCopiesByNumber[entry.number] ?? 0
            )
        }
    }

    static func build(
        catalogEntries: [CatalogEntry],
        collections: [Collection]
    ) -> PokedexProgressSnapshot {
        var entriesByNumber = Dictionary(
            uniqueKeysWithValues: NationalPokedex.names.enumerated().map { offset, name in
                let number = offset + 1
                return (number, PokedexEntry(number: number, name: name))
            }
        )
        var catalogEntriesByNumber: [Int: [CatalogEntry]] = [:]
        var ownedCopiesByNumber: [Int: Int] = [:]

        for catalogEntry in catalogEntries {
            for entry in NationalPokedex.species(for: catalogEntry) {
                entriesByNumber[entry.number] = entry
                catalogEntriesByNumber[entry.number, default: []].append(catalogEntry)
            }
        }

        for collection in collections {
            for card in collection.cards where card.quantity > 0 {
                for entry in NationalPokedex.species(for: card) {
                    entriesByNumber[entry.number] = entry
                    ownedCopiesByNumber[entry.number, default: 0] += card.quantity
                }
            }
        }

        let species = entriesByNumber.values.sorted().map { entry in
            PokedexSpeciesProgress(
                entry: entry,
                printCount: catalogEntriesByNumber[entry.number]?.count ?? 0,
                ownedCopies: ownedCopiesByNumber[entry.number] ?? 0
            )
        }
        return PokedexProgressSnapshot(
            species: species,
            catalogEntriesByNumber: catalogEntriesByNumber
        )
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

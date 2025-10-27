struct StableCollectionCard: Identifiable, Codable {
    let id: String
    let cardId: String
    let externalId: String?
    let name: String
    let tcg: String
    let setCode: String?
    let setName: String?
    let rarity: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let quantity: Int
    let price: Double?
    let condition: String?
    let language: String?
    let notes: String?
    let collectorNumber: String?
    let copies: [StableCollectionCardCopy]

    func asModel() -> CollectionCard {
        CollectionCard(
            id: id,
            cardId: cardId,
            externalId: externalId,
            name: name,
            tcg: tcg,
            setCode: setCode,
            setName: setName,
            rarity: rarity,
            imageUrl: imageUrl,
            imageUrlSmall: imageUrlSmall,
            quantity: quantity,
            price: price,
            condition: condition,
            language: language,
            notes: notes,
            collectorNumber: collectorNumber,
            copies: copies.map { $0.asModel() }
        )
    }
}

struct StableCollectionCardCopy: Identifiable, Codable {
    let id: String
    let condition: String?
    let language: String?
    let notes: String?
    let price: Double?
    let acquisitionPrice: Double?
    let serialNumber: String?
    let acquiredAt: String?
    let tags: [StableCollectionCardTag]

    func asModel() -> CollectionCardCopy {
        CollectionCardCopy(
            id: id,
            condition: condition,
            language: language,
            notes: notes,
            price: price,
            acquisitionPrice: acquisitionPrice,
            serialNumber: serialNumber,
            acquiredAt: acquiredAt,
            tags: tags.map { $0.asModel() }
        )
    }
}

struct StableCollectionCardTag: Identifiable, Codable {
    let id: String
    let label: String
    let colorHex: String

    func asModel() -> CollectionCardTag {
        CollectionCardTag(id: id, label: label, colorHex: colorHex)
    }
}

struct StableCollection: Identifiable, Codable {
    let id: String
    let name: String
    let description: String?
    let cards: [StableCollectionCard]
    let createdAt: String
    let updatedAt: String
    let colorHex: String?

    func asModel() -> Collection {
        Collection(
            id: id,
            name: name,
            description: description,
            cards: cards.map { $0.asModel() },
            createdAt: createdAt,
            updatedAt: updatedAt,
            colorHex: colorHex
        )
    }
}

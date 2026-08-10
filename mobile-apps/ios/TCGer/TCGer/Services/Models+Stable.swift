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
    let releasedAt: String?
    let setSymbolUrl: String?
    let setLogoUrl: String?
    let regulationMark: String?
    let languageCode: String?
    let supertype: String?
    let formatLegality: PokemonFormatLegality?
    let dexEntries: [PokedexEntry]?
    let region: String?
    let pokemonPrint: PokemonPrintMetadata?
    let attributes: [String: JSONValue]?
    let provenance: JSONValue?
    let legalityPeriods: [JSONValue]?
    let evolution: JSONValue?
    let functionalIdentity: JSONValue?
    let baseExternalId: String?
    let printingKey: String?
    let artworkId: String?
    let printingKind: String?
    let sanctionedPlayLegal: Bool?
    let originalPrintingKey: String?

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
            copies: copies.map { $0.asModel() },
            releasedAt: releasedAt,
            setSymbolUrl: setSymbolUrl,
            setLogoUrl: setLogoUrl,
            regulationMark: regulationMark,
            languageCode: languageCode,
            supertype: supertype,
            formatLegality: formatLegality,
            dexEntries: dexEntries,
            region: region,
            pokemonPrint: pokemonPrint,
            attributes: attributes,
            provenance: provenance,
            legalityPeriods: legalityPeriods,
            evolution: evolution,
            functionalIdentity: functionalIdentity,
            baseExternalId: baseExternalId,
            printingKey: printingKey,
            artworkId: artworkId,
            printingKind: printingKind,
            sanctionedPlayLegal: sanctionedPlayLegal,
            originalPrintingKey: originalPrintingKey
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
    let isFoil: Bool?
    let finishCode: String?
    let finishLabel: String?
    let edition: String?
    let stamp: String?
    let isSealedPromo: Bool?
    let isOversized: Bool?
    let isPeelOff: Bool?
    let isSigned: Bool?
    let isAltered: Bool?
    let imageUrls: [String]?
    let tags: [StableCollectionCardTag]
    let gradingCompany: String?
    let gradingScore: String?
    let certNumber: String?
    let storageLocation: String?

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
            isFoil: isFoil,
            finishCode: finishCode,
            finishLabel: finishLabel,
            edition: edition,
            stamp: stamp,
            isSealedPromo: isSealedPromo,
            isOversized: isOversized,
            isPeelOff: isPeelOff,
            isSigned: isSigned,
            isAltered: isAltered,
            imageUrls: imageUrls,
            gradingCompany: gradingCompany,
            gradingScore: gradingScore,
            certNumber: certNumber,
            storageLocation: storageLocation,
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
    let defaultCondition: String?

    func asModel() -> Collection {
        Collection(
            id: id,
            name: name,
            description: description,
            cards: cards.map { $0.asModel() },
            createdAt: createdAt,
            updatedAt: updatedAt,
            colorHex: colorHex,
            defaultCondition: defaultCondition
        )
    }
}

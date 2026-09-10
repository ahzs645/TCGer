import XCTest
@testable import TCGer

@MainActor
final class LocalCollectionMutationTests: XCTestCase {
    private var root: URL!
    private var store: LocalStore!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        store = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root))
    }

    override func tearDownWithError() throws {
        store = nil
        if FileManager.default.fileExists(atPath: root.path) { try FileManager.default.removeItem(at: root) }
    }

    func testWishlistExclusionsPersistAndManualAddRestoresCard() throws {
        let list = store.createWishlist(name: "Darkrai", description: nil, colorHex: nil)
        let removed = try store.addCardToWishlist(wishlistId: list.id, card: card())
        store.removeCardFromWishlist(wishlistId: list.id, cardId: removed.id)
        let reloaded = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root))
        for _ in 0..<2 {
            let synced = try reloaded.addCardsToWishlist(wishlistId: list.id, cards: [card()])
            XCTAssertTrue(synced.cards.isEmpty)
            XCTAssertEqual(synced.excludedCardKeys, ["pokemon:001"])
        }
        _ = try reloaded.addCardToWishlist(wishlistId: list.id, card: card())
        let restored = try reloaded.addCardsToWishlist(wishlistId: list.id, cards: [card()])
        XCTAssertEqual(restored.cards.count, 1)
        XCTAssertEqual(restored.excludedCardKeys, [])
    }

    private func card(_ game: String = "pokemon", id: String = "001") -> Card {
        Card(id: id, name: "Card \(game)", tcg: game, setCode: "set", setName: "Set", rarity: "Rare",
             artist: "Artist", imageUrl: "https://example.test/card.png", imageUrlSmall: nil, price: 10,
             collectorNumber: "001", releasedAt: Date(timeIntervalSince1970: 1_700_000_000),
             supertype: "Pokemon", region: "Kanto", regulationMark: "H", language: "en",
             attributes: ["hp": .string("100")], provenance: .string("catalog"),
             functionalIdentity: .object(["key": .string("base")]), baseExternalId: "base",
             printingKey: "printing-\(id)", artworkId: "art", printingKind: "standard",
             sanctionedPlayLegal: true, originalPrintingKey: "original")
    }

    @discardableResult
    private func add(_ card: Card, to binder: String, tags: [String]? = nil) throws -> CollectionCard {
        try store.addCardToBinder(binderId: binder, cardId: card.id, quantity: 1, condition: "NM", language: nil,
            notes: nil, price: nil, acquisitionPrice: nil, isSigned: nil, isAltered: nil,
            tagIds: tags, newTags: nil, card: card)
        return try XCTUnwrap(store.getCollections().first { $0.id == binder }?.cards.first {
            $0.cardId == card.id && $0.tcg.caseInsensitiveCompare(card.tcg) == .orderedSame
        })
    }

    private func edit(_ id: String, in binder: String, tags: [String]? = nil, condition: String? = nil,
                      destination: String? = nil, print card: Card? = nil) throws -> CollectionCard {
        try store.updateCardInBinder(binderId: binder, collectionCardOrCopyId: id, quantity: nil,
            condition: condition, language: nil, notes: nil, acquisitionPrice: nil, acquiredAt: nil,
            variant: nil, isSigned: nil, isAltered: nil, gradingCompany: nil, gradingScore: nil,
            certNumber: nil, storageLocation: nil, includeOwnedCopyDetails: false,
            includeAcquisitionDetails: false, tagIds: tags, newTags: nil, newPrint: card, targetBinderId: destination)
    }

    func testMoveKeepsGamesSeparateAndMergesSameGameCopies() throws {
        let source = store.createCollection(name: "Source", description: nil, colorHex: nil)
        let target = store.createCollection(name: "Target", description: nil, colorHex: nil)
        let pokemon = try add(card(), to: source.id)
        let magic = try add(card("magic"), to: target.id)
        let moved = try edit(pokemon.copies[0].id, in: source.id, destination: target.id)
        XCTAssertEqual(moved.tcg, "pokemon")
        XCTAssertEqual(moved.copies.map(\.id), pokemon.copies.map(\.id))
        XCTAssertEqual(store.getCollections().first { $0.id == target.id }?.cards.count, 2)
        XCTAssertEqual(store.getCollections().first { $0.id == target.id }?.cards.first { $0.tcg == "magic" }, magic)
        let second = try add(card("POKEMON"), to: source.id)
        let merged = try edit(second.id, in: source.id, destination: target.id)
        XCTAssertEqual(merged.quantity, 2)
        XCTAssertEqual(Set(merged.copies.map(\.id)), Set(pokemon.copies.map(\.id) + second.copies.map(\.id)))
    }

    func testEmptyTagsClearOnlyAddressedCopyAndOmittedTagsRemain() throws {
        let binder = store.createCollection(name: "Tags", description: nil, colorHex: nil)
        let tag = store.createTag(label: "Keep", colorHex: nil)
        _ = try add(card(), to: binder.id, tags: [tag.id])
        let original = try add(card(), to: binder.id, tags: [tag.id])
        let cleared = try edit(original.copies[0].id, in: binder.id, tags: [])
        XCTAssertTrue(cleared.copies[0].tags.isEmpty)
        XCTAssertEqual(cleared.copies[1].tags.map(\.id), [tag.id])
        let changed = try edit(original.copies[1].id, in: binder.id, condition: "LP")
        XCTAssertEqual(changed.copies[1].tags.map(\.id), [tag.id])
        let allCleared = try edit(original.id, in: binder.id, tags: [])
        XCTAssertTrue(allCleared.copies.allSatisfy { $0.tags.isEmpty })
    }

    func testMetadataSurvivesAddEditMoveAndReload() throws {
        let binder = store.createCollection(name: "Metadata", description: nil, colorHex: nil)
        let target = store.createCollection(name: "Destination", description: nil, colorHex: nil)
        let original = try add(card(), to: binder.id)
        XCTAssertEqual(original.baseExternalId, "base")
        XCTAssertEqual(original.artist, "Artist")
        let added = try add(card(), to: binder.id)
        let edited = try edit(added.copies[0].id, in: binder.id, condition: "LP")
        let moved = try edit(edited.id, in: binder.id, destination: target.id)
        let reloaded = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root))
        let saved = try XCTUnwrap(reloaded.getCollections().first { $0.id == target.id }?.cards.first)
        func metadata(_ entry: CollectionCard) throws -> NSDictionary {
            var value = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(entry)) as? [String: Any])
            for key in ["id", "copies", "quantity", "condition", "language", "notes"] { value.removeValue(forKey: key) }
            return value as NSDictionary
        }
        for entry in [added, edited, moved, saved] { XCTAssertEqual(try metadata(entry), try metadata(original)) }
        let replaced = try edit(saved.id, in: target.id, print: card(id: "002"))
        XCTAssertEqual(replaced.printingKey, "printing-002")
        XCTAssertEqual(replaced.copies, saved.copies)
    }
}

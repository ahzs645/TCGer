import Foundation

final class APIService {
    enum APIError: Error, LocalizedError {
        case invalidURL
        case unauthorized
        case serverError(status: Int, message: String? = nil)
        case decodingError
        case networkError(Error)

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "The server address appears to be invalid."
            case .unauthorized:
                return "The server rejected your credentials."
            case .serverError(let status, let message):
                if let message, !message.isEmpty {
                    return "Server error (\(status)): \(message)"
                }
                return "Server responded with status code \(status)."
            case .decodingError:
                return "Unexpected response from the server."
            case .networkError(let error):
                return "Network error: \(error.localizedDescription)"
            }
        }
    }

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func makeRequest(
        config: ServerConfiguration,
        path: String,
        method: String = "GET",
        token: String? = nil,
        body: Encodable? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = config.endpoint(path: path) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")

        if let token {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        if let body {
            let encoder = JSONEncoder()
            request.httpBody = try encoder.encode(AnyEncodable(erasing: body))
        }

        return try await execute(request)
    }

    func execute(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError(status: -1, message: nil)
            }
            return (data, httpResponse)
        } catch {
            throw APIError.networkError(error)
        }
    }

    func parseServerMessage(from data: Data) -> String? {
        guard !data.isEmpty else { return nil }

        if let json = try? JSONSerialization.jsonObject(with: data, options: []),
           let dict = json as? [String: Any] {
            if let message = dict["message"] as? String, !message.isEmpty {
                return message
            }
            if let error = dict["error"] as? String, !error.isEmpty {
                return error
            }
        }

        let fallback = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return fallback?.isEmpty == false ? fallback : nil
    }
}

private struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init(erasing value: Encodable) {
        self.encodeClosure = { encoder in
            try value.encode(to: encoder)
        }
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}

@MainActor
final class DemoStore {
    static let shared = DemoStore()

    private enum Constants {
        static let userId = "demo-user-001"
        static let token = "demo-token-static"
        static let unsortedBinderId = "__library__"
    }

    private var user: User
    private var preferences: APIService.UserPreferences
    private var appSettings: AppSettings
    private var tags: [CollectionCardTag]
    private var collections: [Collection]
    private var searchCatalog: [Card]
    private var printGroups: [String: [Card]]
    private var nextBinderId: Int
    private var nextCollectionCardId: Int
    private var nextCopyId: Int
    private var nextTagId: Int

    private static let isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    init() {
        self.preferences = APIService.UserPreferences(
            showCardNumbers: true,
            showPricing: true,
            enabledYugioh: true,
            enabledMagic: true,
            enabledPokemon: true
        )
        self.user = User(
            id: Constants.userId,
            email: "demo@tcger.app",
            username: "Demo User",
            isAdmin: true,
            showCardNumbers: true,
            showPricing: true,
            enabledYugioh: true,
            enabledMagic: true,
            enabledPokemon: true
        )
        self.appSettings = AppSettings(
            id: 0,
            publicDashboard: true,
            publicCollections: true,
            requireAuth: false,
            appName: "TCGer Demo",
            updatedAt: DemoStore.isoFormatter.string(from: Date())
        )
        self.tags = [
            CollectionCardTag(id: "demo-tag-1", label: "For Trade", colorHex: "4caf50"),
            CollectionCardTag(id: "demo-tag-2", label: "PC", colorHex: "2196f3"),
            CollectionCardTag(id: "demo-tag-3", label: "Needs Grading", colorHex: "ff9800")
        ]
        self.collections = []
        self.searchCatalog = []
        self.printGroups = [:]
        self.nextBinderId = 3
        self.nextCollectionCardId = 100
        self.nextCopyId = 1000
        self.nextTagId = 4
        seedData()
    }

    func authenticate(email: String?, username: String? = nil) -> AuthResponse {
        if let email, !email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            user = User(
                id: user.id,
                email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                username: user.username,
                isAdmin: true,
                showCardNumbers: preferences.showCardNumbers,
                showPricing: preferences.showPricing,
                enabledYugioh: preferences.enabledYugioh,
                enabledMagic: preferences.enabledMagic,
                enabledPokemon: preferences.enabledPokemon
            )
        }
        if let username {
            let trimmed = username.trimmingCharacters(in: .whitespacesAndNewlines)
            user = User(
                id: user.id,
                email: user.email,
                username: trimmed.isEmpty ? user.username : trimmed,
                isAdmin: true,
                showCardNumbers: preferences.showCardNumbers,
                showPricing: preferences.showPricing,
                enabledYugioh: preferences.enabledYugioh,
                enabledMagic: preferences.enabledMagic,
                enabledPokemon: preferences.enabledPokemon
            )
        }
        return AuthResponse(user: user, token: Constants.token)
    }

    func checkSetupRequired() -> SetupCheckResponse {
        SetupCheckResponse(setupRequired: false)
    }

    func getSettings() -> AppSettings {
        appSettings
    }

    func updateSettings(
        publicDashboard: Bool?,
        publicCollections: Bool?,
        requireAuth: Bool?,
        appName: String?
    ) -> AppSettings {
        appSettings = AppSettings(
            id: appSettings.id,
            publicDashboard: publicDashboard ?? appSettings.publicDashboard,
            publicCollections: publicCollections ?? appSettings.publicCollections,
            requireAuth: requireAuth ?? appSettings.requireAuth,
            appName: appName ?? appSettings.appName,
            updatedAt: DemoStore.isoFormatter.string(from: Date())
        )
        return appSettings
    }

    func getUserPreferences() -> APIService.UserPreferences {
        preferences
    }

    func updateUserPreferences(
        showCardNumbers: Bool?,
        showPricing: Bool?,
        enabledYugioh: Bool?,
        enabledMagic: Bool?,
        enabledPokemon: Bool?
    ) -> APIService.UserPreferences {
        preferences = APIService.UserPreferences(
            showCardNumbers: showCardNumbers ?? preferences.showCardNumbers,
            showPricing: showPricing ?? preferences.showPricing,
            enabledYugioh: enabledYugioh ?? preferences.enabledYugioh,
            enabledMagic: enabledMagic ?? preferences.enabledMagic,
            enabledPokemon: enabledPokemon ?? preferences.enabledPokemon
        )
        user = User(
            id: user.id,
            email: user.email,
            username: user.username,
            isAdmin: user.isAdmin,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing,
            enabledYugioh: preferences.enabledYugioh,
            enabledMagic: preferences.enabledMagic,
            enabledPokemon: preferences.enabledPokemon
        )
        return preferences
    }

    func getUserProfile() -> APIService.UserProfile {
        APIService.UserProfile(
            id: user.id,
            email: user.email,
            username: user.username,
            isAdmin: user.isAdmin,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing,
            createdAt: DemoStore.isoFormatter.string(from: Date())
        )
    }

    func updateUserProfile(username: String?, email: String?) -> APIService.UpdatedProfile {
        let trimmedEmail = email?.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedUsername = username?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedEmail = (trimmedEmail?.isEmpty == false) ? (trimmedEmail ?? user.email) : user.email
        let resolvedUsername = (trimmedUsername?.isEmpty == false) ? trimmedUsername : user.username

        user = User(
            id: user.id,
            email: resolvedEmail,
            username: resolvedUsername,
            isAdmin: user.isAdmin,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing,
            enabledYugioh: preferences.enabledYugioh,
            enabledMagic: preferences.enabledMagic,
            enabledPokemon: preferences.enabledPokemon
        )

        return APIService.UpdatedProfile(
            id: user.id,
            email: user.email,
            username: user.username,
            isAdmin: user.isAdmin,
            showCardNumbers: preferences.showCardNumbers,
            showPricing: preferences.showPricing
        )
    }

    func changePassword(currentPassword _: String, newPassword _: String) {
        // No-op in demo mode.
    }

    func searchCards(query: String, game: TCGGame) -> CardSearchResponse {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !trimmed.isEmpty else {
            return CardSearchResponse(cards: [], total: 0)
        }

        let results = searchCatalog.filter { card in
            let gameMatches = game == .all || card.tcg.lowercased() == game.rawValue
            guard gameMatches else { return false }
            return card.name.lowercased().contains(trimmed)
                || (card.setName?.lowercased().contains(trimmed) ?? false)
                || (card.setCode?.lowercased().contains(trimmed) ?? false)
        }

        return CardSearchResponse(cards: results, total: results.count)
    }

    func getCardPrints(tcg: String, cardId: String) -> [Card] {
        if let grouped = printGroups[cardId] {
            return grouped
        }

        if let card = searchCatalog.first(where: { $0.id == cardId || $0.tcg == tcg && $0.id == cardId }) {
            return [card]
        }

        return []
    }

    func getCollections() -> [Collection] {
        collections
    }

    func getCollection(id: String) throws -> Collection {
        guard let collection = collections.first(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Collection not found")
        }
        return collection
    }

    func createCollection(name: String, description: String?, colorHex: String?) -> Collection {
        let now = DemoStore.isoFormatter.string(from: Date())
        let collection = Collection(
            id: "demo-binder-\(nextBinderId)",
            name: name,
            description: description,
            cards: [],
            createdAt: now,
            updatedAt: now,
            colorHex: colorHex ?? "4a90e2"
        )
        nextBinderId += 1
        collections.append(collection)
        return collection
    }

    func updateCollection(
        id: String,
        name: String?,
        description: String?,
        colorHex: String?
    ) throws -> Collection {
        guard let index = collections.firstIndex(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Collection not found")
        }
        let existing = collections[index]
        let updated = Collection(
            id: existing.id,
            name: name ?? existing.name,
            description: description ?? existing.description,
            cards: existing.cards,
            createdAt: existing.createdAt,
            updatedAt: DemoStore.isoFormatter.string(from: Date()),
            colorHex: colorHex ?? existing.colorHex
        )
        collections[index] = updated
        return updated
    }

    func deleteCollection(id: String) throws {
        guard id != Constants.unsortedBinderId else {
            throw APIService.APIError.serverError(status: 400, message: "Cannot delete library binder")
        }
        guard let index = collections.firstIndex(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "Collection not found")
        }
        collections.remove(at: index)
    }

    func getTags() -> [CollectionCardTag] {
        tags
    }

    func createTag(label: String, colorHex: String?) -> CollectionCardTag {
        let newTag = CollectionCardTag(
            id: "demo-tag-\(nextTagId)",
            label: label,
            colorHex: colorHex ?? "cccccc"
        )
        nextTagId += 1
        tags.append(newTag)
        return newTag
    }

    func addCardToBinder(
        binderId: String,
        cardId: String,
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?,
        price: Double?,
        acquisitionPrice: Double?,
        tagIds: [String]?,
        newTags: [APIService.TagPayload]?,
        card: Card?
    ) throws {
        let resolvedBinderId = binderId == Constants.unsortedBinderId ? Constants.unsortedBinderId : binderId
        guard let binderIndex = collections.firstIndex(where: { $0.id == resolvedBinderId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Binder not found")
        }

        let preparedNewTags = (newTags ?? []).map { payload in
            createTag(label: payload.label, colorHex: payload.colorHex)
        }
        let selectedTags = tags.filter { tagIds?.contains($0.id) == true } + preparedNewTags
        let resolvedCard = card ?? searchCatalog.first(where: { $0.id == cardId }) ?? placeholderCard(id: cardId)
        let qty = max(1, quantity)

        let binder = collections[binderIndex]
        var binderCards = binder.cards
        if let existingIndex = binderCards.firstIndex(where: { $0.cardId == resolvedCard.id }) {
            var existing = binderCards[existingIndex]
            let newCopies = makeCopies(
                quantity: qty,
                condition: condition ?? existing.condition,
                language: language ?? existing.language,
                notes: notes ?? existing.notes,
                price: price ?? existing.price,
                acquisitionPrice: acquisitionPrice,
                tags: selectedTags
            )
            let allCopies = existing.copies + newCopies
            existing = CollectionCard(
                id: existing.id,
                cardId: existing.cardId,
                externalId: existing.externalId,
                name: existing.name,
                tcg: existing.tcg,
                setCode: existing.setCode,
                setName: existing.setName,
                rarity: existing.rarity,
                imageUrl: existing.imageUrl,
                imageUrlSmall: existing.imageUrlSmall,
                quantity: allCopies.count,
                price: price ?? existing.price,
                condition: condition ?? existing.condition,
                language: language ?? existing.language,
                notes: notes ?? existing.notes,
                collectorNumber: existing.collectorNumber,
                copies: allCopies
            )
            binderCards[existingIndex] = existing
        } else {
            let newCard = CollectionCard(
                id: "demo-cc-\(nextCollectionCardId)",
                cardId: resolvedCard.id,
                externalId: resolvedCard.id,
                name: resolvedCard.name,
                tcg: resolvedCard.tcg,
                setCode: resolvedCard.setCode,
                setName: resolvedCard.setName,
                rarity: resolvedCard.rarity,
                imageUrl: resolvedCard.imageUrl,
                imageUrlSmall: resolvedCard.imageUrlSmall,
                quantity: qty,
                price: price ?? resolvedCard.price,
                condition: condition,
                language: language,
                notes: notes,
                collectorNumber: resolvedCard.collectorNumber,
                copies: makeCopies(
                    quantity: qty,
                    condition: condition,
                    language: language,
                    notes: notes,
                    price: price ?? resolvedCard.price,
                    acquisitionPrice: acquisitionPrice,
                    tags: selectedTags
                )
            )
            nextCollectionCardId += 1
            binderCards.append(newCard)
        }

        collections[binderIndex] = stampUpdatedAt(binder, cards: binderCards)
    }

    func updateCardInBinder(
        binderId: String,
        collectionCardOrCopyId: String,
        quantity: Int?,
        condition: String?,
        language: String?,
        notes: String?,
        tagIds: [String]?,
        newTags: [APIService.TagPayload]?,
        newPrint: Card?,
        targetBinderId: String?
    ) throws -> CollectionCard {
        guard let sourceBinderIndex = collections.firstIndex(where: { $0.id == binderId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Binder not found")
        }

        let sourceBinder = collections[sourceBinderIndex]
        var sourceCards = sourceBinder.cards
        guard let sourceCardIndex = sourceCards.firstIndex(where: {
            $0.id == collectionCardOrCopyId || $0.copies.contains(where: { $0.id == collectionCardOrCopyId })
        }) else {
            throw APIService.APIError.serverError(status: 404, message: "Card not found")
        }

        var sourceCard = sourceCards[sourceCardIndex]
        let targetCopyId = sourceCard.copies.contains(where: { $0.id == collectionCardOrCopyId }) ? collectionCardOrCopyId : nil

        if let destinationId = targetBinderId, destinationId != binderId {
            guard let destinationIndex = collections.firstIndex(where: { $0.id == destinationId }) else {
                throw APIService.APIError.serverError(status: 404, message: "Destination binder not found")
            }

            let destinationBinder = collections[destinationIndex]
            var destinationCards = destinationBinder.cards
            let movingCopies: [CollectionCardCopy]

            if let targetCopyId {
                movingCopies = sourceCard.copies.filter { $0.id == targetCopyId }
                sourceCard = replaceCard(sourceCard, copies: sourceCard.copies.filter { $0.id != targetCopyId })
            } else {
                movingCopies = sourceCard.copies
                sourceCard = replaceCard(sourceCard, copies: [])
            }

            sourceCards[sourceCardIndex] = sourceCard
            sourceCards.removeAll { $0.quantity <= 0 }

            if let destinationCardIndex = destinationCards.firstIndex(where: { $0.cardId == sourceCard.cardId }) {
                let existing = destinationCards[destinationCardIndex]
                let mergedCopies = existing.copies + movingCopies
                destinationCards[destinationCardIndex] = replaceCard(existing, copies: mergedCopies)
            } else {
                let movedCard = CollectionCard(
                    id: "demo-cc-\(nextCollectionCardId)",
                    cardId: sourceCard.cardId,
                    externalId: sourceCard.externalId,
                    name: sourceCard.name,
                    tcg: sourceCard.tcg,
                    setCode: sourceCard.setCode,
                    setName: sourceCard.setName,
                    rarity: sourceCard.rarity,
                    imageUrl: sourceCard.imageUrl,
                    imageUrlSmall: sourceCard.imageUrlSmall,
                    quantity: movingCopies.count,
                    price: sourceCard.price,
                    condition: sourceCard.condition,
                    language: sourceCard.language,
                    notes: sourceCard.notes,
                    collectorNumber: sourceCard.collectorNumber,
                    copies: movingCopies
                )
                nextCollectionCardId += 1
                destinationCards.append(movedCard)
            }

            collections[sourceBinderIndex] = stampUpdatedAt(sourceBinder, cards: sourceCards)
            collections[destinationIndex] = stampUpdatedAt(destinationBinder, cards: destinationCards)

            guard let updatedDestination = destinationCards.first(where: { $0.cardId == sourceCard.cardId }) else {
                throw APIService.APIError.serverError(status: 500, message: "Failed to move card")
            }
            return updatedDestination
        }

        let createdTags = (newTags ?? []).map { payload in
            createTag(label: payload.label, colorHex: payload.colorHex)
        }
        let selectedTags = tags.filter { tagIds?.contains($0.id) == true } + createdTags

        var updatedCopies = sourceCard.copies
        if let qty = quantity {
            let normalized = max(1, qty)
            if normalized > updatedCopies.count {
                let template = updatedCopies.last ?? makeCopies(
                    quantity: 1,
                    condition: sourceCard.condition,
                    language: sourceCard.language,
                    notes: sourceCard.notes,
                    price: sourceCard.price,
                    acquisitionPrice: nil,
                    tags: selectedTags
                ).first!
                let needed = normalized - updatedCopies.count
                for _ in 0..<needed {
                    updatedCopies.append(
                        CollectionCardCopy(
                            id: "demo-copy-\(nextCopyId)",
                            condition: template.condition,
                            language: template.language,
                            notes: template.notes,
                            price: template.price,
                            acquisitionPrice: template.acquisitionPrice,
                            serialNumber: template.serialNumber,
                            acquiredAt: template.acquiredAt,
                            tags: template.tags
                        )
                    )
                    nextCopyId += 1
                }
            } else if normalized < updatedCopies.count {
                updatedCopies = Array(updatedCopies.prefix(normalized))
            }
        }

        if condition != nil || language != nil || notes != nil || !selectedTags.isEmpty {
            updatedCopies = updatedCopies.map { copy in
                CollectionCardCopy(
                    id: copy.id,
                    condition: condition ?? copy.condition,
                    language: language ?? copy.language,
                    notes: notes ?? copy.notes,
                    price: copy.price,
                    acquisitionPrice: copy.acquisitionPrice,
                    serialNumber: copy.serialNumber,
                    acquiredAt: copy.acquiredAt,
                    tags: selectedTags.isEmpty ? copy.tags : selectedTags
                )
            }
        }

        var updatedCard = replaceCard(sourceCard, copies: updatedCopies)
        if let newPrint {
            updatedCard = CollectionCard(
                id: updatedCard.id,
                cardId: newPrint.id,
                externalId: newPrint.id,
                name: newPrint.name,
                tcg: newPrint.tcg,
                setCode: newPrint.setCode,
                setName: newPrint.setName,
                rarity: newPrint.rarity,
                imageUrl: newPrint.imageUrl,
                imageUrlSmall: newPrint.imageUrlSmall,
                quantity: updatedCard.quantity,
                price: newPrint.price ?? updatedCard.price,
                condition: updatedCard.condition,
                language: updatedCard.language,
                notes: updatedCard.notes,
                collectorNumber: newPrint.collectorNumber,
                copies: updatedCard.copies
            )
        }

        sourceCards[sourceCardIndex] = updatedCard
        collections[sourceBinderIndex] = stampUpdatedAt(sourceBinder, cards: sourceCards)
        return updatedCard
    }

    func deleteCardFromBinder(binderId: String, collectionCardOrCopyId: String) throws {
        guard let binderIndex = collections.firstIndex(where: { $0.id == binderId }) else {
            throw APIService.APIError.serverError(status: 404, message: "Binder not found")
        }

        let binder = collections[binderIndex]
        var binderCards = binder.cards
        guard let cardIndex = binderCards.firstIndex(where: {
            $0.id == collectionCardOrCopyId || $0.copies.contains(where: { $0.id == collectionCardOrCopyId })
        }) else {
            throw APIService.APIError.serverError(status: 404, message: "Card not found")
        }

        var card = binderCards[cardIndex]
        if card.id != collectionCardOrCopyId {
            card = replaceCard(card, copies: card.copies.filter { $0.id != collectionCardOrCopyId })
            if card.quantity > 0 {
                binderCards[cardIndex] = card
            } else {
                binderCards.remove(at: cardIndex)
            }
        } else {
            binderCards.remove(at: cardIndex)
        }

        collections[binderIndex] = stampUpdatedAt(binder, cards: binderCards)
    }

    private func seedData() {
        let pikaBase = Card(
            id: "demo-pokemon-pikachu-base",
            name: "Pikachu",
            tcg: "pokemon",
            setCode: "PR",
            setName: "Promo",
            rarity: "Rare",
            imageUrl: nil,
            imageUrlSmall: nil,
            price: 6.75,
            collectorNumber: "25",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Basic"],
            types: ["Lightning"]
        )
        let pikaSurging = Card(
            id: "demo-pokemon-pikachu-surging",
            name: "Pikachu",
            tcg: "pokemon",
            setCode: "SV",
            setName: "Surging Sparks",
            rarity: "Illustration Rare",
            imageUrl: nil,
            imageUrlSmall: nil,
            price: 19.25,
            collectorNumber: "188",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Basic"],
            types: ["Lightning"]
        )
        let charizard = Card(
            id: "demo-pokemon-charizard",
            name: "Charizard ex",
            tcg: "pokemon",
            setCode: "PAF",
            setName: "Paldean Fates",
            rarity: "Ultra Rare",
            imageUrl: nil,
            imageUrlSmall: nil,
            price: 33.40,
            collectorNumber: "54",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["Stage 2", "ex"],
            types: ["Fire"]
        )
        let boltM10 = Card(
            id: "demo-magic-lightning-bolt-m10",
            name: "Lightning Bolt",
            tcg: "magic",
            setCode: "M10",
            setName: "Magic 2010",
            rarity: "Common",
            imageUrl: nil,
            imageUrlSmall: nil,
            price: 2.10,
            collectorNumber: "146",
            releasedAt: nil
        )
        let bolt2xm = Card(
            id: "demo-magic-lightning-bolt-2xm",
            name: "Lightning Bolt",
            tcg: "magic",
            setCode: "2XM",
            setName: "Double Masters",
            rarity: "Uncommon",
            imageUrl: nil,
            imageUrlSmall: nil,
            price: 3.75,
            collectorNumber: "132",
            releasedAt: nil
        )
        let blackLotus = Card(
            id: "demo-magic-black-lotus",
            name: "Black Lotus",
            tcg: "magic",
            setCode: "LEA",
            setName: "Limited Edition Alpha",
            rarity: "Rare",
            imageUrl: nil,
            imageUrlSmall: nil,
            price: 25000,
            collectorNumber: "233",
            releasedAt: nil
        )
        let blueEyes = Card(
            id: "demo-ygo-blue-eyes",
            name: "Blue-Eyes White Dragon",
            tcg: "yugioh",
            setCode: "SDK",
            setName: "Starter Deck: Kaiba",
            rarity: "Ultra Rare",
            imageUrl: nil,
            imageUrlSmall: nil,
            price: 18.50,
            collectorNumber: nil,
            releasedAt: nil
        )

        searchCatalog = [
            pikaBase,
            pikaSurging,
            charizard,
            boltM10,
            bolt2xm,
            blackLotus,
            blueEyes
        ]
        printGroups = [
            pikaBase.id: [pikaBase, pikaSurging],
            pikaSurging.id: [pikaBase, pikaSurging],
            boltM10.id: [boltM10, bolt2xm],
            bolt2xm.id: [boltM10, bolt2xm]
        ]

        let now = DemoStore.isoFormatter.string(from: Date())
        let starterCards: [CollectionCard] = [
            CollectionCard(
                id: "demo-cc-1",
                cardId: charizard.id,
                externalId: charizard.id,
                name: charizard.name,
                tcg: charizard.tcg,
                setCode: charizard.setCode,
                setName: charizard.setName,
                rarity: charizard.rarity,
                imageUrl: nil,
                imageUrlSmall: nil,
                quantity: 1,
                price: charizard.price,
                condition: "Near Mint",
                language: "English",
                notes: "Pulled from pack",
                collectorNumber: charizard.collectorNumber,
                copies: makeCopies(
                    quantity: 1,
                    condition: "Near Mint",
                    language: "English",
                    notes: "Pulled from pack",
                    price: charizard.price,
                    acquisitionPrice: 8.99,
                    tags: [tags[1]]
                )
            ),
            CollectionCard(
                id: "demo-cc-2",
                cardId: boltM10.id,
                externalId: boltM10.id,
                name: boltM10.name,
                tcg: boltM10.tcg,
                setCode: boltM10.setCode,
                setName: boltM10.setName,
                rarity: boltM10.rarity,
                imageUrl: nil,
                imageUrlSmall: nil,
                quantity: 3,
                price: boltM10.price,
                condition: "Excellent",
                language: "English",
                notes: nil,
                collectorNumber: boltM10.collectorNumber,
                copies: makeCopies(
                    quantity: 3,
                    condition: "Excellent",
                    language: "English",
                    notes: nil,
                    price: boltM10.price,
                    acquisitionPrice: 1.25,
                    tags: [tags[0]]
                )
            )
        ]

        collections = [
            Collection(
                id: "demo-binder-1",
                name: "Favorites Binder",
                description: "Showcase cards and personal favorites",
                cards: starterCards,
                createdAt: now,
                updatedAt: now,
                colorHex: "7c4dff"
            ),
            Collection(
                id: "demo-binder-2",
                name: "Trade Binder",
                description: "Cards available for trade",
                cards: [
                    CollectionCard(
                        id: "demo-cc-3",
                        cardId: blueEyes.id,
                        externalId: blueEyes.id,
                        name: blueEyes.name,
                        tcg: blueEyes.tcg,
                        setCode: blueEyes.setCode,
                        setName: blueEyes.setName,
                        rarity: blueEyes.rarity,
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 1,
                        price: blueEyes.price,
                        condition: "Good",
                        language: "English",
                        notes: "Light edge wear",
                        collectorNumber: nil,
                        copies: makeCopies(
                            quantity: 1,
                            condition: "Good",
                            language: "English",
                            notes: "Light edge wear",
                            price: blueEyes.price,
                            acquisitionPrice: 4.50,
                            tags: [tags[0], tags[2]]
                        )
                    )
                ],
                createdAt: now,
                updatedAt: now,
                colorHex: "26a69a"
            ),
            Collection(
                id: Constants.unsortedBinderId,
                name: "Unsorted Library",
                description: "Cards not yet assigned to a binder",
                cards: [
                    CollectionCard(
                        id: "demo-cc-4",
                        cardId: pikaBase.id,
                        externalId: pikaBase.id,
                        name: pikaBase.name,
                        tcg: pikaBase.tcg,
                        setCode: pikaBase.setCode,
                        setName: pikaBase.setName,
                        rarity: pikaBase.rarity,
                        imageUrl: nil,
                        imageUrlSmall: nil,
                        quantity: 2,
                        price: pikaBase.price,
                        condition: "Near Mint",
                        language: "English",
                        notes: nil,
                        collectorNumber: pikaBase.collectorNumber,
                        copies: makeCopies(
                            quantity: 2,
                            condition: "Near Mint",
                            language: "English",
                            notes: nil,
                            price: pikaBase.price,
                            acquisitionPrice: 1.75,
                            tags: []
                        )
                    )
                ],
                createdAt: now,
                updatedAt: now,
                colorHex: "9e9e9e"
            )
        ]
    }

    private func makeCopies(
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?,
        price: Double?,
        acquisitionPrice: Double?,
        tags: [CollectionCardTag]
    ) -> [CollectionCardCopy] {
        let now = DemoStore.isoFormatter.string(from: Date())
        let count = max(1, quantity)
        var copies: [CollectionCardCopy] = []
        copies.reserveCapacity(count)
        for _ in 0..<count {
            copies.append(
                CollectionCardCopy(
                    id: "demo-copy-\(nextCopyId)",
                    condition: condition,
                    language: language,
                    notes: notes,
                    price: price,
                    acquisitionPrice: acquisitionPrice,
                    serialNumber: nil,
                    acquiredAt: now,
                    tags: tags
                )
            )
            nextCopyId += 1
        }
        return copies
    }

    private func stampUpdatedAt(_ collection: Collection, cards: [CollectionCard]? = nil) -> Collection {
        Collection(
            id: collection.id,
            name: collection.name,
            description: collection.description,
            cards: cards ?? collection.cards,
            createdAt: collection.createdAt,
            updatedAt: DemoStore.isoFormatter.string(from: Date()),
            colorHex: collection.colorHex
        )
    }

    private func replaceCard(_ card: CollectionCard, copies: [CollectionCardCopy]) -> CollectionCard {
        CollectionCard(
            id: card.id,
            cardId: card.cardId,
            externalId: card.externalId,
            name: card.name,
            tcg: card.tcg,
            setCode: card.setCode,
            setName: card.setName,
            rarity: card.rarity,
            imageUrl: card.imageUrl,
            imageUrlSmall: card.imageUrlSmall,
            quantity: copies.count,
            price: card.price,
            condition: copies.first?.condition ?? card.condition,
            language: copies.first?.language ?? card.language,
            notes: copies.first?.notes ?? card.notes,
            collectorNumber: card.collectorNumber,
            copies: copies
        )
    }

    private func placeholderCard(id: String) -> Card {
        Card(
            id: id,
            name: "Demo Card",
            tcg: "pokemon",
            setCode: "DEMO",
            setName: "Demo Set",
            rarity: "Common",
            imageUrl: nil,
            imageUrlSmall: nil,
            price: 1.0,
            collectorNumber: nil,
            releasedAt: nil
        )
    }
}

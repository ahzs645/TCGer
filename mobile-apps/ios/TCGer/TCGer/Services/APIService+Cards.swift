import Foundation

extension APIService {
    func searchCards(
        config: ServerConfiguration,
        token: String,
        query: String,
        game: TCGGame = .all
    ) async throws -> CardSearchResponse {
        if config.isOnDevice {
            await prepareLocalCatalog(for: game)
            let response = await LocalStore.shared.searchCardsAsync(query: query, game: game)
            return CardSearchResponse(
                cards: await applyingSelectedPricing(to: response.cards),
                total: response.total
            )
        }

        var queryItems = [URLQueryItem(name: "query", value: query)]
        if game != .all {
            queryItems.append(URLQueryItem(name: "tcg", value: game.rawValue))
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "cards/search",
            queryItems: queryItems,
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        let decoder = JSONDecoder.tcgCardDecoder
        guard let searchResponse = try? decoder.decode(CardSearchResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return CardSearchResponse(
            cards: await applyingSelectedPricing(to: searchResponse.cards),
            total: searchResponse.total
        )
    }

    /// Exhaustive name search — every printing matching a name, rather than
    /// the capped preview page `searchCards` returns. Used to expand wishlist
    /// rules such as "every Darkrai".
    func searchAllCards(
        config: ServerConfiguration,
        token: String,
        query: String,
        game: TCGGame = .all,
        includeAllPrintings: Bool = true,
        limit: Int = 500
    ) async throws -> [Card] {
        if config.isOnDevice {
            // The on-device catalog is already fully local, so its regular
            // search is exhaustive.
            await prepareLocalCatalog(for: game)
            let cards = await LocalStore.shared.searchCardsAsync(query: query, game: game).cards
            return await applyingSelectedPricing(to: cards)
        }

        var queryItems = [
            URLQueryItem(name: "query", value: query),
            URLQueryItem(name: "unique", value: includeAllPrintings ? "prints" : "cards"),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        if game != .all {
            queryItems.append(URLQueryItem(name: "tcg", value: game.rawValue))
        }

        let (data, response) = try await makeRequest(
            config: config,
            path: "cards/search/all",
            queryItems: queryItems,
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }

        let decoder = JSONDecoder.tcgCardDecoder
        guard let searchResponse = try? decoder.decode(CardSearchResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return await applyingSelectedPricing(to: searchResponse.cards)
    }

    /// Exact illustrator lookup used by curated collection guides such as the
    /// Yuka Morii clay collection.
    func searchCardsByArtist(
        config: ServerConfiguration,
        token: String,
        artist: String,
        game: TCGGame = .pokemon,
        limit: Int = 1000
    ) async throws -> [Card] {
        if config.isOnDevice {
            await prepareLocalCatalog(for: game)
            let cards = CatalogStore.shared.cards(byArtist: artist, tcg: game).prefix(limit).map {
                CatalogStore.shared.card(from: $0)
            }
            return await applyingSelectedPricing(to: cards)
        }

        let queryItems = [
            URLQueryItem(name: "artist", value: artist),
            URLQueryItem(name: "tcg", value: game.rawValue),
            URLQueryItem(name: "unique", value: "prints"),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        let (data, response) = try await makeRequest(
            config: config,
            path: "cards/search/artist",
            queryItems: queryItems,
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let searchResponse = try? JSONDecoder.tcgCardDecoder.decode(CardSearchResponse.self, from: data) else {
            throw APIError.decodingError
        }
        return await applyingSelectedPricing(to: searchResponse.cards)
    }

    func searchCardsByCollectionTag(
        config: ServerConfiguration,
        token: String,
        tag: String,
        game: TCGGame,
        limit: Int = 5000
    ) async throws -> [Card] {
        if config.isOnDevice {
            await prepareLocalCatalog(for: game)
            let cards = CatalogStore.shared.cards(tagged: tag, tcg: game).prefix(limit).map {
                CatalogStore.shared.card(from: $0)
            }
            return await applyingSelectedPricing(to: cards)
        }

        let queryItems = [
            URLQueryItem(name: "tag", value: tag),
            URLQueryItem(name: "tcg", value: game.rawValue),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        let (data, response) = try await makeRequest(
            config: config,
            path: "cards/search/tag",
            queryItems: queryItems,
            token: token
        )
        guard response.statusCode == 200 else {
            if response.statusCode == 401 { throw APIError.unauthorized }
            throw APIError.serverError(status: response.statusCode, message: parseServerMessage(from: data))
        }
        guard let searchResponse = try? JSONDecoder.tcgCardDecoder.decode(CardSearchResponse.self, from: data) else {
            throw APIError.decodingError
        }
        return await applyingSelectedPricing(to: searchResponse.cards)
    }

    func getCardPrints(
        config: ServerConfiguration,
        token: String,
        tcg: String,
        cardId: String
    ) async throws -> [Card] {
        if config.isOnDevice {
            if let game = TCGGame(rawValue: tcg) {
                await prepareLocalCatalog(for: game)
            }
            let cards = LocalStore.shared.getCardPrints(tcg: tcg, cardId: cardId)
            return await applyingSelectedPricing(to: cards)
        }

        let path = "cards/\(tcg)/\(cardId)/prints"

        let (data, response) = try await makeRequest(config: config, path: path, token: token)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        struct PrintsResponse: Decodable {
            let prints: [Card]
        }

        let decoder = JSONDecoder.tcgCardDecoder
        guard let printsResponse = try? decoder.decode(PrintsResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return await applyingSelectedPricing(to: printsResponse.prints)
    }

    /// Returns only World Championship replica printings for the same named
    /// Pokémon card. Ordinary reprints are intentionally excluded so this can
    /// be offered as an exceptional choice during Add Card.
    func getWorldChampionshipPrints(
        config: ServerConfiguration,
        token: String,
        card: Card
    ) async throws -> [Card] {
        guard card.tcg.lowercased() == TCGGame.pokemon.rawValue else { return [] }

        var candidates: [Card] = []
        var loadingError: Error?

        do {
            candidates = try await getCardPrints(
                config: config,
                token: token,
                tcg: card.tcg,
                cardId: card.id
            )
        } catch {
            loadingError = error
        }

        do {
            candidates.append(contentsOf: try await searchAllCards(
                config: config,
                token: token,
                query: card.name,
                game: .pokemon,
                includeAllPrintings: true,
                limit: 500
            ))
        } catch {
            loadingError = loadingError ?? error
        }

        let exactName = SearchTextNormalizer.key(card.name)
        var seenIDs: Set<String> = []
        let championshipPrints = candidates
            .filter {
                SearchTextNormalizer.key($0.name) == exactName
                    && $0.pokemonPrint?.worldChampionship != nil
                    && seenIDs.insert($0.id).inserted
            }
            .sorted {
                let left = $0.pokemonPrint?.worldChampionship
                let right = $1.pokemonPrint?.worldChampionship
                if left?.year != right?.year {
                    return (left?.year ?? 0) > (right?.year ?? 0)
                }
                return (left?.playerName ?? "")
                    .localizedCaseInsensitiveCompare(right?.playerName ?? "") == .orderedAscending
            }

        if championshipPrints.isEmpty, let loadingError {
            throw loadingError
        }
        return championshipPrints
    }

    // MARK: - Sets

    struct SetsResponse: Decodable {
        let sets: [TcgSet]
        let total: Int
        let failedProviders: [String]?
    }

    struct SetCatalogResult: Sendable {
        let sets: [TcgSet]
        let failedProviders: [String]
    }

    func getSets(
        config: ServerConfiguration,
        token: String,
        tcg: String? = nil
    ) async throws -> [TcgSet] {
        try await getSetsWithStatus(config: config, token: token, tcg: tcg).sets
    }

    func getSetsWithStatus(
        config: ServerConfiguration,
        token: String,
        tcg: String? = nil
    ) async throws -> SetCatalogResult {
        if config.isOnDevice {
            if let tcg, let game = TCGGame(rawValue: tcg) {
                if TCGGame.catalogGames.contains(game) {
                    await CatalogStore.shared.loadIfNeeded(game)
                }
            } else {
                await prepareLocalCatalog(for: .all)
            }
            return SetCatalogResult(
                sets: LocalStore.shared.getSets(tcg: tcg),
                failedProviders: []
            )
        }

        let queryItems = tcg.map { [URLQueryItem(name: "tcg", value: $0)] } ?? []
        let (data, response) = try await makeRequest(
            config: config,
            path: "cards/sets",
            queryItems: queryItems,
            token: token
        )

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        guard let setsResponse = try? JSONDecoder().decode(SetsResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return SetCatalogResult(
            sets: setsResponse.sets,
            failedProviders: setsResponse.failedProviders ?? []
        )
    }

    func getSetCards(
        config: ServerConfiguration,
        token: String,
        tcg: String,
        setCode: String
    ) async throws -> [Card] {
        if config.isOnDevice {
            if let game = TCGGame(rawValue: tcg),
               TCGGame.catalogGames.contains(game) {
                await CatalogStore.shared.loadIfNeeded(game)
            }
            let cards = LocalStore.shared.getSetCards(tcg: tcg, setCode: setCode)
            return await applyingSelectedPricing(to: cards)
        }

        let path = "cards/sets/\(tcg)/\(setCode)"

        let (data, response) = try await makeRequest(config: config, path: path, token: token)

        guard response.statusCode == 200 else {
            if response.statusCode == 401 {
                throw APIError.unauthorized
            }
            throw APIError.serverError(status: response.statusCode)
        }

        let decoder = JSONDecoder.tcgCardDecoder
        guard let cardsResponse = try? decoder.decode(CardSearchResponse.self, from: data) else {
            throw APIError.decodingError
        }

        return await applyingSelectedPricing(to: cardsResponse.cards)
    }
}

private extension APIService {
    func prepareLocalCatalog(for game: TCGGame) async {
        if game == .all {
            for catalogGame in TCGGame.catalogGames {
                await CatalogStore.shared.loadIfNeeded(catalogGame)
            }
        } else if TCGGame.catalogGames.contains(game) {
            await CatalogStore.shared.loadIfNeeded(game)
        }
    }
}

extension JSONDecoder {
    static var tcgCardDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let dateString = try container.decode(String.self)

            let iso8601Formatter = ISO8601DateFormatter()
            if let isoDate = iso8601Formatter.date(from: dateString) {
                return isoDate
            }

            let dateFormatter = DateFormatter()
            dateFormatter.dateFormat = "yyyy-MM-dd"
            dateFormatter.locale = Locale(identifier: "en_US_POSIX")
            dateFormatter.timeZone = TimeZone(secondsFromGMT: 0)

            if let date = dateFormatter.date(from: dateString) {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Cannot decode date string \(dateString)"
            )
        }
        return decoder
    }
}

import Foundation

/// Expands wishlist rules into cards and merges them back into the wishlist.
///
/// Expansion runs on the client so it behaves identically against a hosted
/// server, a Convex deployment, and phone-only mode: the backend only stores
/// rules, this service turns them into cards.
struct WishlistSyncService {
    struct SyncResult {
        var addedCards: Int = 0
        var matchedCards: Int = 0
        var errors: [String] = []
    }

    private let apiService: APIService
    private let config: ServerConfiguration
    private let token: String

    init(apiService: APIService = APIService(), config: ServerConfiguration, token: String) {
        self.apiService = apiService
        self.config = config
        self.token = token
    }

    /// Resolves a rule into the cards it currently matches.
    func expand(rule: WishlistRule) async throws -> [Card] {
        switch rule.type {
        case .set:
            guard let tcg = rule.tcg, let setCode = rule.setCode else { return [] }
            return try await apiService.getSetCards(
                config: config,
                token: token,
                tcg: tcg,
                setCode: setCode
            )
        case .name:
            guard let query = rule.query, !query.isEmpty else { return [] }
            let game = rule.tcg.flatMap(TCGGame.init(rawValue:)) ?? .all
            return try await apiService.searchAllCards(
                config: config,
                token: token,
                query: query,
                game: game,
                includeAllPrintings: rule.includeAllPrintings
            )
        }
    }

    /// Adds cards in server-sized batches, reporting progress as it goes.
    func addCards(
        _ cards: [Card],
        toWishlist wishlistId: String,
        onProgress: ((Int, Int) -> Void)? = nil
    ) async throws {
        let batchSize = APIService.wishlistCardBatchSize
        var sent = 0
        while sent < cards.count {
            let chunk = Array(cards[sent..<min(sent + batchSize, cards.count)])
            _ = try await apiService.addCardsToWishlist(
                config: config,
                token: token,
                wishlistId: wishlistId,
                cards: chunk
            )
            sent += chunk.count
            onProgress?(sent, cards.count)
        }
    }

    /// Expands a rule and adds whatever the wishlist does not already have.
    /// Returns the cards that were added.
    @discardableResult
    func apply(
        rule: WishlistRule,
        to wishlist: Wishlist,
        recordSync: Bool = true,
        onProgress: ((String) -> Void)? = nil
    ) async throws -> [Card] {
        onProgress?(
            rule.type == .set
                ? "Loading \(rule.setName ?? rule.setCode ?? "set")…"
                : "Searching for \"\(rule.query ?? "")\"…"
        )

        let matches = try await expand(rule: rule)
        let existing = Set(wishlist.cards.map { "\($0.tcg):\($0.externalId)" })
        let fresh = matches.filter { !existing.contains("\($0.tcg):\($0.id)") }

        if !fresh.isEmpty {
            try await addCards(fresh, toWishlist: wishlist.id) { sent, total in
                onProgress?("Adding \(sent) of \(total) cards…")
            }
        }

        if recordSync {
            // Bookkeeping only; a failure here should not fail the sync.
            _ = try? await apiService.updateWishlistRule(
                config: config,
                token: token,
                wishlistId: wishlist.id,
                ruleId: rule.id,
                lastSyncedAt: ISO8601DateFormatter().string(from: Date()),
                lastMatchCount: matches.count
            )
        }

        return fresh
    }

    /// Re-runs every rule on a wishlist. Syncing only ever adds, so manually
    /// added cards are never removed.
    func sync(wishlist: Wishlist, onProgress: ((String) -> Void)? = nil) async -> SyncResult {
        var result = SyncResult()
        var known = Set(wishlist.cards.map { "\($0.tcg):\($0.externalId)" })

        for rule in wishlist.expansionRules {
            do {
                onProgress?(
                    rule.type == .set
                        ? "Loading \(rule.setName ?? rule.setCode ?? "set")…"
                        : "Searching for \"\(rule.query ?? "")\"…"
                )
                let matches = try await expand(rule: rule)
                result.matchedCards += matches.count

                let fresh = matches.filter { !known.contains("\($0.tcg):\($0.id)") }
                if !fresh.isEmpty {
                    try await addCards(fresh, toWishlist: wishlist.id) { sent, total in
                        onProgress?("Adding \(sent) of \(total) cards…")
                    }
                    fresh.forEach { known.insert("\($0.tcg):\($0.id)") }
                    result.addedCards += fresh.count
                }

                _ = try? await apiService.updateWishlistRule(
                    config: config,
                    token: token,
                    wishlistId: wishlist.id,
                    ruleId: rule.id,
                    lastSyncedAt: ISO8601DateFormatter().string(from: Date()),
                    lastMatchCount: matches.count
                )
            } catch {
                result.errors.append(error.localizedDescription)
            }
        }

        return result
    }
}

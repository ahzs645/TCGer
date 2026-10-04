import Foundation

/// Recomputes wishlist ownership from the current collection without mutating stored records.
@MainActor
enum LocalWishlistProjection {
    static func ownershipMaps(_ collections: [Collection]) -> (exact: [String: Int], base: [String: Int]) {
        var exact: [String: Int] = [:]
        var base: [String: Int] = [:]
        for collection in collections {
            for card in collection.cards {
                let externalId = card.externalId ?? card.cardId
                exact["\(card.tcg):\(externalId)", default: 0] += card.quantity
                base["\(card.tcg):\(card.baseExternalId ?? externalId)", default: 0] += card.quantity
            }
        }
        return (exact, base)
    }

    static func ownedQuantity(
        for card: WishlistCard,
        matchAnyPrinting: Bool,
        maps: (exact: [String: Int], base: [String: Int])
    ) -> Int {
        if matchAnyPrinting {
            return maps.base["\(card.tcg):\(card.baseExternalId ?? card.externalId)"] ?? 0
        }
        return maps.exact["\(card.tcg):\(card.externalId)"] ?? 0
    }

    /// Rewrites a wishlist's cards and totals with live ownership; the stored
    /// flags only reflect what was true when each card was added.
    static func applyingOwnership(
        _ wishlist: Wishlist,
        maps: (exact: [String: Int], base: [String: Int])
    ) -> Wishlist {
        let cards = wishlist.cards.map { card -> WishlistCard in
            var updated = card
            let quantity = ownedQuantity(
                for: card,
                matchAnyPrinting: wishlist.matchesAnyPrinting,
                maps: maps
            )
            updated.owned = quantity > 0
            updated.ownedQuantity = quantity
            return updated
        }
        let ownedCount = cards.filter(\.owned).count
        return Wishlist(
            id: wishlist.id,
            name: wishlist.name,
            description: wishlist.description,
            colorHex: wishlist.colorHex,
            cards: cards,
            totalCards: cards.count,
            ownedCards: ownedCount,
            completionPercent: cards.isEmpty ? 0 : Int((Double(ownedCount) / Double(cards.count)) * 100),
            createdAt: wishlist.createdAt,
            updatedAt: wishlist.updatedAt,
            rules: wishlist.rules,
            matchAnyPrinting: wishlist.matchAnyPrinting,
            excludedCardKeys: wishlist.excludedCardKeys
        )
    }

}

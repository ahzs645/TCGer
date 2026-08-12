import SwiftUI

/// Shared card-search results UI: the grouped grid, the result cell, and the
/// placeholder/empty states. Every screen that renders card search results
/// (main search, add-to-binder search, binder-scan match correction) uses
/// these instead of maintaining its own fork.
struct CardSearchResultsList: View {
    let cards: [Card]
    let selectedGame: TCGGame
    let enabledGames: [TCGGame]
    let showPricing: Bool
    let showCardNumbers: Bool
    var showsGameSectionHeader = true
    var primaryActionTitle: String = "Add Card"
    var accessibilityHint = "Opens the add card form"
    let onCardTap: (Card) -> Void
    var onShowDetails: ((Card) -> Void)? = nil
    var onAddToWishlist: ((Card) -> Void)? = nil

    // Group cards by TCG
    private var groupedCards: [(String, [Card])] {
        if selectedGame != .all {
            return [(selectedGame.rawValue, cards)]
        }

        // Filter cards to only include enabled games
        let enabledGameRawValues = Set(enabledGames.map { $0.rawValue })
        let filteredCards = cards.filter { card in
            enabledGameRawValues.contains(card.tcg)
        }

        let groups = Dictionary(grouping: filteredCards, by: { $0.tcg })
        return groups.sorted {
            gameSectionIsOrderedBefore($0.key, $1.key, enabledGames: enabledGames)
        }
    }

    private var shouldShowGameSectionHeader: Bool {
        showsGameSectionHeader && enabledGames.count > 1
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 20, pinnedViews: [.sectionHeaders]) {
                ForEach(groupedCards, id: \.0) { tcg, tcgCards in
                    if shouldShowGameSectionHeader {
                        Section {
                            cardsGrid(tcgCards)
                        } header: {
                            CardSearchGameSectionHeader(
                                tcg: tcg,
                                displayName: tcgCards.first?.tcgDisplayName ?? tcg.uppercased(),
                                cardCount: tcgCards.count
                            )
                        }
                    } else {
                        cardsGrid(tcgCards)
                    }
                }
            }
            .padding()
        }
    }

    private func cardsGrid(_ cards: [Card]) -> some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible())
        ], spacing: 16) {
            ForEach(cards) { card in
                Button {
                    onCardTap(card)
                } label: {
                    CardSearchResultCell(
                        card: card,
                        showPricing: showPricing,
                        showCardNumbers: showCardNumbers
                    )
                }
                .buttonStyle(.plain)
                .accessibilityHint(accessibilityHint)
                .cardPreviewContextMenu(
                    card: card,
                    primaryActionTitle: primaryActionTitle,
                    onSelect: { onCardTap(card) },
                    onShowDetails: onShowDetails.map { handler in { handler(card) } },
                    onAddToWishlist: onAddToWishlist.map { handler in { handler(card) } }
                )
            }
        }
    }
}

private struct CardSearchGameSectionHeader: View {
    let tcg: String
    let displayName: String
    let cardCount: Int

    private var game: TCGGame? {
        TCGGame(rawValue: tcg.lowercased())
    }

    var body: some View {
        HStack(spacing: 8) {
            if let game {
                TCGGameIcon(game: game, size: 13)
                    .foregroundStyle(game.brandColor)
            }

            Text(displayName)
                .font(.subheadline.weight(.semibold))

            Divider()
                .frame(height: 14)

            Text("\(cardCount) cards")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 12)
        .frame(height: 36)
        .glassEffect(
            .regular.tint((game?.brandColor ?? .accentColor).opacity(0.08)),
            in: .capsule
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(displayName), \(cardCount) cards")
    }
}

// MARK: - Result Cell
struct CardSearchResultCell: View {
    let card: Card
    let showPricing: Bool
    let showCardNumbers: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Card Image
            CachedAsyncImage(card: card) { phase in
                switch phase {
                case .empty:
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .aspectRatio(0.7, contentMode: .fit)
                        .overlay(
                            ProgressView()
                        )
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                case .failure:
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .aspectRatio(0.7, contentMode: .fit)
                        .overlay(
                            unavailableImagePlaceholder
                        )
                @unknown default:
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .aspectRatio(0.7, contentMode: .fit)
                        .overlay(
                            unavailableImagePlaceholder
                        )
                }
            }
            .cornerRadius(8)

            // Card Info
            VStack(alignment: .leading, spacing: 4) {
                if let worlds = card.pokemonPrint?.worldChampionship {
                    HStack(spacing: 4) {
                        Text("Worlds \(worlds.year)")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(.orange)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Color.orange.opacity(0.14))
                            .clipShape(Capsule())

                        Text(worlds.playerName)
                            .font(.system(size: 9))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }

                if let rarity = card.rarity {
                    PokemonRarityBadge(rarity: rarity, tcg: card.tcg)
                }

                HStack(alignment: .top, spacing: 4) {
                    Text(card.name)
                        .font(.caption)
                        .fontWeight(.medium)
                        .lineLimit(2)

                    Spacer(minLength: 0)

                    if showCardNumbers {
                        if let collectorNumberDisplay {
                            Text(collectorNumberDisplay)
                                .font(.caption2)
                                .fontWeight(.semibold)
                                .foregroundColor(.primary)
                                .fixedSize()
                        }
                    }
                }

                if showCardNumbers {
                    Text(setDisplayName ?? " ")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                // Pokemon TCG format legality & dex number
                if card.tcg == "pokemon" {
                    HStack(spacing: 4) {
                        if let supertype = card.supertype {
                            Text(supertype)
                                .font(.system(size: 9))
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color(.systemGray4))
                                .cornerRadius(3)
                        }
                        if card.sanctionedPlayLegal == false {
                            Text("Not tournament legal")
                                .font(.system(size: 9))
                                .foregroundColor(.orange)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color.orange.opacity(0.15))
                                .cornerRadius(3)
                        } else if card.formatLegality?.standard == true {
                            Text("Standard")
                                .font(.system(size: 9))
                                .foregroundColor(.green)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color.green.opacity(0.15))
                                .cornerRadius(3)
                        }
                        if card.formatLegality?.expanded == true {
                            Text("Expanded")
                                .font(.system(size: 9))
                                .foregroundColor(.blue)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color.blue.opacity(0.15))
                                .cornerRadius(3)
                        }
                        if let dexNum = card.pokedexNumber {
                            Text("#\(dexNum)")
                                .font(.system(size: 9))
                                .foregroundColor(.secondary)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 1)
                                .background(Color(.systemGray5))
                                .cornerRadius(3)
                        }
                    }
                }

                if showPricing, let price = card.price {
                    Text(price.priceText)
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundColor(.green)
                }
            }
        }
        .padding(8)
        .background(Color(.systemGray6))
        .cornerRadius(12)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    private var unavailableImagePlaceholder: some View {
        VStack(spacing: 6) {
            Image(systemName: "photo")
                .font(.title3)
            Text("Image unavailable")
                .font(.caption2)
        }
        .foregroundColor(.secondary)
        .accessibilityHidden(true)
    }

    private var setDisplayName: String? {
        switch (setName, setCode) {
        case let (name?, code?) where name.caseInsensitiveCompare(code) != .orderedSame:
            return "\(name) · \(code)"
        case let (name?, _):
            return name
        case let (_, code?):
            return code
        default:
            return nil
        }
    }

    private var setName: String? {
        nonEmpty(card.setName)
    }

    private var setCode: String? {
        nonEmpty(card.setCode)
    }

    private var collectorNumber: String? {
        if let displayValue = card.attributes?["collector_number_display"],
           case .string(let displayNumber) = displayValue,
           let displayNumber = nonEmpty(displayNumber) {
            return displayNumber
        }
        return nonEmpty(card.collectorNumber)
    }

    private var collectorNumberDisplay: String? {
        guard let collectorNumber else { return nil }
        return collectorNumber.hasPrefix("#") ? collectorNumber : "#\(collectorNumber)"
    }

    private var accessibilityLabel: String {
        var parts = [card.name, card.tcgDisplayName]

        if showCardNumbers {
            if let setName {
                parts.append("Set \(setName)")
            }
            if let setCode,
               setCode.caseInsensitiveCompare(setName ?? "") != .orderedSame {
                parts.append("Set code \(setCode)")
            }
            if let collectorNumber {
                parts.append("Card number \(collectorNumber)")
            }
        }

        if let rarity = nonEmpty(card.rarity) {
            parts.append(rarity)
        }
        if let worlds = card.pokemonPrint?.worldChampionship {
            parts.append("World Championship \(worlds.year) replica for \(worlds.playerName)")
            if let deckName = nonEmpty(worlds.deckName) {
                parts.append("Deck \(deckName)")
            }
        }
        if card.sanctionedPlayLegal == false {
            parts.append("Not tournament legal")
        }
        if showPricing, let price = card.price {
            parts.append("Price \(price.priceText)")
        }

        return parts.joined(separator: ", ")
    }

    private func nonEmpty(_ value: String?) -> String? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        return value
    }
}

// MARK: - Placeholder States

/// Generic icon/title/message placeholder used for the pre-search and
/// no-results states of every search screen.
struct SearchPlaceholderView: View {
    let icon: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: icon)
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text(title)
                .font(.title2)
                .fontWeight(.semibold)
            Text(message)
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// "No Cards Found" state shared by the search screens.
struct EmptySearchView: View {
    var body: some View {
        SearchPlaceholderView(
            icon: "questionmark.folder",
            title: "No Cards Found",
            message: "Try a different search term or game filter."
        )
    }
}

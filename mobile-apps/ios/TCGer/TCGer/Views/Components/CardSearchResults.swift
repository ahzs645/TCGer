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

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 20, pinnedViews: [.sectionHeaders]) {
                ForEach(groupedCards, id: \.0) { tcg, tcgCards in
                    if showsGameSectionHeader {
                        Section {
                            cardsGrid(tcgCards)
                        } header: {
                            HStack {
                                Text(tcgCards.first?.tcgDisplayName ?? tcg.uppercased())
                                    .font(.headline)
                                    .padding(.horizontal)
                                Spacer()
                                Text("\(tcgCards.count) cards")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .padding(.horizontal)
                            }
                            .padding(.vertical, 8)
                            .background(Color(.systemBackground))
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
                            Image(systemName: "photo")
                                .foregroundColor(.secondary)
                        )
                @unknown default:
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .aspectRatio(0.7, contentMode: .fit)
                        .overlay(
                            Image(systemName: "photo")
                                .foregroundColor(.secondary)
                        )
                }
            }
            .cornerRadius(8)

            // Card Info
            VStack(alignment: .leading, spacing: 4) {
                if let rarity = card.rarity {
                    PokemonRarityBadge(rarity: rarity, tcg: card.tcg)
                }

                Text(card.name)
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(2)

                if showCardNumbers, let setName = card.setName {
                    Text(setName)
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
                        if card.formatLegality?.standard == true {
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

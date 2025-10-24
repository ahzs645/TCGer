import SwiftUI

struct CollectionCardView: View {
    let collection: Collection
    @Namespace private var namespace

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header with color dot and name
            HStack(spacing: 12) {
                Circle()
                    .fill(collection.color)
                    .frame(width: 12, height: 12)
                    .shadow(color: collection.color.opacity(0.4), radius: 4, x: 0, y: 2)

                Text(collection.name)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            // Description (if available)
            if let description = collection.description, !description.isEmpty {
                Text(description)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            // Card Preview Strip
            CardPreviewStrip(cards: collection.cards)

            Divider()

            // Stats Row
            HStack(spacing: 16) {
                Label(
                    "\(collection.uniqueGames.count) games",
                    systemImage: "gamecontroller.fill"
                )
                .font(.caption)
                .foregroundColor(.secondary)

                Label(
                    "\(collection.uniqueCards) cards",
                    systemImage: "square.stack.3d.up.fill"
                )
                .font(.caption)
                .foregroundColor(.secondary)

                Spacer()

                Text("$\(collection.totalValue, specifier: "%.2f")")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundColor(.green)
            }

            // Updated timestamp
            HStack {
                Text("Updated \(formatRelativeDate(collection.updatedAt))")
                    .font(.caption2)
                    .foregroundColor(.secondary)

                Spacer()

                // Game badges
                HStack(spacing: 4) {
                    ForEach(Array(collection.uniqueGames).sorted(), id: \.self) { game in
                        GameBadge(game: game)
                    }
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .shadow(color: Color.black.opacity(0.05), radius: 4, x: 0, y: 2)
    }

    private func formatRelativeDate(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        guard let date = formatter.date(from: dateString) else {
            return "recently"
        }

        let now = Date()
        let components = Calendar.current.dateComponents([.day, .hour], from: date, to: now)

        if let days = components.day, days > 0 {
            if days == 1 {
                return "yesterday"
            } else if days < 7 {
                return "\(days) days ago"
            } else if days < 30 {
                let weeks = days / 7
                return weeks == 1 ? "1 week ago" : "\(weeks) weeks ago"
            } else {
                let months = days / 30
                return months == 1 ? "1 month ago" : "\(months) months ago"
            }
        } else if let hours = components.hour, hours > 0 {
            return hours == 1 ? "1 hour ago" : "\(hours) hours ago"
        } else {
            return "just now"
        }
    }
}

struct GameBadge: View {
    let game: String

    var body: some View {
        Text(gameName)
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(.white)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(gameColor)
            .cornerRadius(4)
    }

    private var gameName: String {
        switch game.lowercased() {
        case "yugioh": return "YGO"
        case "magic": return "MTG"
        case "pokemon": return "PKM"
        default: return game.prefix(3).uppercased()
        }
    }

    private var gameColor: Color {
        switch game.lowercased() {
        case "yugioh": return Color.purple
        case "magic": return Color.orange
        case "pokemon": return Color.blue
        default: return Color.gray
        }
    }
}

#Preview {
    ScrollView {
        VStack(spacing: 16) {
            CollectionCardView(
                collection: Collection(
                    id: "1",
                    name: "Binder Alpha",
                    description: "Flagship deck staples, graded highlights, and tournament-ready foils.",
                    cards: [
                        CollectionCard(
                            id: "1", cardId: "1", name: "Dark Magician", tcg: "yugioh",
                            setCode: "SDY-006", rarity: "Ultra Rare",
                            imageUrl: "https://images.ygoprodeck.com/images/cards/46986414.jpg",
                            imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/46986414.jpg",
                            quantity: 2, price: 89.99, condition: "Near Mint", language: nil, notes: nil
                        ),
                        CollectionCard(
                            id: "2", cardId: "2", name: "Blue-Eyes", tcg: "yugioh",
                            setCode: "SDK-001", rarity: "Ultra Rare",
                            imageUrl: "https://images.ygoprodeck.com/images/cards/74677422.jpg",
                            imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/74677422.jpg",
                            quantity: 3, price: 120.0, condition: "Played", language: nil, notes: nil
                        )
                    ],
                    createdAt: "2025-10-12T09:00:00Z",
                    updatedAt: "2025-10-23T09:00:00Z",
                    colorHex: "90CAF9"
                )
            )

            CollectionCardView(
                collection: Collection(
                    id: "2",
                    name: "Empty Collection",
                    description: "No cards yet",
                    cards: [],
                    createdAt: "2025-10-23T09:00:00Z",
                    updatedAt: "2025-10-23T09:00:00Z",
                    colorHex: "E57373"
                )
            )
        }
        .padding()
    }
}

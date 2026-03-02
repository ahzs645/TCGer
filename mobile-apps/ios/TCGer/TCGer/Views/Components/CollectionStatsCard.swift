import SwiftUI

struct CollectionStatsCard: View {
    let collection: Collection
    let showPricing: Bool

    private var statItems: [(title: String, value: String, color: Color, icon: String)] {
        var items: [(String, String, Color, String)] = [
            (
                "Cards",
                "\(collection.uniqueCards)",
                .blue,
                "square.stack.3d.up.fill"
            )
        ]

        if showPricing {
            items.insert(
                (
                    "Total Value",
                    String(format: "$%.2f", collection.totalValue),
                    .green,
                    "dollarsign.circle.fill"
                ),
                at: 0
            )
        }

        return items
    }

    private var activeGames: [TCGGame] {
        collection.uniqueGames
            .compactMap { TCGGame(rawValue: $0.lowercased()) }
            .sorted { $0.rawValue < $1.rawValue }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                ForEach(Array(statItems.enumerated()), id: \.offset) { _, item in
                    StatItem(
                        title: item.title,
                        value: item.value,
                        color: item.color,
                        icon: item.icon
                    )
                }
            }

            if !activeGames.isEmpty {
                HStack(spacing: 10) {
                    ForEach(activeGames) { game in
                        GameIcon(game: game)
                    }
                }
                .padding(.horizontal, 4)
            }
        }
        .padding(10)
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
        .shadow(color: Color.black.opacity(0.05), radius: 4, x: 0, y: 2)
    }
}

struct StatItem: View {
    let title: String
    let value: String
    let color: Color
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                ZStack {
                    Circle()
                        .fill(color.opacity(0.15))
                        .frame(width: 28, height: 28)
                    Image(systemName: icon)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(color)
                }

                Text(title.uppercased())
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }

            Text(value)
                .font(.title3.monospacedDigit())
                .fontWeight(.semibold)
                .foregroundColor(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .allowsTightening(true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(color.opacity(0.10))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct GameIcon: View {
    let game: TCGGame

    var body: some View {
        ZStack {
            Circle()
                .fill(Color(.tertiarySystemBackground))
                .frame(width: 34, height: 34)

            if let iconName = game.iconName {
                Image(iconName)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 22, height: 22)
            } else {
                Image(systemName: game.systemIconName)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.secondary)
            }
        }
    }
}

#Preview {
    CollectionStatsCard(
        collection: Collection(
            id: "1",
            name: "Test",
            description: nil,
            cards: [
                CollectionCard(
                    id: "1",
                    cardId: "1",
                    externalId: "stats-1",
                    name: "Test Card",
                    tcg: "yugioh",
                    setCode: nil,
                    setName: nil,
                    rarity: nil,
                    imageUrl: nil,
                    imageUrlSmall: nil,
                    quantity: 2,
                    price: 50.0,
                    condition: nil,
                    language: nil,
                    notes: nil,
                    collectorNumber: nil,
                    copies: []
                )
            ],
            createdAt: "",
            updatedAt: "",
            colorHex: nil
        ),
        showPricing: true
    )
    .padding()
}

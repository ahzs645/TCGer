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
            ),
            (
                "Games",
                "\(collection.uniqueGames.count)",
                .purple,
                "gamecontroller.fill"
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

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 0) {
                ForEach(Array(statItems.enumerated()), id: \.offset) { index, item in
                    StatItem(
                        title: item.title,
                        value: item.value,
                        color: item.color,
                        icon: item.icon
                    )

                    if index < statItems.count - 1 {
                        Divider()
                            .frame(height: 40)
                    }
                }
            }
        }
        .padding()
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
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(color)

            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundColor(.primary)

            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
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
                    name: "Test Card",
                    tcg: "yugioh",
                    setCode: nil,
                    rarity: nil,
                    imageUrl: nil,
                    imageUrlSmall: nil,
                    quantity: 2,
                    price: 50.0,
                    condition: nil,
                    language: nil,
                    notes: nil
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

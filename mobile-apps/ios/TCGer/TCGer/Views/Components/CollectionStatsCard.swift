import SwiftUI

struct CollectionStatsCard: View {
    let collection: Collection

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 0) {
                StatItem(
                    title: "Total Value",
                    value: String(format: "$%.2f", collection.totalValue),
                    color: .green,
                    icon: "dollarsign.circle.fill"
                )

                Divider()
                    .frame(height: 40)

                StatItem(
                    title: "Cards",
                    value: "\(collection.uniqueCards)",
                    color: .blue,
                    icon: "square.stack.3d.up.fill"
                )

                Divider()
                    .frame(height: 40)

                StatItem(
                    title: "Games",
                    value: "\(collection.uniqueGames.count)",
                    color: .purple,
                    icon: "gamecontroller.fill"
                )
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
        )
    )
    .padding()
}

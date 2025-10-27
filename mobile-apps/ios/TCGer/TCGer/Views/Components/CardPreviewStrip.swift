import SwiftUI

struct CardPreviewStrip: View {
    let cards: [CollectionCard]
    let maxPreview: Int = 5

    var body: some View {
        if cards.isEmpty {
            EmptyPreviewPlaceholder()
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Array(cards.prefix(maxPreview))) { card in
                        CardPreviewImage(imageUrl: card.imageUrlSmall)
                    }

                    if cards.count > maxPreview {
                        MoreCardsIndicator(count: cards.count - maxPreview)
                    }
                }
            }
            .frame(height: 80)
        }
    }
}

struct CardPreviewImage: View {
    let imageUrl: String?

    var body: some View {
        CachedAsyncImage(url: URL(string: imageUrl ?? "")) { phase in
            switch phase {
            case .empty:
                Rectangle()
                    .fill(Color.gray.opacity(0.1))
                    .frame(width: cardWidth, height: 80)
                    .overlay(
                        ProgressView()
                            .scaleEffect(0.7)
                    )
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(2.5/3.5, contentMode: .fit)
                    .frame(height: 80)
                    .cornerRadius(4)
                    .shadow(color: Color.black.opacity(0.1), radius: 2, x: 0, y: 1)
            case .failure:
                Rectangle()
                    .fill(Color.gray.opacity(0.1))
                    .frame(width: cardWidth, height: 80)
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(.gray)
                    )
            @unknown default:
                EmptyView()
            }
        }
        .cornerRadius(4)
    }

    private var cardWidth: CGFloat {
        80 * (2.5 / 3.5)
    }
}

struct EmptyPreviewPlaceholder: View {
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "rectangle.stack.badge.plus")
                .font(.title3)
                .foregroundColor(.accentColor)

            VStack(alignment: .leading, spacing: 4) {
                Text("No cards in this binder yet")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Text("Add cards to see quick previews here.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Spacer()
        }
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(Color(.systemGray6))
        .cornerRadius(10)
    }
}

struct MoreCardsIndicator: View {
    let count: Int

    var body: some View {
        VStack {
            Image(systemName: "plus.circle.fill")
                .font(.title2)
                .foregroundColor(.blue)

            Text("+\(count)")
                .font(.caption)
                .fontWeight(.semibold)
                .foregroundColor(.secondary)
        }
        .frame(width: 80 * (2.5/3.5), height: 80)
        .background(Color.gray.opacity(0.05))
        .cornerRadius(4)
        .overlay(
            RoundedRectangle(cornerRadius: 4)
                .stroke(Color.gray.opacity(0.2), lineWidth: 1)
        )
    }
}

#Preview {
    VStack(spacing: 20) {
        // With cards
        CardPreviewStrip(cards: [
            CollectionCard(
                id: "1",
                cardId: "1",
                externalId: "preview-1",
                name: "Test",
                tcg: "yugioh",
                setCode: nil,
                setName: nil,
                rarity: nil,
                imageUrl: "https://images.ygoprodeck.com/images/cards/46986414.jpg",
                imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/46986414.jpg",
                quantity: 1,
                price: nil,
                condition: nil,
                language: nil,
                notes: nil,
                collectorNumber: nil,
                copies: []
            ),
            CollectionCard(
                id: "2",
                cardId: "2",
                externalId: "preview-2",
                name: "Test 2",
                tcg: "yugioh",
                setCode: nil,
                setName: nil,
                rarity: nil,
                imageUrl: "https://images.ygoprodeck.com/images/cards/46986414.jpg",
                imageUrlSmall: "https://images.ygoprodeck.com/images/cards_small/46986414.jpg",
                quantity: 1,
                price: nil,
                condition: nil,
                language: nil,
                notes: nil,
                collectorNumber: nil,
                copies: []
            )
        ])

        // Empty
        CardPreviewStrip(cards: [])
    }
    .padding()
}

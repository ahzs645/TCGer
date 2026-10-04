// @tcger-feature {"id":"collections.artworkBadges","platform":"ios","status":"implemented","limitation":"Displays stored per-card estimates; market refresh remains in Prices. Mixed finishes/conditions share the collection printing's stored estimate.","modes":["local","server","demo"]}
import SwiftUI

/// An absent quote is different from a real zero-dollar quote.
struct CardPriceBadgeValue {
    let price: Double?

    var text: String {
        guard let price, price.isFinite, price >= 0 else { return "—" }
        return price.priceText
    }

    var accessibilityLabel: String {
        guard let price, price.isFinite, price >= 0 else { return "Price unavailable" }
        return "\(price.priceText) per card"
    }
}

/// Quantity and unit price sit together above the artwork, as in a card album.
/// These are collection estimates, never a multiplication by the copy count.
struct CardArtworkBadges: View {
    var quantity: Int? = nil
    let price: Double?
    let showPricing: Bool

    var body: some View {
        HStack(spacing: 4) {
            if let quantity {
                Text(quantity.formatted())
                    .padding(.horizontal, 7)
                    .frame(minWidth: 28, minHeight: 28)
                    .background(Color.red, in: Capsule())
                    .accessibilityLabel("\(quantity) \(quantity == 1 ? "copy" : "copies")")
            }
            if showPricing {
                let value = CardPriceBadgeValue(price: price)
                Text(value.text)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 28)
                    .background(Color.blue, in: Capsule())
                    .accessibilityLabel(value.accessibilityLabel)
            }
        }
        .font(.caption.weight(.bold))
        .monospacedDigit()
        .foregroundStyle(.white)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

struct CollectionCardGridCell: View {
    let card: CollectionCard
    let showPricing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            CardArtworkImage(card: card.previewCard, useFullResolution: true)
                .aspectRatio(0.716, contentMode: .fit)
                .overlay(alignment: .topLeading) {
                    CardArtworkBadges(quantity: card.quantity, price: card.price, showPricing: showPricing)
                        .padding(4)
                }
            Text(card.name)
                .font(.caption.weight(.medium))
                .foregroundStyle(.primary)
                .lineLimit(2)
            if let set = card.setName ?? card.setCode {
                Text(set)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .accessibilityElement(children: .combine)
    }
}

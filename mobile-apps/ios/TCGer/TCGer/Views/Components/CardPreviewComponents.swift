import SwiftUI

/// Shared card artwork loader used anywhere we need a consistent card image rendering.
struct CardArtworkImage: View {
    let card: Card
    let useFullResolution: Bool

    private var imageURL: URL? {
        if useFullResolution, let highRes = card.imageUrl, let url = URL(string: highRes) {
            return url
        }
        if let small = card.imageUrlSmall, let url = URL(string: small) {
            return url
        }
        if let fallback = card.imageUrl, let url = URL(string: fallback) {
            return url
        }
        return nil
    }

    private var isLocalAsset: Bool {
        // Check if the imageUrl is a local asset name (doesn't start with http/https)
        guard let imageUrl = useFullResolution ? card.imageUrl : (card.imageUrlSmall ?? card.imageUrl) else {
            return false
        }
        return !imageUrl.hasPrefix("http://") && !imageUrl.hasPrefix("https://")
    }

    private var localAssetName: String? {
        return useFullResolution ? card.imageUrl : (card.imageUrlSmall ?? card.imageUrl)
    }

    var body: some View {
        Group {
            if isLocalAsset, let assetName = localAssetName {
                // Load from local Assets.xcassets
                Image(assetName)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                // Load from URL
                CachedAsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .empty:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .overlay(ProgressView())
                    case .failure:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            )
                    @unknown default:
                        Rectangle()
                            .fill(Color(.systemGray5))
                    }
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// A reusable preview view shown when the system context menu presents card artwork.
struct CardPreviewContextView: View {
    let card: Card

    var body: some View {
        GeometryReader { proxy in
            let aspectRatio: CGFloat = 0.72
            let horizontalPadding: CGFloat = 28
            let verticalPadding: CGFloat = 28
            let minCardWidth: CGFloat = 300
            let maxCardWidth: CGFloat = 360
            let minCardHeight: CGFloat = 420
            let maxCardHeight: CGFloat = 520

            let availableWidth = max(proxy.size.width - horizontalPadding * 2, 0)
            let availableHeight = max(proxy.size.height - verticalPadding * 2, 0)

            // Provide sensible bounds so the preview feels full-size without exceeding the menu.
            let widthCap = min(max(availableWidth, minCardWidth), maxCardWidth)
            let heightCap = min(max(availableHeight, minCardHeight), maxCardHeight)
            let widthFromHeight = heightCap * aspectRatio
            let targetWidth = min(widthCap, widthFromHeight)
            let targetHeight = targetWidth / aspectRatio

            TiltedCardView(
                card: card,
                size: CGSize(width: targetWidth, height: targetHeight),
                useFullResolution: true,
                maxTiltDegrees: 0,
                enableMotion: false,
                enableDrag: false,
                showsShadow: true
            )
                .padding(.horizontal, horizontalPadding)
                .padding(.vertical, verticalPadding)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .center)
        }
        .frame(
            minWidth: 356,
            idealWidth: 376,
            maxWidth: 416,
            minHeight: 476,
            idealHeight: 516,
            maxHeight: 576
        )
    }
}

private struct CardPreviewContextMenuModifier: ViewModifier {
    let card: Card
    let onSelect: (() -> Void)?

    func body(content: Content) -> some View {
        content.contextMenu {
            if let onSelect {
                Button("Select this print", action: onSelect)
                Divider()
            }
            Button("Close", role: .cancel) { }
        } preview: {
            CardPreviewContextView(card: card)
        }
    }
}

extension View {
    /// Attaches a context menu preview for the given card, using an optional selection action.
    func cardPreviewContextMenu(card: Card, onSelect: (() -> Void)? = nil) -> some View {
        modifier(CardPreviewContextMenuModifier(card: card, onSelect: onSelect))
    }
}

extension Card {
    /// Convenience factory to build a preview-capable card from a collection entry.
    static func preview(from collectionCard: CollectionCard) -> Card {
        Card(
            id: collectionCard.cardId,
            name: collectionCard.name,
            tcg: collectionCard.tcg,
            setCode: collectionCard.setCode,
            setName: collectionCard.setName,
            rarity: collectionCard.rarity,
            imageUrl: collectionCard.imageUrl,
            imageUrlSmall: collectionCard.imageUrlSmall,
            price: collectionCard.price,
            collectorNumber: collectionCard.collectorNumber,
            releasedAt: nil
        )
    }
}

extension CollectionCard {
    var previewCard: Card { Card.preview(from: self) }
}

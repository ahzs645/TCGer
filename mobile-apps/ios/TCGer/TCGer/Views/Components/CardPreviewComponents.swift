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

    var body: some View {
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
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// A reusable preview view shown when the system context menu presents card artwork.
struct CardPreviewContextView: View {
    let card: Card

    var body: some View {
        GeometryReader { proxy in
            let availableWidth = proxy.size.width
            let availableHeight = proxy.size.height

            // Provide sensible bounds so the preview feels full-size without exceeding the menu.
            let maxWidth = min(max(availableWidth - 48, 300), 360)
            let maxHeight = min(max(availableHeight - 48, 420), 520)
            let widthFromHeight = maxHeight * 0.72
            let targetWidth = min(maxWidth, widthFromHeight)
            let targetHeight = targetWidth / 0.72

            CardArtworkImage(card: card, useFullResolution: true)
                .aspectRatio(0.72, contentMode: .fit)
                .frame(width: targetWidth, height: targetHeight)
                .shadow(color: .black.opacity(0.25), radius: 18, y: 10)
                .padding(28)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .center)
        }
        .frame(minWidth: 320, idealWidth: 340, maxWidth: 380, minHeight: 420, idealHeight: 460, maxHeight: 520)
    }
}

private struct CardPreviewContextMenuModifier: ViewModifier {
    let card: Card
    let onSelect: (() -> Void)?

    func body(content: Content) -> some View {
        content.contextMenu {
            if let onSelect {
                Button("Select this print", action: onSelect)
            }
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

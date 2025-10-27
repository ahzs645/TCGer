import SwiftUI

/// A reusable container that manages presenting full-screen card artwork previews
/// triggered from thumbnails within its content. Any view that needs long-press
/// card previews can wrap its layout in this container and receive the tools it
/// needs to control the preview state.
struct CardPreviewContainer<Content: View>: View {
    private let content: (_ previewedCard: Card?, _ namespace: Namespace.ID, _ setPreview: @escaping (Card?) -> Void) -> Content

    @State private var previewedCard: Card?
    @Namespace private var namespace

    init(@ViewBuilder content: @escaping (_ previewedCard: Card?, _ namespace: Namespace.ID, _ setPreview: @escaping (Card?) -> Void) -> Content) {
        self.content = content
    }

    var body: some View {
        ZStack {
            content(previewedCard, namespace) { target in
                withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                    previewedCard = target
                }
            }
            .zIndex(0)
            .allowsHitTesting(previewedCard == nil)

            if let card = previewedCard {
                CardPreviewOverlay(card: card, namespace: namespace) {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
                        previewedCard = nil
                    }
                }
                .transition(.opacity)
                .zIndex(1)
            }
        }
    }
}

/// Full-screen presentation for an enlarged card image, using matched geometry
/// so the thumbnail seamlessly expands into place.
struct CardPreviewOverlay: View {
    let card: Card
    let namespace: Namespace.ID
    let onDismiss: () -> Void
    @EnvironmentObject private var environmentStore: EnvironmentStore

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .overlay(Color.black.opacity(0.35))
                    .ignoresSafeArea()
                    .onTapGesture { onDismiss() }

                VStack(spacing: 24) {
                    Spacer(minLength: 32)

                    CardArtworkImage(card: card, useFullResolution: true)
                        .matchedGeometryEffect(id: card.id, in: namespace)
                        .shadow(color: .black.opacity(0.35), radius: 20, y: 10)
                        .frame(maxWidth: min(proxy.size.width - 64, 360))

                    VStack(spacing: 6) {
                        Text(card.name)
                            .font(.title3.weight(.semibold))
                            .foregroundColor(.white)
                            .multilineTextAlignment(.center)

                        if let set = card.setName ?? card.setCode {
                            Text(set)
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.75))
                        }

                        if let details = supplementaryDetails, !details.isEmpty {
                            Text(details)
                                .font(.caption)
                                .foregroundColor(.white.opacity(0.7))
                                .multilineTextAlignment(.center)
                                .padding(.top, 6)
                        }
                    }
                    .padding(.horizontal)

                    Spacer()
                }
            }
            .overlay(alignment: .topTrailing) {
                Button(action: onDismiss) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 32))
                        .foregroundColor(.white.opacity(0.9))
                        .padding()
                }
                .accessibilityLabel("Close preview")
            }
        }
    }

    private var supplementaryDetails: String? {
        var parts: [String] = []
        if let rarity = card.rarity {
            parts.append(rarity)
        }
        if environmentStore.showCardNumbers, let collectorNumber = card.collectorNumber {
            parts.append("#\(collectorNumber)")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " • ")
    }
}

/// Shared artwork loader with consistent styling used for both thumbnails and previews.
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

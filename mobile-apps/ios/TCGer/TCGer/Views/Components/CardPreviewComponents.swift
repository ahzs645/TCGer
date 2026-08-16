import SwiftUI

/// Shared card artwork loader used anywhere we need a consistent card image rendering.
struct CardArtworkImage: View {
    let card: Card
    let useFullResolution: Bool

    private var preferredImageValue: String? {
        useFullResolution ? (card.imageUrl ?? card.imageUrlSmall) : (card.imageUrlSmall ?? card.imageUrl)
    }

    private var alternateImageValue: String? {
        useFullResolution ? card.imageUrlSmall : card.imageUrl
    }

    private var isLocalAsset: Bool {
        guard let imageUrl = preferredImageValue else {
            return false
        }
        return !imageUrl.hasPrefix("http://") && !imageUrl.hasPrefix("https://")
    }

    private var localAssetName: String? {
        preferredImageValue
    }

    private var remoteImageURL: URL? {
        CardArtworkURLResolver.resolve(
            preferred: preferredImageValue,
            alternate: alternateImageValue,
            isConnected: NetworkMonitor.shared.isConnected,
            isCached: ImageCache.shared.hasImage(for:)
        )
    }

    var body: some View {
        Group {
            if isLocalAsset, let assetName = localAssetName {
                // Load from local Assets.xcassets
                Image(assetName)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else {
                CachedAsyncImage(url: remoteImageURL, tcg: card.tcg) { phase in
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

/// Chooses between the large and thumbnail artwork URLs without requiring the
/// caller to know which rendition was persisted. Grid rows normally warm the
/// thumbnail, while a context-menu preview prefers the large image; offline,
/// either cached rendition is better than replacing the real card with its
/// generic back.
nonisolated enum CardArtworkURLResolver {
    static func resolve(
        preferred: String?,
        alternate: String?,
        isConnected: Bool,
        isCached: (URL) -> Bool
    ) -> URL? {
        let preferredURL = remoteURL(from: preferred)
        guard !isConnected else { return preferredURL ?? remoteURL(from: alternate) }

        if let preferredURL, isCached(preferredURL) {
            return preferredURL
        }
        if let alternateURL = remoteURL(from: alternate), isCached(alternateURL) {
            return alternateURL
        }
        return preferredURL ?? remoteURL(from: alternate)
    }

    private static func remoteURL(from value: String?) -> URL? {
        guard
            let value,
            let url = URL(string: value),
            let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https" || scheme == "file"
        else { return nil }
        return url
    }
}

/// A reusable preview view shown when the system context menu presents card artwork.
struct CardPreviewContextView: View {
    let card: Card
    var showsFoil: Bool = true

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
                showsShadow: true,
                showsFoil: showsFoil
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

/// Read-only details reached from a card's context menu.
struct CardDetailSheet: View {
    let card: Card
    let showPricing: Bool
    let showCardNumbers: Bool

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    CardArtworkImage(card: card, useFullResolution: true)
                        .frame(maxWidth: 420)
                        .frame(maxWidth: .infinity)

                    VStack(alignment: .leading, spacing: 8) {
                        Text(card.name)
                            .font(.title2.bold())

                        Text(card.tcgDisplayName)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }

                    details
                }
                .padding()
            }
            .navigationTitle("Card Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private var details: some View {
        VStack(spacing: 0) {
            if let setName = card.setName {
                detailRow("Set", value: setName)
            }
            if showCardNumbers, let collectorNumber = card.collectorNumber {
                detailRow("Card Number", value: collectorNumber)
            }
            if let rarity = card.rarity {
                detailRow("Rarity", value: rarity)
            }
            if let supertype = card.supertype {
                detailRow("Type", value: supertype)
            }
            if let types = card.types, !types.isEmpty {
                detailRow("Energy", value: types.joined(separator: ", "))
            }
            if let regulationMark = card.regulationMark {
                detailRow("Regulation Mark", value: regulationMark)
            }
            if let releasedAt = card.releasedAt {
                detailRow("Released", value: releasedAt.formatted(date: .abbreviated, time: .omitted))
            }
            if showPricing, let price = card.price {
                detailRow("Market Price", value: price.priceText)
            }
            if card.formatLegality?.standard == true {
                detailRow("Standard", value: "Legal")
            }
            if card.formatLegality?.expanded == true {
                detailRow("Expanded", value: "Legal")
            }
        }
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func detailRow(_ label: String, value: String) -> some View {
        LabeledContent(label, value: value)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .overlay(alignment: .bottom) {
                Divider()
                    .padding(.leading, 14)
            }
    }
}

private struct CardPreviewContextMenuModifier: ViewModifier {
    let card: Card
    let showsFoil: Bool
    let primaryActionTitle: String
    let onSelect: (() -> Void)?
    let onShowDetails: (() -> Void)?
    let onAddToWishlist: (() -> Void)?

    func body(content: Content) -> some View {
        content.contextMenu {
            if let onSelect {
                Button(primaryActionTitle, action: onSelect)
                Divider()
            }
            if let onShowDetails {
                Button {
                    onShowDetails()
                } label: {
                    Label("Card Details", systemImage: "info.circle")
                }
                Divider()
            }
            if let onAddToWishlist {
                Button {
                    onAddToWishlist()
                } label: {
                    Label("Add to Wishlist", systemImage: "heart")
                }
                Divider()
            }
            Button("Close", role: .cancel) { }
        } preview: {
            CardPreviewContextView(card: card, showsFoil: showsFoil)
        }
    }
}

extension View {
    /// Attaches a context menu preview for the given card, using an optional selection action.
    func cardPreviewContextMenu(
        card: Card,
        showsFoil: Bool = true,
        primaryActionTitle: String = "Select this print",
        onSelect: (() -> Void)? = nil,
        onShowDetails: (() -> Void)? = nil,
        onAddToWishlist: (() -> Void)? = nil
    ) -> some View {
        modifier(
            CardPreviewContextMenuModifier(
                card: card,
                showsFoil: showsFoil,
                primaryActionTitle: primaryActionTitle,
                onSelect: onSelect,
                onShowDetails: onShowDetails,
                onAddToWishlist: onAddToWishlist
            )
        )
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
            releasedAt: collectionCard.releasedAt.flatMap(ISO8601DateFormatter().date),
            supertype: collectionCard.supertype,
            formatLegality: collectionCard.formatLegality,
            dexEntries: collectionCard.dexEntries,
            region: collectionCard.region,
            setSymbolUrl: collectionCard.setSymbolUrl,
            setLogoUrl: collectionCard.setLogoUrl,
            regulationMark: collectionCard.regulationMark,
            language: collectionCard.languageCode,
            pokemonPrint: collectionCard.pokemonPrint,
            attributes: collectionCard.attributes,
            provenance: collectionCard.provenance,
            legalityPeriods: collectionCard.legalityPeriods,
            evolution: collectionCard.evolution,
            functionalIdentity: collectionCard.functionalIdentity,
            baseExternalId: collectionCard.baseExternalId,
            printingKey: collectionCard.printingKey,
            artworkId: collectionCard.artworkId,
            printingKind: collectionCard.printingKind,
            sanctionedPlayLegal: collectionCard.sanctionedPlayLegal,
            originalPrintingKey: collectionCard.originalPrintingKey
        )
    }
}

extension CollectionCard {
    var previewCard: Card { Card.preview(from: self) }
}

extension WishlistCard {
    /// Preview-capable card built from a wishlist entry, mirroring
    /// `CollectionCard.previewCard`.
    var previewCard: Card {
        Card(
            id: externalId,
            name: name,
            tcg: tcg,
            setCode: setCode,
            setName: setName,
            rarity: rarity,
            imageUrl: imageUrl,
            imageUrlSmall: imageUrlSmall,
            price: nil,
            collectorNumber: collectorNumber,
            releasedAt: releasedAt.flatMap(ISO8601DateFormatter().date),
            supertype: supertype,
            formatLegality: formatLegality,
            dexEntries: dexEntries,
            region: region,
            setSymbolUrl: setSymbolUrl,
            setLogoUrl: setLogoUrl,
            regulationMark: regulationMark,
            language: language,
            pokemonPrint: pokemonPrint,
            attributes: attributes,
            provenance: provenance,
            legalityPeriods: legalityPeriods,
            evolution: evolution,
            functionalIdentity: functionalIdentity,
            baseExternalId: baseExternalId,
            printingKey: printingKey,
            artworkId: artworkId,
            printingKind: printingKind,
            sanctionedPlayLegal: sanctionedPlayLegal,
            originalPrintingKey: originalPrintingKey
        )
    }
}

import SwiftUI
import UIKit

struct PokemonRarityBadge: View {
    let rarity: String
    let tcg: String
    var artworkSize: CGFloat = 14
    var symbol: GameSymbol? = nil

    private var displayRarity: String {
        symbol?.label ?? CardRarityDisplay.name(for: rarity)
    }

    var body: some View {
        HStack(spacing: 4) {
            if let symbol, let url = URL(string: symbol.imageUrl) {
                AsyncImage(url: url) { image in image.resizable().scaledToFit() } placeholder: { Color.clear }.frame(width: artworkSize, height: artworkSize)
            } else if tcg.lowercased() == "pokemon",
               PokemonRarityArtworkCatalog.artwork(for: rarity) != nil {
                PokemonRarityArtworkView(rarity: rarity, size: artworkSize)
            }

            Text(displayRarity)
                .lineLimit(1)
        }
        .font(.caption2)
        .fontWeight(.semibold)
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Color.accentColor.opacity(0.2))
        .foregroundStyle(Color.accentColor)
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Rarity: \(displayRarity)")
    }
}

private struct PokemonRarityArtworkView: View {
    let rarity: String
    let size: CGFloat

    private var artwork: PokemonRarityArtworkAsset? {
        PokemonRarityArtworkCatalog.artwork(for: rarity)
    }

    private var bundledAssetExists: Bool {
        artwork.flatMap { UIImage(named: $0.assetName) } != nil
    }

    var body: some View {
        Group {
            if let artwork, bundledAssetExists {
                Image(artwork.assetName)
                    .renderingMode(.original)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            } else if let artwork,
                      let fallbackURL = Self.remoteURL(for: artwork.fallbackFilename) {
                CachedAsyncImage(url: fallbackURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .failure:
                        Color.clear
                    case .empty:
                        Color.clear
                    @unknown default:
                        Color.clear
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    /// Content-addressed PNG fallback for a known rarity whose compiled asset is
    /// unexpectedly unavailable. Normal rendering stays native and synchronous.
    private static func remoteURL(for filename: String) -> URL? {
        URL(
            string: "https://assets.tcger.ahmadjalil.com/catalogs/pokemon-rarity-symbols/\(filename)"
        )
    }
}

#Preview("Pokémon rarity badges") {
    VStack(alignment: .leading, spacing: 8) {
        ForEach(
            [
                "Common",
                "Uncommon",
                "Rare",
                "Rare Holo",
                "Amazing Rare",
                "Shiny Rare",
                "Shiny Ultra Rare",
                "Ultra Rare",
                "Promo"
            ],
            id: \.self
        ) { rarity in
            PokemonRarityBadge(rarity: rarity, tcg: "pokemon")
        }
    }
    .padding()
}

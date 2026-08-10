import SwiftUI

struct PokemonRarityBadge: View {
    let rarity: String
    let tcg: String
    var artworkSize: CGFloat = 14

    var body: some View {
        HStack(spacing: 4) {
            if tcg.lowercased() == "pokemon",
               PokemonRarityArtworkCatalog.artwork(for: rarity) != nil {
                PokemonRarityArtworkView(rarity: rarity, size: artworkSize)
            }

            Text(rarity)
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
        .accessibilityLabel("Rarity: \(rarity)")
    }
}

private struct PokemonRarityArtworkView: View {
    let rarity: String
    let size: CGFloat
    @State private var artworkIndex = 0

    private var artworkURLs: [URL] {
        guard let artwork = PokemonRarityArtworkCatalog.artwork(for: rarity) else {
            return []
        }

        var urls: [URL] = []
        if let localURL = Self.resourceURL(for: artwork.vectorFilename) {
            urls.append(localURL)
        }
        if let remoteURL = Self.remoteURL(for: artwork.vectorFilename) {
            urls.append(remoteURL)
        }
        return urls
    }

    private var artworkURL: URL? {
        artworkURLs.indices.contains(artworkIndex) ? artworkURLs[artworkIndex] : nil
    }

    var body: some View {
        Group {
            if let artworkURL {
                CachedAsyncImage(url: artworkURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .failure:
                        Color.clear
                            .onAppear {
                                if artworkIndex + 1 < artworkURLs.count {
                                    artworkIndex += 1
                                }
                            }
                    case .empty:
                        Color.clear
                    @unknown default:
                        Color.clear
                    }
                }
            }
        }
        .frame(width: size, height: size)
        .padding(1)
        .background(Color.white.opacity(0.95))
        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        .accessibilityHidden(true)
        .onChange(of: rarity) {
            artworkIndex = 0
        }
    }

    private static func resourceURL(for filename: String) -> URL? {
        if let resourceURL = Bundle.main.resourceURL {
            let nested = resourceURL
                .appendingPathComponent("PokemonRarities", isDirectory: true)
                .appendingPathComponent(filename, isDirectory: false)
            if FileManager.default.fileExists(atPath: nested.path) {
                return nested
            }
        }
        return Bundle.main.url(forResource: filename, withExtension: nil)
    }

    /// Content-addressed CDN fallback for a known rarity whose bundled SVG is
    /// missing or cannot be decoded. Unknown rarity labels remain text-only so
    /// the app never guesses at the wrong official symbol.
    private static func remoteURL(for filename: String) -> URL? {
        URL(
            string: "https://assets.tcger.ahmadjalil.com/catalogs/pokemon-rarity-symbols/\(filename)"
        )
    }
}

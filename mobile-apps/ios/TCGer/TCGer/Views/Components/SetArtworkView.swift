import SwiftUI

/// Displays a provider-backed expansion symbol or logo, with a compact set-code
/// badge for games that identify expansions textually.
struct SetArtworkView: View {
    let set: TcgSet
    var size: CGFloat = 32
    var showsFallback = true
    @State private var artworkIndex = 0

    private var artworkURLs: [URL] {
        var seen = Set<URL>()
        return [set.iconUrl, set.iconFallbackUrl, set.logoUrl]
            .compactMap { $0.flatMap(URL.init(string:)) }
            .filter { seen.insert($0).inserted }
    }

    private var artworkURL: URL? {
        artworkURLs.indices.contains(artworkIndex) ? artworkURLs[artworkIndex] : nil
    }

    private var canTryNextArtwork: Bool {
        artworkIndex + 1 < artworkURLs.count
    }

    private var label: String {
        let code = set.tcg.lowercased() == "yugioh"
            ? String(set.code.split(separator: "-").first ?? "?")
            : set.code
        return String(code.uppercased().prefix(5))
    }

    private var accentColor: Color {
        TCGGame(rawValue: set.tcg.lowercased())?.brandColor ?? .gray
    }

    var body: some View {
        Group {
            if artworkURL != nil || showsFallback {
                Group {
                    if let artworkURL {
                        CachedAsyncImage(url: artworkURL) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                            case .empty:
                                ProgressView()
                            case .failure:
                                unavailableArtwork
                            @unknown default:
                                unavailableArtwork
                            }
                        }
                    } else {
                        fallbackBadge
                    }
                }
                .frame(width: size, height: size)
                .accessibilityLabel(set.name)
            }
        }
        .onChange(of: set.id) {
            artworkIndex = 0
        }
    }

    @ViewBuilder
    private var unavailableArtwork: some View {
        if canTryNextArtwork {
            ProgressView()
                .onAppear {
                    artworkIndex += 1
                }
        } else if showsFallback {
            fallbackBadge
        } else {
            Color.clear
                .onAppear {
                    artworkIndex = artworkURLs.count
                }
        }
    }

    private var fallbackBadge: some View {
        Text(label)
            .font(.system(size: max(8, size * 0.25), weight: .bold, design: .monospaced))
            .lineLimit(1)
            .minimumScaleFactor(0.55)
            .foregroundStyle(accentColor)
            .padding(.horizontal, 3)
            .frame(width: size, height: size)
            .background(accentColor.opacity(0.12))
            .overlay {
                RoundedRectangle(cornerRadius: max(4, size * 0.18), style: .continuous)
                    .stroke(accentColor.opacity(0.4), lineWidth: 1)
            }
            .clipShape(RoundedRectangle(cornerRadius: max(4, size * 0.18), style: .continuous))
    }
}

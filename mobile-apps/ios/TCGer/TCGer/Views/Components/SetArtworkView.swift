import SwiftUI

/// Displays a provider-backed expansion symbol or logo, with a compact set-code
/// badge for games that identify expansions textually.
struct SetArtworkView: View {
    let set: TcgSet
    var size: CGFloat = 32
    @State private var iconFailed = false

    private var iconURL: URL? {
        self.set.iconUrl.flatMap(URL.init(string:))
    }

    private var logoURL: URL? {
        self.set.logoUrl.flatMap(URL.init(string:))
    }

    private var artworkURL: URL? {
        if !iconFailed, let iconURL {
            return iconURL
        }
        return logoURL
    }

    private var canTryLogo: Bool {
        !iconFailed && iconURL != nil && logoURL != nil && iconURL != logoURL
    }

    private var label: String {
        let code = set.tcg.lowercased() == "yugioh"
            ? String(set.code.split(separator: "-").first ?? "?")
            : set.code
        return String(code.uppercased().prefix(5))
    }

    private var accentColor: Color {
        switch set.tcg.lowercased() {
        case "pokemon": return .red
        case "magic": return .orange
        case "yugioh": return .purple
        case "onepiece": return .blue
        case "lorcana": return .pink
        case "dragonball": return .orange
        default: return .secondary
        }
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
                    case .empty:
                        ProgressView()
                    case .failure:
                        fallbackBadge
                            .onAppear {
                                if canTryLogo {
                                    iconFailed = true
                                }
                            }
                    @unknown default:
                        fallbackBadge
                    }
                }
            } else {
                fallbackBadge
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(set.name)
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

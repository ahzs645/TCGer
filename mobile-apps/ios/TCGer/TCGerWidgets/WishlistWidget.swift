import AppIntents
import SwiftUI
import WidgetKit

struct WishlistEntry: TimelineEntry {
    let date: Date
    let wishlist: WidgetWishlistInfo?
}

struct WishlistProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> WishlistEntry {
        WishlistEntry(date: .now, wishlist: .preview)
    }

    func snapshot(
        for configuration: WishlistConfigurationIntent,
        in context: Context
    ) async -> WishlistEntry {
        let wishlist = selectedWishlist(for: configuration)
        return WishlistEntry(
            date: .now,
            wishlist: context.isPreview && wishlist == nil ? .preview : wishlist
        )
    }

    func timeline(
        for configuration: WishlistConfigurationIntent,
        in context: Context
    ) async -> Timeline<WishlistEntry> {
        let entry = WishlistEntry(date: .now, wishlist: selectedWishlist(for: configuration))
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
        return Timeline(entries: [entry], policy: .after(nextRefresh))
    }

    private func selectedWishlist(
        for configuration: WishlistConfigurationIntent
    ) -> WidgetWishlistInfo? {
        let wishlists = SharedDataReader.wishlists
        guard let selectedID = configuration.wishlist?.id else {
            return wishlists.first
        }
        return wishlists.first { $0.id == selectedID } ?? wishlists.first
    }
}

struct WishlistWidgetView: View {
    let entry: WishlistEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let wishlist = entry.wishlist {
            wishlistView(wishlist)
                .widgetURL(URL(string: "tcger://wishlist/\(wishlist.id)"))
        } else {
            VStack(spacing: 8) {
                Image(systemName: "heart.circle")
                    .font(.largeTitle)
                    .foregroundStyle(.pink)
                Text("Choose a Wishlist")
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text("Open TCGer to sync your wishlists.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .containerBackground(.fill.tertiary, for: .widget)
            .widgetURL(URL(string: "tcger://wishlists"))
        }
    }

    private func wishlistView(_ wishlist: WidgetWishlistInfo) -> some View {
        let tint = Color(widgetHex: wishlist.colorHex, fallback: .pink)

        return Group {
            switch family {
            case .systemSmall:
                smallWishlist(wishlist, tint: tint)
            default:
                mediumWishlist(wishlist, tint: tint)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private func smallWishlist(_ wishlist: WidgetWishlistInfo, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            wishlistTitle(wishlist.name, tint: tint, compact: true)

            Spacer(minLength: 0)

            Text("\(wishlist.ownedCards) of \(wishlist.totalCards)")
                .font(.title2.monospacedDigit().weight(.bold))
                .minimumScaleFactor(0.68)
                .lineLimit(1)
            Text("cards owned")
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
                .lineLimit(1)

            WidgetProgressBar(percent: wishlist.completionPercent, tint: tint)

            HStack {
                Text("\(clampedPercent(wishlist.completionPercent))% complete")
                Spacer(minLength: 4)
                Text("\(max(wishlist.totalCards - wishlist.ownedCards, 0)) left")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            .lineLimit(1)
        }
    }

    private func mediumWishlist(_ wishlist: WidgetWishlistInfo, tint: Color) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 7) {
                wishlistTitle(wishlist.name, tint: tint)

                Spacer(minLength: 0)

                Text("\(wishlist.ownedCards) of \(wishlist.totalCards) owned")
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)

                neededCards(wishlist.neededCardNames, tint: tint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            WidgetProgressRing(percent: wishlist.completionPercent, tint: tint)
                .frame(width: 76, height: 76)
        }
    }

    private func wishlistTitle(
        _ name: String,
        tint: Color,
        compact: Bool = false
    ) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "heart.fill")
                .foregroundStyle(tint)
                .widgetAccentable()
            Text(name)
                .font(compact ? .caption.weight(.bold) : .headline.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(compact ? 0.65 : 0.75)
                .allowsTightening(true)
                .layoutPriority(1)
            Spacer(minLength: 0)
        }
    }

    private func clampedPercent(_ percent: Int) -> Int {
        min(max(percent, 0), 100)
    }

    @ViewBuilder
    private func neededCards(_ names: [String], tint: Color) -> some View {
        if names.isEmpty {
            Label("Wishlist complete!", systemImage: "checkmark.circle.fill")
                .font(.caption2)
                .foregroundStyle(tint)
        } else {
            let uniqueNames = names.reduce(into: [String]()) { result, name in
                if !result.contains(name) {
                    result.append(name)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Still needed")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ForEach(Array(uniqueNames.prefix(2).enumerated()), id: \.offset) { _, name in
                    Text("• \(name)")
                        .font(.caption2)
                        .lineLimit(1)
                }
                if uniqueNames.count > 2 {
                    Text("+\(uniqueNames.count - 2) more")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
        }
    }
}

private extension WidgetWishlistInfo {
    static let preview = WidgetWishlistInfo(
        id: "wishlist-preview",
        name: "Cards I'm Hunting",
        colorHex: "#FF2D55",
        completionPercent: 68,
        ownedCards: 17,
        totalCards: 25,
        neededCardNames: ["Umbreon ex", "Pikachu VMAX", "Mox Amber"]
    )

    static let compactStressPreview = WidgetWishlistInfo(
        id: "wishlist-compact-preview",
        name: "Darkrai Master Set",
        colorHex: "#0A84FF",
        completionPercent: 4,
        ownedCards: 2,
        totalCards: 46,
        neededCardNames: ["Darkrai VSTAR", "Darkrai GX", "Darkrai ex"]
    )
}

struct WishlistWidget: Widget {
    let kind = "WishlistWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: WishlistConfigurationIntent.self,
            provider: WishlistProvider()
        ) { entry in
            WishlistWidgetView(entry: entry)
        }
        .configurationDisplayName("Wishlist Progress")
        .description("Follow progress and see which cards you still need.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

#Preview("Wishlist — Small", as: .systemSmall) {
    WishlistWidget()
} timeline: {
    WishlistEntry(date: .now, wishlist: .compactStressPreview)
}

#Preview("Wishlist — Medium", as: .systemMedium) {
    WishlistWidget()
} timeline: {
    WishlistEntry(date: .now, wishlist: .preview)
}

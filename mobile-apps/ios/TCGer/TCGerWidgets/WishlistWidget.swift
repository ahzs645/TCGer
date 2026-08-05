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

        return HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "heart.fill")
                        .foregroundStyle(tint)
                    Text(wishlist.name)
                        .font(.headline)
                        .fontWeight(.bold)
                        .lineLimit(2)
                }

                Spacer(minLength: 0)

                Text("\(wishlist.ownedCards) of \(wishlist.totalCards) owned")
                    .font(.caption)
                    .fontWeight(.semibold)

                if family == .systemMedium {
                    neededCards(wishlist.neededCardNames, tint: tint)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            WidgetProgressRing(percent: wishlist.completionPercent, tint: tint)
                .frame(width: family == .systemMedium ? 82 : 64,
                       height: family == .systemMedium ? 82 : 64)
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder
    private func neededCards(_ names: [String], tint: Color) -> some View {
        if names.isEmpty {
            Label("Wishlist complete!", systemImage: "checkmark.circle.fill")
                .font(.caption2)
                .foregroundStyle(tint)
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Text("Still needed")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ForEach(Array(names.prefix(3).enumerated()), id: \.offset) { _, name in
                    Text("• \(name)")
                        .font(.caption2)
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

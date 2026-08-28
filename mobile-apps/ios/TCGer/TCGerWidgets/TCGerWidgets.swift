import WidgetKit
import SwiftUI

// MARK: - Collection Stats Widget

struct CollectionStatsEntry: TimelineEntry {
    let date: Date
    let totalBinders: Int
    let uniqueCards: Int
    let totalCopies: Int
    let totalValue: Double
    let currencyCode: String
    let showPricing: Bool
    let lastUpdated: Date?
    let hasData: Bool
}

struct CollectionStatsProvider: TimelineProvider {
    func placeholder(in context: Context) -> CollectionStatsEntry {
        CollectionStatsEntry(
            date: .now,
            totalBinders: 3,
            uniqueCards: 42,
            totalCopies: 87,
            totalValue: 842.35,
            currencyCode: "USD",
            showPricing: true,
            lastUpdated: .now,
            hasData: true
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (CollectionStatsEntry) -> Void) {
        if context.isPreview && !SharedDataReader.hasData {
            completion(placeholder(in: context))
            return
        }
        let entry = CollectionStatsEntry(
            date: .now,
            totalBinders: SharedDataReader.totalBinders,
            uniqueCards: SharedDataReader.uniqueCards,
            totalCopies: SharedDataReader.totalCopies,
            totalValue: SharedDataReader.totalValue,
            currencyCode: SharedDataReader.currencyCode,
            showPricing: SharedDataReader.showPricing,
            lastUpdated: SharedDataReader.lastUpdated,
            hasData: SharedDataReader.hasData
        )
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<CollectionStatsEntry>) -> Void) {
        let entry = CollectionStatsEntry(
            date: .now,
            totalBinders: SharedDataReader.totalBinders,
            uniqueCards: SharedDataReader.uniqueCards,
            totalCopies: SharedDataReader.totalCopies,
            totalValue: SharedDataReader.totalValue,
            currencyCode: SharedDataReader.currencyCode,
            showPricing: SharedDataReader.showPricing,
            lastUpdated: SharedDataReader.lastUpdated,
            hasData: SharedDataReader.hasData
        )
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct CollectionStatsWidgetView: View {
    var entry: CollectionStatsEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        Group {
            if !entry.hasData {
                VStack(spacing: 6) {
                    Image(systemName: "square.stack.3d.up")
                        .font(.title2)
                        .foregroundColor(.secondary)
                    Text("Open TCGer to sync")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .containerBackground(.fill.tertiary, for: .widget)
            } else {
                switch family {
                case .systemSmall:
                    smallStats
                default:
                    mediumStats
                }
            }
        }
        .widgetURL(URL(string: "tcger://collections"))
    }

    private var smallStats: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.title3)
                    .foregroundStyle(.tint)
                    .widgetAccentable()
                Spacer(minLength: 6)
                updatedText
            }

            Spacer(minLength: 0)

            if entry.showPricing {
                Text(formattedValue)
                    .font(.title2.monospacedDigit().weight(.bold))
                    .minimumScaleFactor(0.58)
                    .lineLimit(1)
                Text("Collection value")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text(compactCount(entry.uniqueCards))
                    .font(.title2.monospacedDigit().weight(.bold))
                    .lineLimit(1)
                Text("Unique cards")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Text("\(compactCount(entry.totalBinders)) binders · \(compactCount(entry.totalCopies)) copies")
                .font(.caption2.weight(.semibold))
                .minimumScaleFactor(0.75)
                .lineLimit(1)
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private var mediumStats: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Label(
                    entry.showPricing ? "Collection Value" : "Collection Overview",
                    systemImage: "chart.line.uptrend.xyaxis"
                )
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)

                Spacer(minLength: 4)
                updatedText
            }

            if entry.showPricing {
                Text(formattedValue)
                    .font(.title2.monospacedDigit().weight(.bold))
                    .minimumScaleFactor(0.7)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            HStack(spacing: 8) {
                StatBlock(
                    icon: "folder.fill",
                    value: compactCount(entry.totalBinders),
                    label: "Binders"
                )
                StatBlock(
                    icon: "rectangle.portrait.fill",
                    value: compactCount(entry.uniqueCards),
                    label: "Unique"
                )
                StatBlock(
                    icon: "square.stack.fill",
                    value: compactCount(entry.totalCopies),
                    label: "Copies"
                )
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    @ViewBuilder
    private var updatedText: some View {
        if let lastUpdated = entry.lastUpdated {
            Text(updatedLabel(for: lastUpdated))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
    }

    private func updatedLabel(for date: Date) -> String {
        let elapsed = max(entry.date.timeIntervalSince(date), 0)
        if elapsed < 60 {
            return "Updated now"
        }
        if elapsed < 3_600 {
            return "Updated \(Int(elapsed / 60))m ago"
        }
        if elapsed < 86_400 {
            return "Updated \(Int(elapsed / 3_600))h ago"
        }
        return "Updated \(Int(elapsed / 86_400))d ago"
    }

    private var formattedValue: String {
        entry.totalValue.formatted(.currency(code: entry.currencyCode))
    }

    private func compactCount(_ value: Int) -> String {
        value.formatted(.number.notation(.compactName))
    }
}

private struct StatBlock: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundStyle(.tint)
                    .widgetAccentable()
                Text(value)
                    .font(.headline.monospacedDigit().weight(.bold))
                    .minimumScaleFactor(0.72)
                    .lineLimit(1)
            }
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Recent Cards Widget

struct RecentCardsEntry: TimelineEntry {
    let date: Date
    let cards: [WidgetCardInfo]
    let hasData: Bool
}

struct RecentCardsProvider: TimelineProvider {
    func placeholder(in context: Context) -> RecentCardsEntry {
        RecentCardsEntry(date: .now, cards: [
            WidgetCardInfo(name: "Charizard ex", tcg: "pokemon", setName: "Surging Sparks", imageUrl: nil),
            WidgetCardInfo(name: "Pikachu VMAX", tcg: "pokemon", setName: "Vivid Voltage", imageUrl: nil),
            WidgetCardInfo(name: "Dark Magician", tcg: "yugioh", setName: "LOB", imageUrl: nil),
        ], hasData: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (RecentCardsEntry) -> Void) {
        if context.isPreview && SharedDataReader.recentCards.isEmpty {
            completion(placeholder(in: context))
            return
        }
        let entry = RecentCardsEntry(
            date: .now,
            cards: SharedDataReader.recentCards,
            hasData: SharedDataReader.hasData
        )
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<RecentCardsEntry>) -> Void) {
        let entry = RecentCardsEntry(
            date: .now,
            cards: SharedDataReader.recentCards,
            hasData: SharedDataReader.hasData
        )
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
        completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
    }
}

struct RecentCardsWidgetView: View {
    var entry: RecentCardsEntry

    var body: some View {
        Group {
            if !entry.hasData || entry.cards.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "rectangle.portrait.on.rectangle.portrait")
                        .font(.title2)
                        .foregroundColor(.secondary)
                    Text("No recent cards")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text("Open TCGer to sync")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                .containerBackground(.fill.tertiary, for: .widget)
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Recent Cards")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(.secondary)

                    ForEach(entry.cards.prefix(3)) { card in
                        HStack(spacing: 8) {
                            tcgIcon(for: card.tcg)
                                .frame(width: 14, height: 14)

                            VStack(alignment: .leading, spacing: 1) {
                                Text(card.name)
                                    .font(.caption)
                                    .fontWeight(.medium)
                                    .lineLimit(1)
                                if let setName = card.setName {
                                    Text(setName)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            Spacer()
                        }
                    }

                    Spacer(minLength: 0)
                }
                .containerBackground(.fill.tertiary, for: .widget)
            }
        }
        .widgetURL(URL(string: "tcger://collections"))
    }

    @ViewBuilder
    private func tcgIcon(for tcg: String) -> some View {
        switch tcg.lowercased() {
        case "pokemon":
            Image(systemName: "bolt.fill")
                .font(.caption2)
                .foregroundStyle(.yellow)
        case "magic":
            Image(systemName: "sparkles")
                .font(.caption2)
                .foregroundStyle(.purple)
        case "yugioh":
            Image(systemName: "suit.club.fill")
                .font(.caption2)
                .foregroundStyle(.orange)
        default:
            Image(systemName: "rectangle.portrait.fill")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

// MARK: - Widget Declarations

struct CollectionStatsWidget: Widget {
    let kind = "CollectionStatsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: CollectionStatsProvider()) { entry in
            CollectionStatsWidgetView(entry: entry)
        }
        .configurationDisplayName("Collection Stats")
        .description("Shows your card collection statistics at a glance.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

struct RecentCardsWidget: Widget {
    let kind = "RecentCardsWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: RecentCardsProvider()) { entry in
            RecentCardsWidgetView(entry: entry)
        }
        .configurationDisplayName("Recent Cards")
        .description("Shows your most recently added cards.")
        .supportedFamilies([.systemMedium])
    }
}

#Preview("Collection Stats — Small", as: .systemSmall) {
    CollectionStatsWidget()
} timeline: {
    CollectionStatsEntry(
        date: .now,
        totalBinders: 128,
        uniqueCards: 12_593,
        totalCopies: 28_710,
        totalValue: 128_842.35,
        currencyCode: "USD",
        showPricing: true,
        lastUpdated: .now,
        hasData: true
    )
}

#Preview("Collection Stats — Medium", as: .systemMedium) {
    CollectionStatsWidget()
} timeline: {
    CollectionStatsEntry(
        date: .now,
        totalBinders: 12,
        uniqueCards: 1_259,
        totalCopies: 2_871,
        totalValue: 12_842.35,
        currencyCode: "USD",
        showPricing: true,
        lastUpdated: .now,
        hasData: true
    )
}

#Preview("Recent Cards — Medium", as: .systemMedium) {
    RecentCardsWidget()
} timeline: {
    RecentCardsEntry(
        date: .now,
        cards: [
            WidgetCardInfo(
                name: "Charizard ex — Special Illustration Rare",
                tcg: "pokemon",
                setName: "Scarlet & Violet—151",
                imageUrl: nil
            ),
            WidgetCardInfo(
                name: "Dark Magician",
                tcg: "yugioh",
                setName: "Legend of Blue Eyes White Dragon",
                imageUrl: nil
            ),
            WidgetCardInfo(
                name: "Black Lotus",
                tcg: "magic",
                setName: "Limited Edition Alpha",
                imageUrl: nil
            ),
        ],
        hasData: true
    )
}

@main
struct TCGerWidgets: WidgetBundle {
    var body: some Widget {
        CollectionStatsWidget()
        RecentCardsWidget()
        ScannerShortcutWidget()
        WishlistWidget()
        BinderWidget()
        PackOpeningShortcutWidget()
        ScannerControlWidget()
    }
}

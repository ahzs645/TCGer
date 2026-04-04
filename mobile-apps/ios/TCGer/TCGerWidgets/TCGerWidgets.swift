import WidgetKit
import SwiftUI

// MARK: - Collection Stats Widget

struct CollectionStatsEntry: TimelineEntry {
    let date: Date
    let totalBinders: Int
    let uniqueCards: Int
    let totalCopies: Int
    let hasData: Bool
}

struct CollectionStatsProvider: TimelineProvider {
    func placeholder(in context: Context) -> CollectionStatsEntry {
        CollectionStatsEntry(date: .now, totalBinders: 3, uniqueCards: 42, totalCopies: 87, hasData: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (CollectionStatsEntry) -> Void) {
        let entry = CollectionStatsEntry(
            date: .now,
            totalBinders: SharedDataReader.totalBinders,
            uniqueCards: SharedDataReader.uniqueCards,
            totalCopies: SharedDataReader.totalCopies,
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
        } else if family == .systemSmall {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "square.stack.3d.up")
                        .font(.title3)
                        .foregroundStyle(.tint)
                    Spacer()
                }

                Spacer()

                StatRow(icon: "folder.fill", value: "\(entry.totalBinders)", label: "Binders")
                StatRow(icon: "rectangle.portrait.fill", value: "\(entry.uniqueCards)", label: "Unique")
                StatRow(icon: "square.stack.fill", value: "\(entry.totalCopies)", label: "Copies")
            }
            .containerBackground(.fill.tertiary, for: .widget)
        } else {
            HStack(spacing: 16) {
                StatBlock(icon: "folder.fill", value: "\(entry.totalBinders)", label: "Binders")
                StatBlock(icon: "rectangle.portrait.fill", value: "\(entry.uniqueCards)", label: "Unique Cards")
                StatBlock(icon: "square.stack.fill", value: "\(entry.totalCopies)", label: "Total Copies")
            }
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }
}

private struct StatRow: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: icon)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .frame(width: 14)
            Text(value)
                .font(.caption)
                .fontWeight(.bold)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }
}

private struct StatBlock: View {
    let icon: String
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: icon)
                .font(.title3)
                .foregroundStyle(.tint)
            Text(value)
                .font(.title2)
                .fontWeight(.bold)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
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

@main
struct TCGerWidgets: WidgetBundle {
    var body: some Widget {
        CollectionStatsWidget()
        RecentCardsWidget()
    }
}

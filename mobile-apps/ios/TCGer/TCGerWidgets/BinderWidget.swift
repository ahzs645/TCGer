import AppIntents
import SwiftUI
import WidgetKit

struct BinderEntry: TimelineEntry {
    let date: Date
    let binder: WidgetBinderInfo?
}

struct BinderProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> BinderEntry {
        BinderEntry(date: .now, binder: .preview)
    }

    func snapshot(
        for configuration: BinderConfigurationIntent,
        in context: Context
    ) async -> BinderEntry {
        let binder = selectedBinder(for: configuration)
        return BinderEntry(
            date: .now,
            binder: context.isPreview && binder == nil ? .preview : binder
        )
    }

    func timeline(
        for configuration: BinderConfigurationIntent,
        in context: Context
    ) async -> Timeline<BinderEntry> {
        let entry = BinderEntry(date: .now, binder: selectedBinder(for: configuration))
        let nextRefresh = Calendar.current.date(byAdding: .hour, value: 1, to: .now) ?? .now
        return Timeline(entries: [entry], policy: .after(nextRefresh))
    }

    private func selectedBinder(for configuration: BinderConfigurationIntent) -> WidgetBinderInfo? {
        let binders = SharedDataReader.binders
        guard let selectedID = configuration.binder?.id else {
            return binders.first
        }
        return binders.first { $0.id == selectedID } ?? binders.first
    }
}

struct BinderWidgetView: View {
    let entry: BinderEntry

    @Environment(\.widgetFamily) private var family

    var body: some View {
        if let binder = entry.binder {
            binderView(binder)
                .widgetURL(URL(string: "tcger://binder/\(binder.id)"))
        } else {
            VStack(spacing: 8) {
                Image(systemName: "folder.circle")
                    .font(.largeTitle)
                    .foregroundStyle(.blue)
                Text("Choose a Binder")
                    .font(.headline)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Text("Open TCGer to sync your collection.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .containerBackground(.fill.tertiary, for: .widget)
            .widgetURL(URL(string: "tcger://collections"))
        }
    }

    private func binderView(_ binder: WidgetBinderInfo) -> some View {
        let tint = Color(widgetHex: binder.colorHex)

        return Group {
            switch family {
            case .systemSmall:
                smallBinder(binder, tint: tint)
            default:
                mediumBinder(binder, tint: tint)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }

    private func smallBinder(_ binder: WidgetBinderInfo, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            binderTitle(binder.name, tint: tint, compact: true)

            Spacer(minLength: 0)

            Text(compactCount(binder.uniqueCards))
                .font(.title2.monospacedDigit().weight(.bold))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
            Text("unique cards")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)

            HStack(spacing: 5) {
                Label(compactCount(binder.totalCopies), systemImage: "square.stack.fill")
                if let totalValue = binder.totalValue {
                    Text("·")
                    Text(formattedValue(totalValue))
                }
            }
            .font(.caption2.weight(.semibold))
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
    }

    private func mediumBinder(_ binder: WidgetBinderInfo, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            binderTitle(binder.name, tint: tint)

            Spacer(minLength: 0)

            HStack(spacing: 10) {
                BinderStat(value: compactCount(binder.uniqueCards), label: "Unique", tint: tint)
                BinderStat(value: compactCount(binder.totalCopies), label: "Copies", tint: tint)
                if let totalValue = binder.totalValue {
                    BinderStat(value: formattedValue(totalValue), label: "Value", tint: tint)
                }
            }
        }
    }

    private func binderTitle(
        _ name: String,
        tint: Color,
        compact: Bool = false
    ) -> some View {
        HStack(spacing: 7) {
            Image(systemName: "folder.fill")
                .font(.title3)
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

    private func compactCount(_ value: Int) -> String {
        value.formatted(.number.notation(.compactName))
    }

    private func formattedValue(_ value: Double) -> String {
        "$" + value.formatted(.number.notation(.compactName).precision(.fractionLength(0...1)))
    }
}

private struct BinderStat: View {
    let value: String
    let label: String
    let tint: Color

    var body: some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.title3)
                .fontWeight(.bold)
                .minimumScaleFactor(0.65)
                .lineLimit(1)
                .foregroundStyle(tint)
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .widgetAccentable()
    }
}

private extension WidgetBinderInfo {
    static let preview = WidgetBinderInfo(
        id: "binder-preview",
        name: "Pokémon Favorites",
        uniqueCards: 126,
        totalCopies: 184,
        totalValue: 842.35,
        colorHex: "#007AFF"
    )
}

struct BinderWidget: Widget {
    let kind = "BinderWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: BinderConfigurationIntent.self,
            provider: BinderProvider()
        ) { entry in
            BinderWidgetView(entry: entry)
        }
        .configurationDisplayName("Binder Snapshot")
        .description("Keep an eye on a favorite binder.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

#Preview("Binder — Small", as: .systemSmall) {
    BinderWidget()
} timeline: {
    BinderEntry(date: .now, binder: .preview)
}

#Preview("Binder — Medium", as: .systemMedium) {
    BinderWidget()
} timeline: {
    BinderEntry(date: .now, binder: .preview)
}

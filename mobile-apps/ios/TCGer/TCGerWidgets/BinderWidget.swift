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

        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 7) {
                Image(systemName: "folder.fill")
                    .font(.title3)
                    .foregroundStyle(tint)
                Text(binder.name)
                    .font(.headline)
                    .fontWeight(.bold)
                    .lineLimit(2)
                Spacer(minLength: 0)
            }

            Spacer(minLength: 0)

            if family == .systemMedium {
                HStack(spacing: 12) {
                    BinderStat(value: "\(binder.uniqueCards)", label: "Unique", tint: tint)
                    BinderStat(value: "\(binder.totalCopies)", label: "Copies", tint: tint)
                    if let totalValue = binder.totalValue {
                        BinderStat(
                            value: "$\(String(format: "%.2f", totalValue))",
                            label: "Value",
                            tint: tint
                        )
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 5) {
                    Label("\(binder.uniqueCards) unique cards", systemImage: "rectangle.portrait.fill")
                    Label(totalCopyText(binder.totalCopies), systemImage: "square.stack.fill")
                    if let totalValue = binder.totalValue {
                        Label("$\(String(format: "%.2f", totalValue))", systemImage: "dollarsign.circle.fill")
                    }
                }
                .font(.caption)
                .fontWeight(.semibold)
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
    }
}

private func totalCopyText(_ count: Int) -> String {
    "\(count) total \(count == 1 ? "copy" : "copies")"
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

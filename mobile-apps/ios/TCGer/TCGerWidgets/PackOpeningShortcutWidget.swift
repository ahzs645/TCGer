import SwiftUI
import WidgetKit

struct PackOpeningShortcutEntry: TimelineEntry {
    let date: Date
}

struct PackOpeningShortcutProvider: TimelineProvider {
    func placeholder(in context: Context) -> PackOpeningShortcutEntry {
        PackOpeningShortcutEntry(date: .now)
    }

    func getSnapshot(
        in context: Context,
        completion: @escaping (PackOpeningShortcutEntry) -> Void
    ) {
        completion(PackOpeningShortcutEntry(date: .now))
    }

    func getTimeline(
        in context: Context,
        completion: @escaping (Timeline<PackOpeningShortcutEntry>) -> Void
    ) {
        completion(Timeline(entries: [PackOpeningShortcutEntry(date: .now)], policy: .never))
    }
}

struct PackOpeningShortcutWidgetView: View {
    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(.orange.opacity(0.16))
                Circle()
                    .stroke(.orange.opacity(0.36), lineWidth: 2)
                Image(systemName: "shippingbox.and.arrow.backward.fill")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.orange)
            }
            .frame(width: 70, height: 70)
            .widgetAccentable()

            VStack(spacing: 2) {
                Text("Open a Pack")
                    .font(.headline.weight(.bold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Text("Choose and reveal")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(URL(string: "tcger://packs"))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Open a pack in TCGer")
    }
}

struct PackOpeningShortcutWidget: Widget {
    let kind = "PackOpeningShortcutWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PackOpeningShortcutProvider()) { _ in
            PackOpeningShortcutWidgetView()
        }
        .configurationDisplayName("Open a Pack")
        .description("Jump straight into TCGer's pack-opening experience.")
        .supportedFamilies([.systemSmall])
    }
}

#Preview("Open a Pack", as: .systemSmall) {
    PackOpeningShortcutWidget()
} timeline: {
    PackOpeningShortcutEntry(date: .now)
}

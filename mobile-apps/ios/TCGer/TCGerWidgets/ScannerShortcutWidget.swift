import AppIntents
import SwiftUI
import WidgetKit

struct ScannerShortcutEntry: TimelineEntry {
    let date: Date
    let game: ScannerWidgetGame
}

struct ScannerShortcutProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> ScannerShortcutEntry {
        ScannerShortcutEntry(date: .now, game: .pokemon)
    }

    func snapshot(
        for configuration: ScannerShortcutConfigurationIntent,
        in context: Context
    ) async -> ScannerShortcutEntry {
        ScannerShortcutEntry(date: .now, game: configuration.game)
    }

    func timeline(
        for configuration: ScannerShortcutConfigurationIntent,
        in context: Context
    ) async -> Timeline<ScannerShortcutEntry> {
        Timeline(
            entries: [ScannerShortcutEntry(date: .now, game: configuration.game)],
            policy: .never
        )
    }
}

struct ScannerShortcutWidgetView: View {
    let entry: ScannerShortcutEntry

    @Environment(\.widgetFamily) private var family

    private var tint: Color {
        Color(widgetHex: entry.game.accentHex)
    }

    var body: some View {
        Group {
            if family == .accessoryCircular {
                ZStack {
                    Circle()
                        .stroke(tint.opacity(0.45), lineWidth: 3)
                    Image(systemName: "camera.viewfinder")
                        .font(.system(size: 25, weight: .bold))
                        .foregroundStyle(tint)
                }
                .containerBackground(.clear, for: .widget)
            } else {
                VStack(spacing: 10) {
                    ZStack {
                        Circle()
                            .fill(tint.opacity(0.16))
                        Circle()
                            .stroke(tint.opacity(0.35), lineWidth: 2)
                        Image(systemName: "camera.viewfinder")
                            .font(.system(size: 38, weight: .bold))
                            .foregroundStyle(tint)
                    }
                    .frame(width: 72, height: 72)

                    VStack(spacing: 2) {
                        Text(entry.game.displayName)
                            .font(.headline)
                            .fontWeight(.bold)
                            .lineLimit(1)
                        Text("Open Scanner")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .containerBackground(.fill.tertiary, for: .widget)
            }
        }
        .widgetURL(entry.game.deepLinkURL)
    }
}

struct ScannerShortcutWidget: Widget {
    let kind = "ScannerShortcutWidget"

    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: kind,
            intent: ScannerShortcutConfigurationIntent.self,
            provider: ScannerShortcutProvider()
        ) { entry in
            ScannerShortcutWidgetView(entry: entry)
        }
        .configurationDisplayName("Scanner Shortcut")
        .description("Open TCGer's scanner for your favorite card game.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

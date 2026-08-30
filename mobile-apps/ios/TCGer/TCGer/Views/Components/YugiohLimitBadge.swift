import SwiftUI

struct YugiohLimitBadge: View {
    let entry: YugiohBanlistEntry
    var compact = false

    private var color: Color {
        switch entry.status {
        case "forbidden": .red
        case "limited": .orange
        default: .yellow
        }
    }

    private var label: String {
        if compact { return entry.limit == 0 ? "0" : "×\(entry.limit)" }
        switch entry.status {
        case "forbidden": return "Forbidden"
        case "limited": return "Limited · 1"
        default: return "Semi-Limited · 2"
        }
    }

    var body: some View {
        Label(label, systemImage: entry.limit == 0 ? "nosign" : "exclamationmark.triangle.fill")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, compact ? 6 : 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.14), in: Capsule())
            .accessibilityLabel("\(entry.cardName), \(entry.status), limit \(entry.limit)")
    }
}

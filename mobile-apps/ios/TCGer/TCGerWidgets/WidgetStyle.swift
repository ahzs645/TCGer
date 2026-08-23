import Foundation
import SwiftUI
import WidgetKit

extension Color {
    init(widgetHex hex: String, fallback: Color = .accentColor) {
        let value = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        guard value.count == 6, let rgb = UInt64(value, radix: 16) else {
            self = fallback
            return
        }

        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

struct WidgetProgressRing: View {
    let percent: Int
    let tint: Color

    private var progress: Double {
        min(max(Double(percent) / 100, 0), 1)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(tint.opacity(0.18), lineWidth: 7)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(tint, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                .rotationEffect(.degrees(-90))
            Text("\(min(max(percent, 0), 100))%")
                .font(.caption2)
                .fontWeight(.bold)
                .minimumScaleFactor(0.7)
        }
        .widgetAccentable()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(percent) percent complete")
    }
}

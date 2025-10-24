import SwiftUI

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 3: // RGB (12-bit)
            (a, r, g, b) = (255, (int >> 8) * 17, (int >> 4 & 0xF) * 17, (int & 0xF) * 17)
        case 6: // RGB (24-bit)
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB (32-bit)
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }

        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue:  Double(b) / 255,
            opacity: Double(a) / 255
        )
    }

    func toHex() -> String {
        let components = UIColor(self).cgColor.components
        let r = components?[0] ?? 0
        let g = components?[1] ?? 0
        let b = components?[2] ?? 0

        return String(format: "%02lX%02lX%02lX",
                     lround(Double(r * 255)),
                     lround(Double(g * 255)),
                     lround(Double(b * 255)))
    }
}

// Predefined binder colors matching CardWizz
extension Color {
    static let binderColors: [Color] = [
        // Blues
        Color(hex: "90CAF9"),
        Color(hex: "42A5F5"),
        Color(hex: "1976D2"),
        // Greens
        Color(hex: "81C784"),
        Color(hex: "66BB6A"),
        Color(hex: "388E3C"),
        // Oranges & Yellows
        Color(hex: "FFB74D"),
        Color(hex: "FFA726"),
        Color(hex: "FBC02D"),
        // Reds & Pinks
        Color(hex: "E57373"),
        Color(hex: "F06292"),
        Color(hex: "EC407A"),
        // Purples
        Color(hex: "BA68C8"),
        Color(hex: "9575CD"),
        Color(hex: "7E57C2"),
        // Others
        Color(hex: "4DB6AC"),
        Color(hex: "26A69A"),
        Color(hex: "78909C"),
    ]
}

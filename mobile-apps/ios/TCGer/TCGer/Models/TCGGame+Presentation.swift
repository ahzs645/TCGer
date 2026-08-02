import SwiftUI

extension TCGGame {
    var brandColor: Color {
        switch self {
        case .all:
            return Color(red: 138 / 255, green: 138 / 255, blue: 146 / 255)
        case .yugioh:
            return Color(red: 108 / 255, green: 74 / 255, blue: 176 / 255)
        case .magic:
            return Color(red: 165 / 255, green: 115 / 255, blue: 44 / 255)
        case .pokemon:
            return Color(red: 61 / 255, green: 125 / 255, blue: 202 / 255)
        case .onepiece:
            return Color(red: 205 / 255, green: 47 / 255, blue: 58 / 255)
        case .lorcana:
            return Color(red: 176 / 255, green: 141 / 255, blue: 47 / 255)
        case .dragonball:
            return Color(red: 232 / 255, green: 100 / 255, blue: 27 / 255)
        }
    }
}

import SwiftUI

extension EnvironmentStore {
    var gamePickerGames: [TCGGame] {
        [.all] + enabledGames
    }
}

struct TCGGameIcon: View {
    let game: TCGGame
    var size: CGFloat = 14

    var body: some View {
        Group {
            if let iconName = game.iconName {
                Image(iconName)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: game.systemIconName)
                    .font(.system(size: size))
            }
        }
        .frame(width: size, height: size)
    }
}

struct GamePickerPills: View {
    @Binding var selection: TCGGame
    let games: [TCGGame]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(games) { game in
                    Button {
                        selection = game
                    } label: {
                        HStack(spacing: 6) {
                            TCGGameIcon(game: game)
                            Text(game.shortName)
                                .font(.subheadline)
                                .fontWeight(.medium)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(selection == game ? selectedColor(for: game) : Color(.systemGray5))
                        .foregroundStyle(selection == game ? Color.white : Color.primary)
                        .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 12)
        }
    }

    private func selectedColor(for game: TCGGame) -> Color {
        game == .all ? .accentColor : game.brandColor
    }
}

struct GamePickerMenu: View {
    @Binding var selection: TCGGame
    let games: [TCGGame]

    var body: some View {
        Menu {
            ForEach(games) { game in
                Button {
                    selection = game
                } label: {
                    Label {
                        HStack {
                            Text(game.shortName)
                            if selection == game {
                                Image(systemName: "checkmark")
                            }
                        }
                    } icon: {
                        if let iconName = game.iconName {
                            Image(iconName)
                        } else {
                            Image(systemName: game.systemIconName)
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 6) {
                TCGGameIcon(game: selection)
                Text(selection.shortName)
                Image(systemName: "chevron.down")
                    .font(.caption2.weight(.semibold))
            }
        }
    }
}

struct GameBadge: View {
    let tcg: String
    let showsName: Bool

    init(tcg: String, showsName: Bool = false) {
        self.tcg = tcg
        self.showsName = showsName
    }

    private var game: TCGGame? {
        TCGGame(rawValue: tcg.lowercased())
    }

    private var badgeColor: Color {
        game?.brandColor ?? .gray
    }

    var body: some View {
        HStack(spacing: 4) {
            if let game {
                TCGGameIcon(game: game, size: 11)
                if showsName {
                    Text(game.shortName)
                }
            } else {
                Text(tcg.prefix(3).uppercased())
            }
        }
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(badgeColor)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(badgeColor.opacity(0.15))
        .clipShape(Capsule())
        .accessibilityLabel(game?.shortName ?? tcg)
    }
}

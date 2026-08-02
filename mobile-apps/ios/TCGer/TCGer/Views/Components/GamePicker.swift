import SwiftUI

extension EnvironmentStore {
    var gamePickerGames: [TCGGame] {
        [.all] + enabledGames
    }
}

func gameSectionIsOrderedBefore(
    _ left: String,
    _ right: String,
    enabledGames: [TCGGame]
) -> Bool {
    let leftIndex = enabledGames.firstIndex { $0.rawValue == left.lowercased() }
    let rightIndex = enabledGames.firstIndex { $0.rawValue == right.lowercased() }

    switch (leftIndex, rightIndex) {
    case let (leftIndex?, rightIndex?):
        if leftIndex != rightIndex {
            return leftIndex < rightIndex
        }
    case (_?, nil):
        return true
    case (nil, _?):
        return false
    case (nil, nil):
        break
    }

    return left.localizedCaseInsensitiveCompare(right) == .orderedAscending
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
        .accessibilityHidden(true)
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
                        .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selection == game ? [.isSelected] : [])
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
            Picker("Game", selection: $selection) {
                ForEach(games) { game in
                    Label {
                        Text(game.shortName)
                    } icon: {
                        Image(systemName: game.systemIconName)
                    }
                    .tag(game)
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
        .font(.system(size: 10, weight: .semibold))
        .foregroundStyle(badgeColor)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(badgeColor.opacity(0.15))
        .clipShape(Capsule())
        .accessibilityLabel(game?.shortName ?? tcg)
    }
}

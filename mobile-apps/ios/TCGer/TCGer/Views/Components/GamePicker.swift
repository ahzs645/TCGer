import SwiftUI

extension EnvironmentStore {
    var shouldShowGamePicker: Bool {
        enabledGames.count > 1
    }

    var singleEnabledGame: TCGGame? {
        enabledGames.count == 1 ? enabledGames.first : nil
    }

    var gamePickerGames: [TCGGame] {
        [.all] + enabledGames
    }

    /// Keeps a stored game filter valid as modules are enabled or disabled.
    /// With one enabled game, "All" is redundant and resolves to that game.
    func resolvedGameSelection(_ selection: TCGGame) -> TCGGame {
        if let singleEnabledGame {
            return singleEnabledGame
        }
        if selection == .all || enabledGames.contains(selection) {
            return selection
        }
        return .all
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
            GlassEffectContainer(spacing: 12) {
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
                            .foregroundStyle(selection == game ? Color.white : Color.primary)
                            .contentShape(Capsule())
                            .glassEffect(
                                selection == game
                                    ? .regular.tint(selectedColor(for: game)).interactive()
                                    : .regular.interactive(),
                                in: .capsule
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(selection == game ? [.isSelected] : [])
                    }
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

/// Standard label for a game in menus and pickers: short name (or custom
/// text) plus the game icon. Use this instead of hand-rolling Label rows.
struct GameLabel: View {
    let game: TCGGame
    var text: String? = nil

    var body: some View {
        Label {
            Text(text ?? game.shortName)
        } icon: {
            TCGGameIcon(game: game)
        }
    }
}

struct GamePickerMenu: View {
    @Binding var selection: TCGGame
    let games: [TCGGame]

    var body: some View {
        Menu {
            Picker("Game", selection: $selection) {
                ForEach(games) { game in
                    GameLabel(game: game)
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
        .font(.caption2)
        .fontWeight(.semibold)
        .foregroundStyle(badgeColor)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(badgeColor.opacity(0.15))
        .clipShape(Capsule())
        .accessibilityLabel(game?.shortName ?? tcg)
    }
}

import SwiftUI

struct SetBrowserView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var sets: [TcgSet] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all

    private let apiService = APIService()

    var availableGames: [TCGGame] {
        var games: [TCGGame] = [.all]
        games.append(contentsOf: environmentStore.enabledGames)
        return games
    }

    var filteredSets: [TcgSet] {
        var result = sets

        if selectedGame != .all {
            result = result.filter { $0.tcg == selectedGame.rawValue }
        }

        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let query = searchText.lowercased()
            result = result.filter {
                $0.name.lowercased().contains(query) ||
                $0.code.lowercased().contains(query)
            }
        }

        return result
    }

    var groupedSets: [(String, [TcgSet])] {
        let groups = Dictionary(grouping: filteredSets, by: { $0.tcg })
        return groups.sorted { $0.key < $1.key }
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                if environmentStore.enabledGames.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(availableGames) { game in
                                SetGameFilterChip(
                                    game: game,
                                    isSelected: selectedGame == game
                                ) {
                                    selectedGame = game
                                }
                            }
                        }
                        .padding(.horizontal)
                        .padding(.vertical, 12)
                    }
                    .background(Color(.systemBackground))
                    Divider()
                }

                if isLoading {
                    ProgressView("Loading sets...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 50))
                            .foregroundColor(.orange)
                        Text("Failed to Load Sets")
                            .font(.headline)
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        Button("Try Again") {
                            Task { await loadSets() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if filteredSets.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "tray")
                            .font(.system(size: 50))
                            .foregroundColor(.secondary)
                        Text("No Sets Found")
                            .font(.title3)
                            .fontWeight(.semibold)
                        Text("Try a different search or game filter.")
                            .font(.body)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(groupedSets, id: \.0) { tcg, tcgSets in
                            Section {
                                ForEach(tcgSets) { set in
                                    NavigationLink {
                                        SetDetailView(set: set)
                                            .environmentObject(environmentStore)
                                    } label: {
                                        SetRow(set: set)
                                    }
                                }
                            } header: {
                                Text(TCGGame(rawValue: tcg)?.displayName ?? tcg.uppercased())
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Sets")
            .searchable(text: $searchText, prompt: "Search sets...")
            .task {
                await loadSets()
            }
        }
    }

    @MainActor
    private func loadSets() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            sets = try await apiService.getSets(
                config: environmentStore.serverConfiguration,
                token: token
            )
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
}

// MARK: - Set Row
private struct SetRow: View {
    let set: TcgSet

    var body: some View {
        HStack(spacing: 12) {
            if let iconUrl = set.iconUrl, let url = URL(string: iconUrl) {
                CachedAsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .empty, .failure:
                        Image(systemName: "square.stack.3d.up")
                            .foregroundColor(.secondary)
                    @unknown default:
                        Image(systemName: "square.stack.3d.up")
                            .foregroundColor(.secondary)
                    }
                }
                .frame(width: 32, height: 32)
            } else {
                Image(systemName: "square.stack.3d.up")
                    .font(.title3)
                    .foregroundColor(.secondary)
                    .frame(width: 32, height: 32)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(set.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    Text(set.code.uppercased())
                        .font(.caption2)
                        .fontWeight(.semibold)
                        .foregroundColor(.accentColor)

                    if let totalCards = set.totalCards {
                        Text("\(totalCards) cards")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }

                    if let releaseDate = set.releaseDate {
                        Text(releaseDate)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Game Filter Chip
private struct SetGameFilterChip: View {
    let game: TCGGame
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let customIcon = game.iconName {
                    Image(customIcon)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 14, height: 14)
                        .foregroundColor(isSelected ? .white : .accentColor)
                } else {
                    Image(systemName: game.systemIconName)
                        .font(.caption)
                        .foregroundColor(isSelected ? .white : .primary)
                }
                Text(game.displayName)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(isSelected ? Color.accentColor : Color(.systemGray5))
            .foregroundColor(isSelected ? .white : .primary)
            .cornerRadius(20)
        }
    }
}

import SwiftUI

struct SelectPrintSheet: View {
    let card: Card
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @Binding var selectedPrint: Card?
    let onCancel: (() -> Void)?

    @State private var draftSelection: Card?
    @State private var prints: [Card] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let apiService = APIService()

    init(
        card: Card,
        selectedPrint: Binding<Card?>,
        initialPrints: [Card]? = nil,
        onCancel: (() -> Void)? = nil
    ) {
        self.card = card
        self._selectedPrint = selectedPrint
        self._draftSelection = State(initialValue: selectedPrint.wrappedValue ?? card)
        self.onCancel = onCancel
        if let initialPrints {
            self._prints = State(initialValue: initialPrints)
            self._isLoading = State(initialValue: false)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading prints...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = errorMessage {
                    ErrorView(title: "Failed to Load Prints", message: error)
                } else if prints.isEmpty {
                    EmptyPrintsView()
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 18) {
                            if !worldChampionshipPrints.isEmpty {
                                printSection(
                                    title: "World Championship Versions",
                                    subtitle: "Official replica cards with a printed signature and championship card back.",
                                    prints: worldChampionshipPrints
                                )
                            }

                            if !standardPrints.isEmpty {
                                printSection(
                                    title: worldChampionshipPrints.isEmpty ? nil : "Other Printings",
                                    subtitle: nil,
                                    prints: standardPrints
                                )
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Select a Print")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        onCancel?()
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use This Print") {
                        selectedPrint = draftSelection
                        dismiss()
                    }
                    .disabled(isLoading || draftSelection == nil)
                }
            }
        }
        .task {
            if isLoading {
                await loadPrints()
            }
        }
    }

    private var worldChampionshipPrints: [Card] {
        prints
            .filter { $0.pokemonPrint?.worldChampionship != nil }
            .sorted {
                let left = $0.pokemonPrint?.worldChampionship?.year ?? 0
                let right = $1.pokemonPrint?.worldChampionship?.year ?? 0
                if left != right { return left > right }
                return ($0.pokemonPrint?.worldChampionship?.playerName ?? "")
                    .localizedCaseInsensitiveCompare(
                        $1.pokemonPrint?.worldChampionship?.playerName ?? ""
                    ) == .orderedAscending
            }
    }

    private var standardPrints: [Card] {
        prints.filter { $0.pokemonPrint?.worldChampionship == nil }
    }

    @ViewBuilder
    private func printSection(
        title: String?,
        subtitle: String?,
        prints: [Card]
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title)
                    .font(.headline)
            }
            if let subtitle {
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            ForEach(prints) { print in
                PrintRow(
                    print: print,
                    isSelected: draftSelection?.id == print.id,
                    onTap: { draftSelection = print }
                )
            }
        }
    }

    @MainActor
    private func loadPrints() async {
        let token: String
        if environmentStore.serverConfiguration.isOnDevice {
            token = environmentStore.authToken ?? ""
        } else if let authToken = environmentStore.authToken {
            token = authToken
        } else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        var loadedPrints: [Card] = []
        var loadingError: Error?

        do {
            loadedPrints = try await apiService.getCardPrints(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: card.tcg,
                cardId: card.id
            )
        } catch {
            loadingError = error
        }

        do {
            let game = TCGGame(rawValue: card.tcg) ?? .all
            let namedPrints = try await apiService.searchAllCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: card.name,
                game: game,
                includeAllPrintings: true,
                limit: 500
            )
            let exactName = SearchTextNormalizer.key(card.name)
            loadedPrints.append(contentsOf: namedPrints.filter {
                SearchTextNormalizer.key($0.name) == exactName
            })
        } catch {
            loadingError = loadingError ?? error
        }

        var seenIDs: Set<String> = []
        prints = loadedPrints.filter { seenIDs.insert($0.id).inserted }

        if prints.isEmpty, let loadingError {
            errorMessage = loadingError.localizedDescription
            isLoading = false
            return
        }

        // If current selected print is in the list, keep it selected;
        // otherwise select the scanned printing when available.
        if !prints.contains(where: { $0.id == draftSelection?.id }) {
            draftSelection = prints.first(where: { $0.id == card.id }) ?? prints.first ?? card
        }

        isLoading = false
    }
}

// MARK: - Print Row
private struct PrintRow: View {
    let print: Card
    let isSelected: Bool
    let onTap: () -> Void

    private var printDetails: String {
        var parts: [String] = []

        if let collectorNumber = print.collectorNumber {
            parts.append("#\(collectorNumber)")
        }

        if let rarity = print.rarity {
            parts.append(rarity)
        }

        if let regulationMark = print.regulationMark {
            parts.append("Reg \(regulationMark)")
        }

        if let year = print.pokemonPrint?.worldChampionship?.year {
            parts.append(String(year))
        } else if let releasedAt = print.releasedAt {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy"
            let year = formatter.string(from: releasedAt)
            parts.append(year)
        }

        return parts.joined(separator: " • ")
    }

    var body: some View {
        HStack(spacing: 12) {
            CardArtworkImage(card: print, useFullResolution: false)
                .frame(width: 44, height: 64)

            // Print info
            VStack(alignment: .leading, spacing: 4) {
                Text(print.setName ?? print.setCode ?? "Unknown set")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundColor(.primary)

                if !printDetails.isEmpty {
                    Text(printDetails)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let worlds = print.pokemonPrint?.worldChampionship {
                    Text([worlds.playerName, worlds.deckName].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)

                    HStack(spacing: 6) {
                        printBadge("Replica", color: .orange)
                        if print.sanctionedPlayLegal == false {
                            printBadge("Not tournament legal", color: .red)
                        }
                        if let stamp = worlds.stamp {
                            printBadge(PokemonFinishOption.label(for: stamp), color: .yellow)
                        }
                    }
                }

                let finishes = PokemonFinishOption.options(for: print)
                if !finishes.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(finishes) { finish in
                                Text(finish.label)
                                    .font(.caption2)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 3)
                                    .background(Color.accentColor.opacity(0.12))
                                    .foregroundColor(.accentColor)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }

            Spacer()

            // Selection indicator
            if isSelected {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundColor(.accentColor)
                    .font(.title3)
            }
        }
        .padding()
        .background(isSelected ? Color.accentColor.opacity(0.1) : Color(.systemGray6))
        .cornerRadius(12)
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 2)
        )
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
        .cardPreviewContextMenu(card: print, onSelect: onTap)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityHint("Double tap to choose this print. Long press to preview the artwork.")
    }

    private func printBadge(_ label: String, color: Color) -> some View {
        Text(label)
            .font(.caption2)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .foregroundStyle(color)
            .background(color.opacity(0.12))
            .clipShape(Capsule())
    }
}

// MARK: - Empty Prints View
private struct EmptyPrintsView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.stack")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("No Prints Found")
                .font(.title2)
                .fontWeight(.semibold)
            Text("This card doesn't have multiple printings available.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

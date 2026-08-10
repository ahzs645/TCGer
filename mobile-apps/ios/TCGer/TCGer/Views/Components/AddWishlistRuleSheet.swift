import SwiftUI

/// Builds a wishlist in bulk: every printing of a name ("every Darkrai") or
/// every card in a set. Optionally saves the choice as a rule so the wishlist
/// keeps picking up new printings later.
struct AddWishlistRuleSheet: View {
    let wishlist: Wishlist
    var onComplete: (() -> Void)?

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss

    enum Mode: String, CaseIterable, Identifiable {
        case name = "By name"
        case set = "Whole set"

        var id: String { rawValue }
    }

    @State private var mode: Mode = .name
    @State private var query = ""
    @State private var selectedGame: TCGGame = .all
    @State private var includeAllPrintings = true
    @State private var keepUpdated = true

    @State private var setGame: TCGGame = .all
    @State private var sets: [TcgSet] = []
    @State private var selectedSetCode: String = ""
    @State private var isLoadingSets = false

    @State private var isWorking = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?

    private let apiService = APIService()

    private var availableGames: [TCGGame] {
        environmentStore.enabledGames
    }

    private var preferredDefaultGame: TCGGame? {
        if let defaultGame = environmentStore.defaultGame,
           let game = TCGGame(rawValue: defaultGame),
           availableGames.contains(game) {
            return game
        }
        return nil
    }

    private var preferredSetGame: TCGGame? {
        preferredDefaultGame ?? availableGames.first
    }

    private var canSubmit: Bool {
        switch mode {
        case .name:
            return !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .set:
            return !selectedSetCode.isEmpty
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Mode", selection: $mode) {
                        ForEach(Mode.allCases) { option in
                            Text(option.rawValue).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                if mode == .name {
                    Section {
                        TextField("Card name, e.g. Darkrai", text: $query)
                            .autocorrectionDisabled()
                            .textInputAutocapitalization(.words)

                        Picker("Game", selection: $selectedGame) {
                            ForEach(environmentStore.gamePickerGames) { game in
                                GameLabel(game: game)
                                    .tag(game)
                            }
                        }

                        Toggle("Every printing", isOn: $includeAllPrintings)
                    } header: {
                        Text("Match")
                    } footer: {
                        Text(includeAllPrintings
                             ? "Adds every printing of every card whose name matches."
                             : "Adds one entry per distinct card.")
                    }
                } else {
                    Section {
                        Picker("Game", selection: $setGame) {
                            ForEach(availableGames) { game in
                                GameLabel(game: game)
                                    .tag(game)
                            }
                        }
                        .onChange(of: setGame) {
                            selectedSetCode = ""
                            if mode == .set {
                                Task { await loadSets() }
                            }
                        }

                        if isLoadingSets {
                            HStack {
                                ProgressView().scaleEffect(0.8)
                                Text("Loading sets…")
                                    .foregroundColor(.secondary)
                            }
                        } else if sets.isEmpty {
                            Text("No sets available for this game.")
                                .foregroundColor(.secondary)
                        } else {
                            Picker("Set", selection: $selectedSetCode) {
                                Text("Choose a set").tag("")
                                ForEach(sets) { set in
                                    Text(set.totalCards.map { "\(set.name) (\($0))" } ?? set.name)
                                        .tag(set.code)
                                }
                            }
                        }
                    } header: {
                        Text("Set")
                    }
                }

                Section {
                    Toggle("Keep this wishlist updated", isOn: $keepUpdated)
                } footer: {
                    Text("Saves this as a rule. Tap Sync on the wishlist to pull in cards printed later.")
                }

                if let statusMessage {
                    Section {
                        Text(statusMessage)
                            .font(.footnote)
                            .foregroundColor(.secondary)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Add in Bulk")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isWorking)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isWorking ? "Adding…" : "Add") {
                        Task { await submit() }
                    }
                    .disabled(!canSubmit || isWorking)
                }
            }
            .task {
                selectedGame = preferredDefaultGame ?? .all
                setGame = preferredSetGame ?? .all
                if mode == .set { await loadSets() }
            }
            .onChange(of: mode) {
                if mode == .set && sets.isEmpty {
                    Task { await loadSets() }
                }
            }
        }
    }

    @MainActor
    private func loadSets() async {
        guard let token = environmentStore.authToken,
              availableGames.contains(setGame) else { return }
        isLoadingSets = true
        defer { isLoadingSets = false }

        do {
            sets = try await apiService.getSets(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: setGame.rawValue
            )
        } catch {
            errorMessage = error.localizedDescription
            sets = []
        }
    }

    @MainActor
    private func submit() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        isWorking = true
        errorMessage = nil
        defer { isWorking = false }

        let sync = WishlistSyncService(
            apiService: apiService,
            config: environmentStore.serverConfiguration,
            token: token,
            enabledGames: environmentStore.enabledGames
        )

        let now = ISO8601DateFormatter().string(from: Date())
        let draft: WishlistRule
        switch mode {
        case .name:
            draft = WishlistRule(
                id: "draft",
                type: .name,
                tcg: selectedGame == .all ? nil : selectedGame.rawValue,
                query: query.trimmingCharacters(in: .whitespacesAndNewlines),
                setCode: nil,
                setName: nil,
                includeAllPrintings: includeAllPrintings,
                autoSync: true,
                lastSyncedAt: nil,
                lastMatchCount: nil,
                createdAt: now,
                updatedAt: now
            )
        case .set:
            let set = sets.first { $0.code == selectedSetCode }
            draft = WishlistRule(
                id: "draft",
                type: .set,
                tcg: setGame.rawValue,
                query: nil,
                setCode: selectedSetCode,
                setName: set?.name,
                includeAllPrintings: true,
                autoSync: true,
                lastSyncedAt: nil,
                lastMatchCount: nil,
                createdAt: now,
                updatedAt: now
            )
        }

        do {
            // Expand first: a rule that matches nothing should not be saved.
            let added = try await sync.apply(
                rule: draft,
                to: wishlist,
                recordSync: false,
                onProgress: { message in
                    Task { @MainActor in statusMessage = message }
                }
            )

            if keepUpdated {
                _ = try await apiService.addWishlistRule(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    wishlistId: wishlist.id,
                    type: draft.type,
                    tcg: draft.tcg,
                    query: draft.query,
                    setCode: draft.setCode,
                    setName: draft.setName,
                    includeAllPrintings: draft.includeAllPrintings,
                    autoSync: true
                )
            }

            HapticManager.notification(.success)
            onComplete?()
            statusMessage = added.isEmpty
                ? "Already tracking every match."
                : "Added \(added.count) card\(added.count == 1 ? "" : "s")."
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            statusMessage = nil
        }
    }
}

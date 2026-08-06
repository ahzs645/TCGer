import SwiftUI

struct WishlistDetailView: View {
    let wishlist: Wishlist
    var onUpdate: (() -> Void)?
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var cards: [WishlistCard]
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showingAddCards = false
    @State private var isEditing = false
    @State private var editedName: String
    @State private var editedDescription: String
    @State private var selectedColor: Color
    @State private var editedMatchAnyPrinting: Bool
    @State private var isSaving = false
    @State private var showingDeleteConfirmation = false
    @State private var searchText = ""
    @State private var filterOwned: OwnershipFilter = .all
    @State private var rules: [WishlistRule]
    @State private var showingBulkAdd = false
    @State private var isSyncing = false
    @State private var syncStatus: String?

    enum OwnershipFilter: String, CaseIterable {
        case all = "All"
        case owned = "Owned"
        case needed = "Needed"
    }

    private let apiService = APIService()

    init(wishlist: Wishlist, onUpdate: (() -> Void)? = nil) {
        self.wishlist = wishlist
        self.onUpdate = onUpdate
        _cards = State(initialValue: wishlist.cards)
        _rules = State(initialValue: wishlist.expansionRules)
        _editedName = State(initialValue: wishlist.name)
        _editedDescription = State(initialValue: wishlist.description ?? "")
        _selectedColor = State(initialValue: Color.fromHex(wishlist.colorHex))
        _editedMatchAnyPrinting = State(initialValue: wishlist.matchesAnyPrinting)
    }

    private var filteredCards: [WishlistCard] {
        var result = cards

        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let query = searchText.lowercased()
            result = result.filter {
                $0.name.lowercased().contains(query) ||
                ($0.setName?.lowercased().contains(query) ?? false)
            }
        }

        switch filterOwned {
        case .all: break
        case .owned: result = result.filter { $0.owned }
        case .needed: result = result.filter { !$0.owned }
        }

        return result
    }

    private var ownedCount: Int { cards.filter(\.owned).count }
    private var totalCount: Int { cards.count }
    private var completionPercent: Int {
        totalCount > 0 ? Int((Double(ownedCount) / Double(totalCount)) * 100) : 0
    }

    var body: some View {
        NavigationView {
            List {
                // Header — only rendered when it has content, otherwise the
                // section shows up as an empty card under the navigation title.
                if isEditing {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            InlineNameDescriptionColorEditor(
                                namePlaceholder: "Wishlist Name",
                                name: $editedName,
                                description: $editedDescription,
                                selectedColor: $selectedColor
                            )
                        }
                        .listRowSeparator(.hidden)
                    }
                    Section {
                        Toggle("Any printing counts as owned", isOn: $editedMatchAnyPrinting)
                    } footer: {
                        Text("On: owning any printing of a card checks it off. Off: only the exact printing on the list counts.")
                    }
                } else if let desc = wishlist.description,
                          !desc.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Section {
                        Text(desc)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .listRowSeparator(.hidden)
                    }
                }

                // Completion Progress
                if totalCount > 0 {
                    Section {
                        VStack(spacing: 8) {
                            HStack {
                                Text("\(ownedCount) of \(totalCount) owned")
                                    .font(.subheadline)
                                    .fontWeight(.medium)
                                Spacer()
                                Text("\(completionPercent)%")
                                    .font(.subheadline)
                                    .fontWeight(.bold)
                                    .foregroundColor(.accentColor)
                            }
                            ProgressView(value: Double(ownedCount), total: Double(max(1, totalCount)))
                                .tint(.accentColor)
                        }
                        .padding(.vertical, 4)
                    }
                }

                // Saved expansion rules
                if !rules.isEmpty {
                    Section {
                        ForEach(rules) { rule in
                            WishlistRuleRow(rule: rule)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        Task { await removeRule(rule) }
                                    } label: {
                                        Label("Remove", systemImage: "trash")
                                    }
                                }
                        }

                        Button {
                            Task { await syncRules() }
                        } label: {
                            HStack {
                                if isSyncing {
                                    ProgressView().scaleEffect(0.8)
                                } else {
                                    Image(systemName: "arrow.triangle.2.circlepath")
                                }
                                Text(isSyncing ? (syncStatus ?? "Syncing…") : "Sync now")
                            }
                        }
                        .disabled(isSyncing)
                    } header: {
                        Text("Auto-updating rules")
                    } footer: {
                        if let syncStatus, !isSyncing {
                            Text(syncStatus)
                        } else {
                            Text("Syncing adds newly printed cards. Nothing is ever removed.")
                        }
                    }
                }

                // Filter
                if totalCount > 0 {
                    Section {
                        Picker("Filter", selection: $filterOwned) {
                            ForEach(OwnershipFilter.allCases, id: \.self) { filter in
                                Text(filter.rawValue).tag(filter)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                }

                // Cards List
                Section {
                    if cards.isEmpty {
                        VStack(spacing: 12) {
                            Image(systemName: "heart")
                                .font(.system(size: 40))
                                .foregroundColor(.secondary)
                            Text("No cards in this wishlist")
                                .font(.subheadline)
                                .foregroundColor(.secondary)
                            Button {
                                showingAddCards = true
                            } label: {
                                Label("Add Cards", systemImage: "plus")
                                    .labelStyle(.titleAndIcon)
                            }
                            .buttonStyle(.borderedProminent)
                            Button("Add a whole set or every printing") {
                                showingBulkAdd = true
                            }
                            .font(.footnote)
                            .buttonStyle(.borderless)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 20)
                    } else if filteredCards.isEmpty {
                        Text("No cards match your filter")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 20)
                    } else {
                        ForEach(filteredCards) { card in
                            WishlistCardRow(card: card)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        Task { await removeCard(card) }
                                    } label: {
                                        Label("Remove", systemImage: "trash")
                                    }
                                }
                        }
                    }
                }

                // Delete Wishlist (in edit mode)
                if isEditing {
                    Section {
                        Button(role: .destructive) {
                            showingDeleteConfirmation = true
                        } label: {
                            HStack {
                                Image(systemName: "trash")
                                Text("Delete Wishlist")
                            }
                            .frame(maxWidth: .infinity)
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(text: $searchText, prompt: "Search cards")
            .navigationTitle(wishlist.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    HStack(spacing: 12) {
                        if isEditing {
                            Button(isSaving ? "Saving..." : "Save") {
                                Task { await saveChanges() }
                            }
                            .disabled(editedName.isEmpty || isSaving)
                            .foregroundColor(.green)
                            .fontWeight(.semibold)
                        } else {
                            Button("Edit") { isEditing = true }
                            Menu {
                                Button {
                                    showingAddCards = true
                                } label: {
                                    Label("Search for cards", systemImage: "magnifyingglass")
                                }
                                Button {
                                    showingBulkAdd = true
                                } label: {
                                    Label("Add every match or a whole set", systemImage: "square.stack.3d.up")
                                }
                            } label: {
                                Image(systemName: "plus")
                            }
                        }
                    }
                }
            }
            .confirmationDialog("Delete Wishlist?", isPresented: $showingDeleteConfirmation, titleVisibility: .visible) {
                Button("Delete", role: .destructive) {
                    Task { await deleteWishlist() }
                }
            } message: {
                Text("This will permanently delete \"\(wishlist.name)\" and all its cards.")
            }
            .sheet(isPresented: $showingAddCards) {
                CardSearchView(addToWishlistId: wishlist.id, onCardAdded: {
                    Task { await refreshWishlist() }
                })
                .environmentObject(environmentStore)
            }
            .sheet(isPresented: $showingBulkAdd) {
                AddWishlistRuleSheet(
                    wishlist: Wishlist(
                        id: wishlist.id,
                        name: wishlist.name,
                        description: wishlist.description,
                        colorHex: wishlist.colorHex,
                        cards: cards,
                        totalCards: cards.count,
                        ownedCards: ownedCount,
                        completionPercent: completionPercent,
                        createdAt: wishlist.createdAt,
                        updatedAt: wishlist.updatedAt,
                        rules: rules
                    ),
                    onComplete: {
                        Task {
                            await refreshWishlist()
                            onUpdate?()
                        }
                    }
                )
                .environmentObject(environmentStore)
            }
            .task {
                await refreshWishlist()
            }
        }
    }

    @MainActor
    private func refreshWishlist() async {
        guard let token = environmentStore.authToken else { return }

        do {
            let updated = try await apiService.getWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: wishlist.id
            )
            cards = updated.cards
            rules = updated.expansionRules
        } catch {
            // Keep existing cards if refresh fails
        }
    }

    @MainActor
    private func syncRules() async {
        guard let token = environmentStore.authToken else { return }
        isSyncing = true
        syncStatus = "Syncing…"

        let service = WishlistSyncService(
            apiService: apiService,
            config: environmentStore.serverConfiguration,
            token: token,
            enabledGames: environmentStore.enabledGames
        )
        let snapshot = Wishlist(
            id: wishlist.id,
            name: wishlist.name,
            description: wishlist.description,
            colorHex: wishlist.colorHex,
            cards: cards,
            totalCards: cards.count,
            ownedCards: ownedCount,
            completionPercent: completionPercent,
            createdAt: wishlist.createdAt,
            updatedAt: wishlist.updatedAt,
            rules: rules
        )

        let result = await service.sync(wishlist: snapshot) { message in
            Task { @MainActor in syncStatus = message }
        }

        await refreshWishlist()
        onUpdate?()

        if let firstError = result.errors.first {
            syncStatus = firstError
        } else if result.addedCards > 0 {
            syncStatus = "Added \(result.addedCards) new card\(result.addedCards == 1 ? "" : "s")."
            HapticManager.notification(.success)
        } else {
            syncStatus = "Already up to date."
        }
        isSyncing = false
    }

    @MainActor
    private func removeRule(_ rule: WishlistRule) async {
        guard let token = environmentStore.authToken else { return }

        do {
            try await apiService.removeWishlistRule(
                config: environmentStore.serverConfiguration,
                token: token,
                wishlistId: wishlist.id,
                ruleId: rule.id
            )
            rules.removeAll { $0.id == rule.id }
            onUpdate?()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func removeCard(_ card: WishlistCard) async {
        guard let token = environmentStore.authToken else { return }

        do {
            try await apiService.removeCardFromWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                wishlistId: wishlist.id,
                cardId: card.id
            )
            cards.removeAll { $0.id == card.id }
            onUpdate?()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func saveChanges() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true

        do {
            _ = try await apiService.updateWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: wishlist.id,
                name: editedName,
                description: editedDescription.isEmpty ? nil : editedDescription,
                colorHex: selectedColor.toHex(),
                matchAnyPrinting: editedMatchAnyPrinting
            )
            isEditing = false
            onUpdate?()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    @MainActor
    private func deleteWishlist() async {
        guard let token = environmentStore.authToken else { return }

        do {
            try await apiService.deleteWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: wishlist.id
            )
            onUpdate?()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Wishlist Rule Row

private struct WishlistRuleRow: View {
    let rule: WishlistRule

    private var subtitle: String? {
        var parts: [String] = []
        if let count = rule.lastMatchCount {
            parts.append("\(count) matched")
        }
        if let synced = rule.lastSyncedAt, let date = ISO8601DateFormatter().date(from: synced) {
            parts.append("synced \(date.formatted(date: .abbreviated, time: .omitted))")
        }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: rule.type == .set ? "square.stack.3d.up" : "sparkles")
                .foregroundColor(.accentColor)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text(rule.summary)
                    .font(.subheadline)
                if rule.tcg != nil || subtitle != nil {
                    HStack(spacing: 6) {
                        if let tcg = rule.tcg {
                            GameBadge(tcg: tcg, showsName: true)
                        }
                        if let subtitle {
                            Text(subtitle)
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }

            Spacer()
        }
        .padding(.vertical, 2)
    }
}

// MARK: - Wishlist Card Row

private struct WishlistCardRow: View {
    let card: WishlistCard

    var body: some View {
        HStack(spacing: 12) {
            CardArtworkImage(card: card.previewCard, useFullResolution: false)
                .frame(width: 50, height: 70)

            VStack(alignment: .leading, spacing: 4) {
                Text(card.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                HStack(spacing: 6) {
                    if let setName = card.setName {
                        Text(setName)
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                    }
                    GameBadge(tcg: card.tcg)
                }

                if let rarity = card.rarity {
                    Text(rarity)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.15))
                        .foregroundColor(.accentColor)
                        .cornerRadius(4)
                }
            }

            Spacer()

            if card.owned {
                VStack(spacing: 2) {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.title3)
                    if card.ownedQuantity > 1 {
                        Text("x\(card.ownedQuantity)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            } else {
                Image(systemName: "circle")
                    .foregroundColor(.secondary)
                    .font(.title3)
            }
        }
        .padding(.vertical, 4)
        .opacity(card.owned ? 1.0 : 0.85)
    }
}

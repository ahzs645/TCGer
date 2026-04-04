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
    @State private var isSaving = false
    @State private var showingDeleteConfirmation = false
    @State private var searchText = ""
    @State private var filterOwned: OwnershipFilter = .all

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
        _editedName = State(initialValue: wishlist.name)
        _editedDescription = State(initialValue: wishlist.description ?? "")
        _selectedColor = State(initialValue: Color.fromHex(wishlist.colorHex))
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
                // Header
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        if isEditing {
                            TextField("Wishlist Name", text: $editedName)
                                .font(.title2)
                                .fontWeight(.bold)
                                .textFieldStyle(.roundedBorder)
                            TextField("Description (optional)", text: $editedDescription, axis: .vertical)
                                .font(.body)
                                .foregroundColor(.secondary)
                                .textFieldStyle(.roundedBorder)
                                .lineLimit(3...6)
                            ColorPickerGrid(selectedColor: $selectedColor)
                                .padding(.top, 8)
                        } else {
                            if let desc = wishlist.description, !desc.isEmpty {
                                Text(desc)
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color(.systemBackground))
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
                            }
                            .buttonStyle(.borderedProminent)
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
                            Button {
                                showingAddCards = true
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
        } catch {
            // Keep existing cards if refresh fails
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
                colorHex: selectedColor.toHex()
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

// MARK: - Wishlist Card Row

private struct WishlistCardRow: View {
    let card: WishlistCard

    var body: some View {
        HStack(spacing: 12) {
            CachedAsyncImage(url: URL(string: card.imageUrlSmall ?? card.imageUrl ?? "")) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                case .failure, .empty:
                    Rectangle()
                        .fill(Color(.systemGray5))
                        .overlay(
                            Image(systemName: "photo")
                                .foregroundColor(.secondary)
                                .font(.caption)
                        )
                @unknown default:
                    Rectangle()
                        .fill(Color(.systemGray5))
                }
            }
            .frame(width: 50, height: 70)
            .cornerRadius(4)

            VStack(alignment: .leading, spacing: 4) {
                Text(card.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                if let setName = card.setName {
                    Text(setName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(1)
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

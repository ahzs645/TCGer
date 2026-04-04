import SwiftUI

struct CollectionDetailView: View {
    let collection: Collection
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var isEditing = false
    @State private var editedName: String
    @State private var editedDescription: String
    @State private var selectedColor: Color
    @State private var showingAddCard = false
    @State private var errorMessage: String?
    @State private var isSaving = false
    @State private var cards: [CollectionCard]
    @State private var cardPendingDeletion: CollectionCard?
    @State private var editContext: CardEditContext?
    @State private var copySelectionCard: CollectionCard?
    @State private var editingCardId: String?
    @State private var cardBeingMoved: CollectionCard?
    @State private var movingCardId: String?
    @State private var showingDeleteBinderConfirmation = false
    @State private var isDeletingBinder = false
    @State private var availableTags: [CollectionCardTag] = []
    @State private var selectedTagFilters: Set<String> = []
    @State private var selectedConditionFilters: Set<String> = []
    @State private var minPriceFilter = ""
    @State private var maxPriceFilter = ""
    @State private var searchText = ""
    @State private var showFilters = false
    @State private var sortOption: CardSortOption = .name
    @State private var isSelectMode = false
    @State private var selectedCardIds: Set<String> = []
    @State private var showingBulkMoveSheet = false
    @State private var showingBulkDeleteConfirmation = false
    @State private var showingBulkConditionSheet = false
    @State private var isBulkProcessing = false

    enum CardSortOption: String, CaseIterable {
        case name = "Name"
        case number = "Card Number"
        case rarity = "Rarity"

        var systemImage: String {
            switch self {
            case .name: return "textformat.abc"
            case .number: return "number"
            case .rarity: return "sparkles"
            }
        }
    }

    private let apiService = APIService()
    init(collection: Collection) {
        self.collection = collection
        _editedName = State(initialValue: collection.name)
        _editedDescription = State(initialValue: collection.description ?? "")
        _selectedColor = State(initialValue: Color.fromHex(collection.colorHex))
        _cards = State(initialValue: collection.cards)
    }

    private var workingCollectionSnapshot: Collection {
        Collection(
            id: collection.id,
            name: isEditing ? editedName : collection.name,
            description: isEditing ? (editedDescription.isEmpty ? nil : editedDescription) : collection.description,
            cards: cards,
            createdAt: collection.createdAt,
            updatedAt: collection.updatedAt,
            colorHex: isEditing ? selectedColor.toHex() : collection.colorHex
        )
    }

    private var filteredCards: [CollectionCard] {
        let filtered = cards.filter { card in
            if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let query = searchText.lowercased()
                let matchesSearch =
                    card.name.lowercased().contains(query) ||
                    (card.setName?.lowercased().contains(query) ?? false) ||
                    (card.setCode?.lowercased().contains(query) ?? false)
                if !matchesSearch {
                    return false
                }
            }

            if !selectedTagFilters.isEmpty {
                let cardTagIds = Set(card.copies.flatMap { $0.tags.map(\.id) })
                if !selectedTagFilters.isSubset(of: cardTagIds) {
                    return false
                }
            }

            if !selectedConditionFilters.isEmpty {
                let cardConditions = Set(
                    card.copies.compactMap { normalizeFilterValue($0.condition) } +
                    [normalizeFilterValue(card.condition)].compactMap { $0 }
                )
                let wanted = Set(selectedConditionFilters.compactMap { normalizeFilterValue($0) })
                if cardConditions.isDisjoint(with: wanted) {
                    return false
                }
            }

            if let minPrice = Double(minPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines)), (card.price ?? 0) < minPrice {
                return false
            }
            if let maxPrice = Double(maxPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines)), (card.price ?? 0) > maxPrice {
                return false
            }

            return true
        }

        switch sortOption {
        case .name:
            return filtered.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        case .number:
            return filtered.sorted { CardNumberInfo.compare($0.collectorNumber, $1.collectorNumber) == .orderedAscending }
        case .rarity:
            return filtered.sorted { ($0.rarity ?? "").localizedCaseInsensitiveCompare($1.rarity ?? "") == .orderedAscending }
        }
    }

    private var binderTagOptions: [CollectionCardTag] {
        var seen = Set<String>()
        var tags: [CollectionCardTag] = []
        for tag in cards.flatMap(\.copies).flatMap(\.tags) {
            if seen.insert(tag.id).inserted {
                tags.append(tag)
            }
        }
        return tags.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
    }

    private var binderConditionOptions: [String] {
        let preferredOrder = ["MINT", "NEAR MINT", "EXCELLENT", "GOOD", "LIGHT PLAYED", "PLAYED", "POOR", "NM", "LP", "MP", "HP", "DMG"]

        var seen = Set<String>()
        let allConditions = cards.flatMap { card in
            card.copies.compactMap(\.condition) + [card.condition].compactMap { $0 }
        }
        let normalized = allConditions.compactMap(normalizeFilterValue).filter { seen.insert($0).inserted }

        return normalized.sorted { lhs, rhs in
            let leftIndex = preferredOrder.firstIndex(of: lhs) ?? preferredOrder.count
            let rightIndex = preferredOrder.firstIndex(of: rhs) ?? preferredOrder.count
            if leftIndex == rightIndex {
                return lhs < rhs
            }
            return leftIndex < rightIndex
        }
    }

    @ViewBuilder
    private var filtersSectionContent: some View {
        if showFilters {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Button {
                        showFilters = false
                    } label: {
                        Image(systemName: "line.3.horizontal.decrease.circle.fill")
                            .font(.title3)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Hide filters")
                    Spacer()
                }

                HStack(spacing: 10) {
                    tagFilterMenu
                    conditionFilterMenu
                    // Sort picker
                    Menu {
                        ForEach(CardSortOption.allCases, id: \.self) { option in
                            Button {
                                sortOption = option
                            } label: {
                                Label(option.rawValue, systemImage: option.systemImage)
                                if sortOption == option {
                                    Image(systemName: "checkmark")
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.up.arrow.down")
                            Text(sortOption.rawValue)
                        }
                        .font(.caption)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color(.systemGray5))
                        .cornerRadius(8)
                    }
                }

                HStack(spacing: 12) {
                    TextField("Min $", text: $minPriceFilter)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                    TextField("Max $", text: $maxPriceFilter)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                }

                HStack(spacing: 12) {
                    if hasActiveFilters {
                        Button("Clear All Filters") {
                            clearFilters()
                        }
                        .font(.caption)
                    }
                }
            }
            .padding(.vertical, 4)
        } else {
            Button {
                showFilters = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "line.3.horizontal.decrease.circle")
                        .font(.title3)
                    if activeFilterCount > 0 {
                        Text("\(activeFilterCount)")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Show filters")
            .padding(.vertical, 4)
        }
    }

    private var tagFilterMenu: some View {
        Menu {
            if binderTagOptions.isEmpty {
                Text("No tags in this binder")
            } else {
                ForEach(binderTagOptions) { tag in
                    Button {
                        toggleTagFilter(tag.id)
                    } label: {
                        Label(
                            tag.label,
                            systemImage: selectedTagFilters.contains(tag.id)
                                ? "checkmark.circle.fill"
                                : "circle"
                        )
                    }
                }
            }
            if !selectedTagFilters.isEmpty {
                Divider()
                Button("Clear Tag Filters") {
                    selectedTagFilters.removeAll()
                }
            }
        } label: {
            filterMenuLabel(text: "Tags", icon: "tag")
        }
    }

    private var conditionFilterMenu: some View {
        Menu {
            if binderConditionOptions.isEmpty {
                Text("No conditions in this binder")
            } else {
                ForEach(binderConditionOptions, id: \.self) { option in
                    Button {
                        toggleConditionFilter(option)
                    } label: {
                        Label(
                            option,
                            systemImage: selectedConditionFilters.contains(option)
                                ? "checkmark.circle.fill"
                                : "circle"
                        )
                    }
                }
            }
            if !selectedConditionFilters.isEmpty {
                Divider()
                Button("Clear Condition Filters") {
                    selectedConditionFilters.removeAll()
                }
            }
        } label: {
            filterMenuLabel(text: "Condition", icon: "line.3.horizontal.decrease.circle")
        }
    }

    private func filterMenuLabel(text: String, icon: String) -> some View {
        HStack {
            Image(systemName: icon)
            Text(text)
            Spacer()
            Image(systemName: "chevron.down")
                .font(.caption2)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    var body: some View {
        ZStack {
            NavigationView {
                ZStack {
                    Color(.systemBackground)
                        .ignoresSafeArea()

                    List {
                        Section {
                            VStack(alignment: .leading, spacing: 8) {
                                if isEditing {
                                    TextField("Binder Name", text: $editedName)
                                        .font(.title)
                                        .fontWeight(.bold)
                                        .textFieldStyle(.roundedBorder)

                                    TextField("Description (optional)", text: $editedDescription, axis: .vertical)
                                        .font(.body)
                                        .foregroundColor(.secondary)
                                        .textFieldStyle(.roundedBorder)
                                        .lineLimit(3...6)

                                    ColorPickerGrid(selectedColor: $selectedColor)
                                        .padding(.top, 12)
                                } else {
                                    Text(collection.name)
                                        .font(.title)
                                        .fontWeight(.bold)
                                    if let description = collection.description, !description.isEmpty {
                                        Text(description)
                                            .font(.body)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            }
                            .padding()
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                        }

                        Section {
                            CollectionStatsCard(
                                collection: workingCollectionSnapshot,
                                showPricing: environmentStore.showPricing
                            )
                            .padding(.horizontal)
                            .padding(.vertical, 4)
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                        }

                        Section {
                            filtersSectionContent
                            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                        }

                        Section {
                            if cards.isEmpty {
                                emptyStateView
                            } else if filteredCards.isEmpty {
                                filteredEmptyStateView
                            } else {
                                ForEach(filteredCards) { card in
                                    if isSelectMode {
                                        HStack(spacing: 12) {
                                            Image(systemName: selectedCardIds.contains(card.id) ? "checkmark.circle.fill" : "circle")
                                                .foregroundColor(selectedCardIds.contains(card.id) ? .accentColor : .secondary)
                                                .font(.title3)
                                            CollectionCardRow(
                                                card: card,
                                                showPricing: environmentStore.showPricing
                                            )
                                        }
                                        .contentShape(Rectangle())
                                        .onTapGesture {
                                            if selectedCardIds.contains(card.id) {
                                                selectedCardIds.remove(card.id)
                                            } else {
                                                selectedCardIds.insert(card.id)
                                            }
                                        }
                                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                                        .listRowSeparator(.hidden)
                                        .listRowBackground(Color(.systemBackground))
                                    } else if environmentStore.isAuthenticated {
                                        CollectionCardRow(
                                            card: card,
                                            showPricing: environmentStore.showPricing,
                                            showDeleteConfirmation: cardPendingDeletion?.id == card.id,
                                            onConfirmDelete: {
                                                Task {
                                                    await deleteCard(card)
                                                }
                                            },
                                            onCancelDelete: {
                                                cardPendingDeletion = nil
                                            }
                                        )
                                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                                        .listRowSeparator(.hidden)
                                        .listRowBackground(Color(.systemBackground))
                                        .swipeActions(edge: .leading) {
                                            Button {
                                                beginEditing(card)
                                            } label: {
                                                Label("Edit", systemImage: "square.and.pencil")
                                            }
                                            .tint(.blue)

                                            Button {
                                                cardBeingMoved = card
                                            } label: {
                                                Label("Move", systemImage: "arrowshape.turn.up.right")
                                            }
                                            .tint(.purple)
                                        }
                                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                            Button(role: .destructive) {
                                                cardPendingDeletion = card
                                            } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                        }
                                    } else {
                                        CollectionCardRow(
                                            card: card,
                                            showPricing: environmentStore.showPricing
                                        )
                                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                                        .listRowSeparator(.hidden)
                                        .listRowBackground(Color(.systemBackground))
                                    }
                                }
                            }
                        }

                        if !collection.isUnsortedBinder, isEditing, environmentStore.isAuthenticated {
                            Section {
                                Button(role: .destructive) {
                                    showingDeleteBinderConfirmation = true
                                } label: {
                                    HStack {
                                        if isDeletingBinder {
                                            ProgressView()
                                        } else {
                                            Image(systemName: "trash")
                                        }
                                        Text(isDeletingBinder ? "Deleting..." : "Delete Binder")
                                    }
                                    .frame(maxWidth: .infinity)
                                }
                                .disabled(isDeletingBinder)
                            }
                            .listRowInsets(EdgeInsets())
                            .listRowSeparator(.hidden)
                            .listRowBackground(Color(.systemBackground))
                        }
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .searchable(text: $searchText, prompt: "Search cards, sets, or codes")
                }
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") {
                            dismiss()
                        }
                    }

                    ToolbarItem(placement: .principal) {
                        Text(collection.name)
                            .font(.headline)
                    }

                    ToolbarItem(placement: .primaryAction) {
                        if environmentStore.isAuthenticated {
                            HStack(spacing: 12) {
                                if isSelectMode {
                                    Button("Cancel") {
                                        isSelectMode = false
                                        selectedCardIds.removeAll()
                                    }
                                } else if isEditing {
                                    Button(isSaving ? "Saving..." : "Save") {
                                        Task {
                                            await saveChanges()
                                        }
                                    }
                                    .disabled(editedName.isEmpty || isSaving)
                                    .foregroundColor(.green)
                                    .fontWeight(.semibold)
                                } else {
                                    Button("Select") {
                                        isSelectMode = true
                                        selectedCardIds.removeAll()
                                    }
                                    .disabled(cards.isEmpty)

                                    Button(action: { isEditing = true }) {
                                        Text("Edit")
                                    }

                                    Button(action: { showingAddCard = true }) {
                                        Image(systemName: "plus")
                                    }
                                }
                            }
                        }
                    }
                }
                .task {
                    await loadAvailableTags()
                }
                .sheet(isPresented: $showingAddCard) {
                    AddCardToBinderFromSearchView(binderId: collection.id)
                }
                .sheet(item: $editContext) { context in
                    EditCollectionCardSheet(
                        card: context.card,
                        isIndividualCopy: !context.canEditQuantity,
                        copyDetails: context.copy,
                        isSaving: editingCardId == context.collectionEntryId,
                        availableTags: availableTags,
                        selectedTagIds: context.copy?.tags.map(\.id) ?? context.card.copies.first?.tags.map(\.id) ?? [],
                        onCreateTag: { label in
                            try await createTag(label: label)
                        }
                    ) { payload in
#if DEBUG
                        print(
                            "CollectionDetailView.onSave payload -> quantity:\(payload.quantity) " +
                            "condition:\(payload.condition ?? "nil") " +
                            "language:\(payload.language ?? "nil") " +
                            "notes:\(payload.notes ?? "nil") " +
                            "tags:\(payload.tags) " +
                            "print:\(payload.selectedPrint?.id ?? "nil") " +
                            "canEditQuantity:\(context.canEditQuantity)"
                        )
#endif
                        Task {
                            await updateCard(
                                card: context.card,
                                collectionEntryId: context.collectionEntryId,
                                quantity: context.canEditQuantity ? payload.quantity : nil,
                                condition: payload.condition,
                                language: payload.language,
                                notes: payload.notes,
                                isFoil: payload.isFoil,
                                isSigned: payload.isSigned,
                                isAltered: payload.isAltered,
                                tags: payload.tags,
                                newPrint: payload.selectedPrint
                            )
                        }
                    }
                    .environmentObject(environmentStore)
                }
                .sheet(item: $copySelectionCard) { card in
                    CopySelectionSheet(card: card) { copy in
                        selectCopyForEditing(card: card, copy: copy)
                    }
                }
                .sheet(item: $cardBeingMoved) { card in
                    MoveCardToBinderSheet(
                        card: card,
                        sourceBinderId: collection.id,
                        isProcessing: movingCardId == card.id
                    ) { binderId, copyIds in
                        await moveCard(
                            card: card,
                            destinationBinderId: binderId,
                            selectedCopyIds: copyIds
                        )
                    }
                }
                .alert("Error", isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )) {
                    Button("OK", role: .cancel) {
                        errorMessage = nil
                    }
                } message: {
                    if let error = errorMessage {
                        Text(error)
                    }
                }
                .alert("Delete Binder?", isPresented: $showingDeleteBinderConfirmation) {
                    Button("Delete", role: .destructive) {
                        Task {
                            await deleteBinder()
                        }
                    }
                    Button("Cancel", role: .cancel) {
                        showingDeleteBinderConfirmation = false
                    }
                } message: {
                    Text("This action permanently removes the binder and its cards.")
                }
            }

            // Bulk Action Bar
            if isSelectMode && !selectedCardIds.isEmpty {
                VStack(spacing: 0) {
                    Divider()
                    HStack(spacing: 24) {
                        Button {
                            if selectedCardIds.count == filteredCards.count {
                                selectedCardIds.removeAll()
                            } else {
                                selectedCardIds = Set(filteredCards.map(\.id))
                            }
                        } label: {
                            Text(selectedCardIds.count == filteredCards.count ? "Deselect All" : "Select All")
                                .font(.caption)
                        }

                        Spacer()

                        Button { showingBulkMoveSheet = true } label: {
                            VStack(spacing: 2) {
                                Image(systemName: "arrowshape.turn.up.right")
                                Text("Move").font(.caption2)
                            }
                        }
                        .disabled(isBulkProcessing)

                        Button { showingBulkConditionSheet = true } label: {
                            VStack(spacing: 2) {
                                Image(systemName: "pencil")
                                Text("Condition").font(.caption2)
                            }
                        }
                        .disabled(isBulkProcessing)

                        Button(role: .destructive) { showingBulkDeleteConfirmation = true } label: {
                            VStack(spacing: 2) {
                                Image(systemName: "trash")
                                Text("Delete").font(.caption2)
                            }
                        }
                        .disabled(isBulkProcessing)

                        Text("\(selectedCardIds.count)")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundColor(.secondary)
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 10)
                    .background(.ultraThinMaterial)
                }
            }
        }
        .confirmationDialog("Delete \(selectedCardIds.count) cards?", isPresented: $showingBulkDeleteConfirmation, titleVisibility: .visible) {
            Button("Delete \(selectedCardIds.count) cards", role: .destructive) {
                Task { await bulkDelete() }
            }
        }
        .sheet(isPresented: $showingBulkMoveSheet) {
            BulkMoveSheet(
                sourceBinderId: collection.id,
                selectedCount: selectedCardIds.count,
                isProcessing: isBulkProcessing
            ) { destinationBinderId in
                await bulkMove(to: destinationBinderId)
            }
            .environmentObject(environmentStore)
        }
        .sheet(isPresented: $showingBulkConditionSheet) {
            BulkConditionSheet(selectedCount: selectedCardIds.count) { condition in
                Task { await bulkChangeCondition(condition) }
            }
        }
    }

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            Image(systemName: "rectangle.stack.badge.plus")
                .font(.system(size: 50))
                .foregroundColor(.secondary)
            Text("No cards in this binder yet")
                .font(.subheadline)
                .foregroundColor(.secondary)

            if environmentStore.isAuthenticated {
                Button(action: { showingAddCard = true }) {
                    HStack(spacing: 10) {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                        Text("Add Your First Card")
                            .font(.headline)
                    }
                    .padding(.horizontal, 20)
                }
                .buttonStyle(.borderedProminent)
                .buttonBorderShape(.capsule)
            } else {
                Text("Sign in to add cards to this binder.")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color(.systemBackground))
    }

    private var filteredEmptyStateView: some View {
        VStack(spacing: 12) {
            Image(systemName: "line.3.horizontal.decrease.circle")
                .font(.system(size: 44))
                .foregroundColor(.secondary)
            Text("No cards match your filters")
                .font(.subheadline)
                .foregroundColor(.secondary)
            Button("Clear Filters") {
                clearFilters()
            }
            .buttonStyle(.bordered)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 32)
        .listRowInsets(EdgeInsets())
        .listRowSeparator(.hidden)
        .listRowBackground(Color(.systemBackground))
    }

    @MainActor
    private func saveChanges() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        guard !editedName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Binder name cannot be empty"
            return
        }

        isSaving = true
        errorMessage = nil

        do {
            let updated = try await apiService.updateCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                id: collection.id,
                name: editedName,
                description: editedDescription.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : editedDescription,
                colorHex: selectedColor.toHex()
            )

            cards = updated.cards
            isEditing = false
            isSaving = false
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }

    @MainActor
    private func deleteCard(_ card: CollectionCard) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            cardPendingDeletion = nil
            return
        }

        defer {
            cardPendingDeletion = nil
        }

        do {
            try await apiService.deleteCardFromBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: collection.id,
                collectionCardId: card.id
            )
            cards.removeAll { $0.id == card.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func updateCard(
        card: CollectionCard,
        collectionEntryId: String,
        quantity: Int?,
        condition: String?,
        language: String?,
        notes: String?,
        isFoil: Bool = false,
        isSigned: Bool = false,
        isAltered: Bool = false,
        tags: [String],
        newPrint: Card?
    ) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        editingCardId = collectionEntryId

        do {
#if DEBUG
            print("CollectionDetailView.updateCard -> quantity: \(String(describing: quantity)) condition: \(condition ?? "nil") language: \(language ?? "nil") notes: \(notes ?? "nil") foil:\(isFoil) signed:\(isSigned) altered:\(isAltered) tags: \(tags) newPrint: \(newPrint?.id ?? "nil")")
#endif
            let updated = try await apiService.updateCardInBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: collection.id,
                collectionCardId: collectionEntryId,
                quantity: quantity,
                condition: condition,
                language: language,
                notes: notes,
                isFoil: isFoil,
                isSigned: isSigned,
                isAltered: isAltered,
                tags: tags,
                newPrint: newPrint,
                targetBinderId: nil
            )

            if let index = cards.firstIndex(where: { $0.id == card.id }) {
                cards[index] = updated
            }

            editContext = nil
        } catch {
            errorMessage = error.localizedDescription
        }

        editingCardId = nil
    }

    @MainActor
    private func beginEditing(_ card: CollectionCard) {
        let copies = card.copies
        if copies.count > 1 {
            copySelectionCard = card
        } else {
            let copy = copies.first
            editContext = CardEditContext(
                card: card,
                collectionEntryId: copy?.id ?? card.id,
                copy: copy,
                canEditQuantity: true
            )
        }
    }

    @MainActor
    private func selectCopyForEditing(card: CollectionCard, copy: CollectionCardCopy) {
        copySelectionCard = nil
        editContext = CardEditContext(
            card: card,
            collectionEntryId: copy.id,
            copy: copy,
            canEditQuantity: false
        )
    }

    @MainActor
    private func loadAvailableTags() async {
        guard let token = environmentStore.authToken else {
            availableTags = []
            return
        }

        do {
            let tags = try await apiService.getTags(
                config: environmentStore.serverConfiguration,
                token: token
            )
            availableTags = tags.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        } catch {
            // Non-fatal; tag controls still work with existing tags.
            print("Failed to load tags: \(error.localizedDescription)")
        }
    }

    @MainActor
    private func createTag(label: String) async throws -> CollectionCardTag {
        guard let token = environmentStore.authToken else {
            throw APIService.APIError.unauthorized
        }

        let created = try await apiService.createTag(
            config: environmentStore.serverConfiguration,
            token: token,
            label: label
        )

        if !availableTags.contains(where: { $0.id == created.id }) {
            availableTags.append(created)
            availableTags.sort { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        }

        return created
    }

    private var hasActiveFilters: Bool {
        !selectedTagFilters.isEmpty ||
        !selectedConditionFilters.isEmpty ||
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        !minPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        !maxPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var activeFilterCount: Int {
        var count = 0
        if !selectedTagFilters.isEmpty { count += 1 }
        if !selectedConditionFilters.isEmpty { count += 1 }
        if !minPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { count += 1 }
        if !maxPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { count += 1 }
        if !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { count += 1 }
        return count
    }

    private func clearFilters() {
        selectedTagFilters.removeAll()
        selectedConditionFilters.removeAll()
        minPriceFilter = ""
        maxPriceFilter = ""
        searchText = ""
    }

    private func toggleTagFilter(_ tagId: String) {
        if selectedTagFilters.contains(tagId) {
            selectedTagFilters.remove(tagId)
        } else {
            selectedTagFilters.insert(tagId)
        }
    }

    private func toggleConditionFilter(_ condition: String) {
        if selectedConditionFilters.contains(condition) {
            selectedConditionFilters.remove(condition)
        } else {
            selectedConditionFilters.insert(condition)
        }
    }

    private func normalizeFilterValue(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed.uppercased()
    }

    @MainActor
    private func moveCard(
        card: CollectionCard,
        destinationBinderId: String,
        selectedCopyIds: [String]
    ) async {
        if destinationBinderId == collection.id {
            errorMessage = "Select a different destination binder."
            cardBeingMoved = nil
            return
        }

        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        movingCardId = card.id
        errorMessage = nil

        do {
            for copyId in selectedCopyIds {
                _ = try await apiService.updateCardInBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: collection.id,
                    collectionCardId: copyId,
                    quantity: nil,
                    condition: nil,
                    language: nil,
                    notes: nil,
                    newPrint: nil,
                    targetBinderId: destinationBinderId
                )
            }
            await reloadBinderCards()
            cardBeingMoved = nil
        } catch {
            errorMessage = error.localizedDescription
        }

        movingCardId = nil
    }

    @MainActor
    private func reloadBinderCards() async {
        guard let token = environmentStore.authToken else { return }

        do {
            let fetchedCollections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: false
            )

            if let updated = fetchedCollections.first(where: { $0.id == collection.id }) {
                cards = updated.cards
            } else if collection.isUnsortedBinder, let unsorted = fetchedCollections.first(where: { $0.isUnsortedBinder }) {
                cards = unsorted.cards
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func deleteBinder() async {
        guard !collection.isUnsortedBinder else {
            showingDeleteBinderConfirmation = false
            return
        }

        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            showingDeleteBinderConfirmation = false
            return
        }

        isDeletingBinder = true
        errorMessage = nil

        do {
            try await apiService.deleteCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                id: collection.id
            )
            isDeletingBinder = false
            showingDeleteBinderConfirmation = false
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isDeletingBinder = false
            showingDeleteBinderConfirmation = false
        }
    }

    // MARK: - Bulk Actions

    @MainActor
    private func bulkDelete() async {
        guard let token = environmentStore.authToken else { return }
        isBulkProcessing = true

        var failCount = 0
        for cardId in selectedCardIds {
            do {
                try await apiService.deleteCardFromBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: collection.id,
                    collectionCardId: cardId
                )
                cards.removeAll { $0.id == cardId }
            } catch {
                failCount += 1
            }
        }

        if failCount > 0 {
            errorMessage = "Failed to delete \(failCount) card(s)"
        }

        selectedCardIds.removeAll()
        isSelectMode = false
        isBulkProcessing = false
        HapticManager.notification(.success)
    }

    @MainActor
    private func bulkMove(to destinationBinderId: String) async {
        guard let token = environmentStore.authToken else { return }
        guard destinationBinderId != collection.id else {
            errorMessage = "Select a different destination binder."
            return
        }

        isBulkProcessing = true

        var failCount = 0
        for cardId in selectedCardIds {
            do {
                _ = try await apiService.updateCardInBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: collection.id,
                    collectionCardId: cardId,
                    quantity: nil,
                    condition: nil,
                    language: nil,
                    notes: nil,
                    newPrint: nil,
                    targetBinderId: destinationBinderId
                )
            } catch {
                failCount += 1
            }
        }

        if failCount > 0 {
            errorMessage = "Failed to move \(failCount) card(s)"
        }

        await reloadBinderCards()
        selectedCardIds.removeAll()
        isSelectMode = false
        isBulkProcessing = false
        showingBulkMoveSheet = false
        HapticManager.notification(.success)
    }

    @MainActor
    private func bulkChangeCondition(_ condition: String) async {
        guard let token = environmentStore.authToken else { return }
        isBulkProcessing = true

        var failCount = 0
        for cardId in selectedCardIds {
            do {
                let updated = try await apiService.updateCardInBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: collection.id,
                    collectionCardId: cardId,
                    quantity: nil,
                    condition: condition,
                    language: nil,
                    notes: nil,
                    newPrint: nil,
                    targetBinderId: nil
                )
                if let index = cards.firstIndex(where: { $0.id == cardId }) {
                    cards[index] = updated
                }
            } catch {
                failCount += 1
            }
        }

        if failCount > 0 {
            errorMessage = "Failed to update \(failCount) card(s)"
        }

        selectedCardIds.removeAll()
        isSelectMode = false
        isBulkProcessing = false
        showingBulkConditionSheet = false
        HapticManager.notification(.success)
    }
}

private struct CardEditContext: Identifiable, Equatable {
    let id = UUID()
    let card: CollectionCard
    let collectionEntryId: String
    let copy: CollectionCardCopy?
    let canEditQuantity: Bool
}

private struct CopySelectionSheet: View {
    let card: CollectionCard
    let onSelect: (CollectionCardCopy) -> Void
    @Environment(\.dismiss) private var dismiss

    private var copies: [CollectionCardCopy] {
        card.copies
    }

    var body: some View {
        NavigationView {
            List {
                if copies.isEmpty {
                    Text("No individual copies available for editing.")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        .padding(.vertical, 12)
                } else {
                    ForEach(Array(copies.enumerated()), id: \.element.id) { index, copy in
                        Button {
                            onSelect(copy)
                            dismiss()
                        } label: {
                            CopyRow(copy: copy, index: index)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .navigationTitle("Select Copy")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }

    private struct CopyRow: View {
        let copy: CollectionCardCopy
        let index: Int

        private func normalized(_ value: String?) -> String? {
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
                return nil
            }
            return trimmed
        }

        private var title: String {
            if let serial = normalized(copy.serialNumber) {
                return serial
            }
            return "Copy #\(index + 1)"
        }

        private var detailLine: String? {
            var parts: [String] = []
            if let condition = normalized(copy.condition) {
                parts.append(condition)
            }
            if let language = normalized(copy.language) {
                parts.append(language)
            }
            return parts.isEmpty ? nil : parts.joined(separator: " • ")
        }

        private var tagsLine: String? {
            let labels = copy.tags.map { $0.label }.filter { !$0.isEmpty }
            guard !labels.isEmpty else { return nil }
            return labels.joined(separator: ", ")
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(title)
                        .font(.headline)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let detailLine {
                    Text(detailLine)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let notes = normalized(copy.notes) {
                    Text(notes)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                if let tagsLine {
                    Text("Tags: \(tagsLine)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else {
                    Text("No tags")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(.vertical, 6)
        }
    }
}

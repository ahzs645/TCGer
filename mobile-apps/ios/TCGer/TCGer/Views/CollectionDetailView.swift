import SwiftUI

struct CollectionDetailView: View {
    let collection: Collection
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var isEditing = false
    @State private var editedName: String
    @State private var editedDescription: String
    @State private var selectedColor: Color
    @State private var editedDefaultCondition: String
    @State private var showingAddCard = false
    @State private var errorMessage: String?
    @State private var isSaving = false
    @State private var cards: [CollectionCard]
    @State private var cardPendingDeletion: CollectionCard?
    @State private var copyPendingDeletion: CardCopyContext?
    @State private var editContext: CardEditContext?
    @State private var editingCardId: String?
    @State private var moveContext: CardCopyContext?
    @State private var movingCardId: String?
    @State private var expandedCardIds: Set<String> = []
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
    @State private var cardToSell: CollectionCard?
    @State private var showingBinderPages = false

    private let apiService = APIService()
    init(collection: Collection) {
        self.collection = collection
        _editedName = State(initialValue: collection.name)
        _editedDescription = State(initialValue: collection.description ?? "")
        _selectedColor = State(initialValue: Color.fromHex(collection.colorHex))
        _editedDefaultCondition = State(initialValue: collection.defaultCondition ?? "")
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
                let query = SearchTextNormalizer.key(searchText)
                let matchesSearch =
                    SearchTextNormalizer.contains(card.name, queryKey: query) ||
                    SearchTextNormalizer.contains(card.setName, queryKey: query) ||
                    SearchTextNormalizer.contains(card.setCode, queryKey: query)
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
        var seen = Set<String>()
        let allConditions = cards.flatMap { card in
            card.copies.compactMap(\.condition) + [card.condition].compactMap { $0 }
        }
        let normalized = allConditions.compactMap(normalizeFilterValue).filter { seen.insert($0).inserted }
        return CardCondition.sorted(normalized)
    }

    private var visibleCardIDs: Set<String> {
        Set(filteredCards.map(\.id))
    }

    private var allVisibleCardsSelected: Bool {
        !visibleCardIDs.isEmpty && visibleCardIDs.isSubset(of: selectedCardIds)
    }

    private var selectionTitle: String {
        "\(selectedCardIds.count) Selected"
    }

    var body: some View {
        ZStack {
            NavigationStack {
                ZStack {
                    Color(.systemBackground)
                        .ignoresSafeArea()

                    VStack(spacing: 0) {
                        List {
                        if isEditing {
                            NameDescriptionColorSections(
                                namePlaceholder: "Binder Name",
                                name: $editedName,
                                description: $editedDescription,
                                selectedColor: $selectedColor
                            )

                            Section {
                                ConditionPicker(
                                    selection: $editedDefaultCondition,
                                    includeUnspecified: true
                                )
                            } header: {
                                Text("Default Condition")
                            }
                        } else {
                            Section {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(collection.name)
                                        .font(.title)
                                        .fontWeight(.bold)
                                    if let description = collection.description, !description.isEmpty {
                                        Text(description)
                                            .font(.body)
                                            .foregroundColor(.secondary)
                                    }
                                    if let defaultCondition = collection.defaultCondition, !defaultCondition.isEmpty {
                                        Text("Default condition: \(defaultCondition)")
                                            .font(.footnote)
                                            .foregroundColor(.secondary)
                                    }
                                    if collection.isUnsortedBinder && !cards.isEmpty {
                                        Label(
                                            "These cards aren't in a binder yet. Select cards, then use Move to file them into one.",
                                            systemImage: "arrowshape.turn.up.right"
                                        )
                                        .font(.footnote)
                                        .foregroundColor(.secondary)
                                    }
                                }
                                .padding()
                                .listRowInsets(EdgeInsets())
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color(.systemBackground))
                            }
                        }

                        if !isEditing {
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
                                if cards.isEmpty {
                                    emptyStateView
                                } else if filteredCards.isEmpty {
                                    filteredEmptyStateView
                                } else {
                                    ForEach(filteredCards) { card in
                                    if isSelectMode {
                                        Button {
                                            if selectedCardIds.contains(card.id) {
                                                selectedCardIds.remove(card.id)
                                            } else {
                                                selectedCardIds.insert(card.id)
                                            }
                                        } label: {
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
                                        }
                                        .buttonStyle(.plain)
                                        .accessibilityLabel(card.name)
                                        .accessibilityValue(selectedCardIds.contains(card.id) ? "Selected" : "Not selected")
                                        .accessibilityHint("Double tap to toggle selection")
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
                                            },
                                            isCopiesExpanded: expandedCardIds.contains(card.id),
                                            onToggleCopies: {
                                                toggleCopies(for: card)
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
                                                moveContext = CardCopyContext(card: card)
                                            } label: {
                                                Label(card.copies.count > 1 ? "Move Copies" : "Move", systemImage: "arrowshape.turn.up.right")
                                            }
                                            .tint(.purple)
                                        }
                                        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                            Button(role: .destructive) {
                                                cardPendingDeletion = card
                                            } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                            Button {
                                                cardToSell = card
                                            } label: {
                                                Label("Sold", systemImage: "dollarsign.circle")
                                            }
                                            .tint(.green)
                                        }
                                    } else {
                                        CollectionCardRow(
                                            card: card,
                                            showPricing: environmentStore.showPricing,
                                            isCopiesExpanded: expandedCardIds.contains(card.id),
                                            onToggleCopies: {
                                                toggleCopies(for: card)
                                            }
                                        )
                                        .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                                        .listRowSeparator(.hidden)
                                        .listRowBackground(Color(.systemBackground))
                                    }

                                    if !isSelectMode,
                                       expandedCardIds.contains(card.id),
                                       card.copies.count > 1 {
                                        ForEach(Array(card.copies.enumerated()), id: \.element.id) { index, copy in
                                            if environmentStore.isAuthenticated {
                                                Button {
                                                    selectCopyForEditing(card: card, copy: copy)
                                                } label: {
                                                    CollectionCardCopyRow(
                                                        copy: copy,
                                                        index: index,
                                                        total: card.copies.count
                                                    )
                                                }
                                                .buttonStyle(.plain)
                                                .accessibilityHint("Double tap to edit this copy. Swipe for more actions.")
                                                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
                                                .listRowSeparator(.hidden)
                                                .listRowBackground(Color(.systemBackground))
                                                .swipeActions(edge: .leading, allowsFullSwipe: false) {
                                                    Button {
                                                        selectCopyForEditing(card: card, copy: copy)
                                                    } label: {
                                                        Label("Edit", systemImage: "square.and.pencil")
                                                    }
                                                    .tint(.blue)

                                                    Button {
                                                        moveContext = CardCopyContext(card: card, copy: copy)
                                                    } label: {
                                                        Label("Move", systemImage: "arrowshape.turn.up.right")
                                                    }
                                                    .tint(.purple)
                                                }
                                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                                    Button(role: .destructive) {
                                                        copyPendingDeletion = CardCopyContext(card: card, copy: copy)
                                                    } label: {
                                                        Label("Delete", systemImage: "trash")
                                                    }
                                                }
                                            } else {
                                                CollectionCardCopyRow(
                                                    copy: copy,
                                                    index: index,
                                                    total: card.copies.count
                                                )
                                                .listRowInsets(EdgeInsets(top: 0, leading: 16, bottom: 8, trailing: 16))
                                                .listRowSeparator(.hidden)
                                                .listRowBackground(Color(.systemBackground))
                                            }
                                        }
                                    }
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
                        }
                    }
                        .modifier(BinderListModeModifier(isEditing: isEditing, searchText: $searchText))
                        .safeAreaBar(edge: .top, spacing: 0) {
                            if !isEditing {
                                CollectionFilterBar(
                                    showFilters: $showFilters,
                                    sortOption: $sortOption,
                                    selectedTagFilters: $selectedTagFilters,
                                    selectedConditionFilters: $selectedConditionFilters,
                                    minPriceFilter: $minPriceFilter,
                                    maxPriceFilter: $maxPriceFilter,
                                    tagOptions: binderTagOptions,
                                    conditionOptions: binderConditionOptions,
                                    hasActiveFilters: hasActiveFilters,
                                    onClearAll: clearFilters
                                )
                                .padding(.horizontal)
                            }
                        }
                        .scrollEdgeEffectStyle(.soft, for: .top)
                        .scrollEdgeEffectHidden(
                            isSelectMode && !selectedCardIds.isEmpty,
                            for: .bottom
                        )
                    }
                }
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Done") {
                            dismiss()
                        }
                    }

                    ToolbarItem(placement: .principal) {
                        Text(isSelectMode ? selectionTitle : collection.name)
                            .font(.headline)
                            .contentTransition(.numericText())
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
                                    if !collection.isUnsortedBinder {
                                        Button(action: { showingBinderPages = true }) {
                                            Image(systemName: "rectangle.stack")
                                        }
                                        .accessibilityLabel("Binder pages")
                                    }

                                    Button("Select") {
                                        isSelectMode = true
                                        selectedCardIds.removeAll()
                                    }
                                    .disabled(cards.isEmpty)

                                    // The Unsorted Library is a virtual holding
                                    // area, not a real binder — nothing to edit.
                                    if !collection.isUnsortedBinder {
                                        Button(action: { isEditing = true }) {
                                            Text("Edit")
                                        }
                                    }

                                    Button(action: { showingAddCard = true }) {
                                        Image(systemName: "plus")
                                    }
                                }
                            }
                        }
                    }

                    if isSelectMode && !selectedCardIds.isEmpty {
                        ToolbarItem(placement: .bottomBar) {
                            Button {
                                toggleSelectAllVisibleCards()
                            } label: {
                                Label(
                                    allVisibleCardsSelected ? "Deselect All" : "Select All",
                                    systemImage: allVisibleCardsSelected
                                        ? "checkmark.circle.fill"
                                        : "checkmark.circle"
                                )
                            }
                        }

                        ToolbarSpacer(.flexible, placement: .bottomBar)

                        ToolbarItemGroup(placement: .bottomBar) {
                            Button {
                                showingBulkMoveSheet = true
                            } label: {
                                Label("Move", systemImage: "arrowshape.turn.up.right")
                            }
                            .disabled(isBulkProcessing)

                            Button {
                                showingBulkConditionSheet = true
                            } label: {
                                Label("Condition", systemImage: "pencil")
                            }
                            .disabled(isBulkProcessing)
                        }

                        ToolbarSpacer(.fixed, placement: .bottomBar)

                        ToolbarItem(placement: .bottomBar) {
                            Button(role: .destructive) {
                                showingBulkDeleteConfirmation = true
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                            .disabled(isBulkProcessing)
                        }
                    }
                }
                .task {
                    BinderAccessLog.recordOpen(collection.id)
                    await loadAvailableTags()
                }
                .sheet(isPresented: $showingAddCard) {
                    AddCardToBinderFromSearchView(binderId: collection.id) { destinationBinderId in
                        guard destinationBinderId == collection.id else { return }
                        await reloadBinderCards()
                    }
                }
                .sheet(isPresented: $showingBinderPages) {
                    BinderPagesView(collection: workingCollectionSnapshot)
                        .environmentObject(environmentStore)
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
                                variant: payload.variant,
                                isSigned: payload.isSigned,
                                isAltered: payload.isAltered,
                                gradingCompany: payload.gradingCompany,
                                gradingScore: payload.gradingScore,
                                certNumber: payload.certNumber,
                                storageLocation: payload.storageLocation,
                                tags: payload.tags,
                                newPrint: payload.selectedPrint
                            )
                        }
                    }
                    .environmentObject(environmentStore)
                }
                .sheet(item: $moveContext) { context in
                    MoveCardToBinderSheet(
                        card: context.card,
                        targetCopy: context.copy,
                        sourceBinderId: collection.id,
                        isProcessing: movingCardId == context.card.id
                    ) { binderId, copyIds in
                        await moveCard(
                            card: context.card,
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
                .alert("Delete Copy?", isPresented: Binding(
                    get: { copyPendingDeletion != nil },
                    set: { if !$0 { copyPendingDeletion = nil } }
                )) {
                    Button("Delete", role: .destructive) {
                        if let context = copyPendingDeletion {
                            Task {
                                await deleteCopy(context)
                            }
                        }
                    }
                    Button("Cancel", role: .cancel) {
                        copyPendingDeletion = nil
                    }
                } message: {
                    if let context = copyPendingDeletion,
                       let copy = context.copy {
                        let index = context.card.copies.firstIndex(where: { $0.id == copy.id }) ?? 0
                        Text("This permanently removes \(copy.displayTitle(index: index)) of \(context.card.name) from this binder.")
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
        .sheet(item: $cardToSell) { card in
            MarkAsSoldSheet(card: card) { amount, platform, removeFromBinder in
                Task {
                    await markCardAsSold(card: card, amount: amount, platform: platform, removeFromBinder: removeFromBinder)
                }
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

    private func toggleSelectAllVisibleCards() {
        if allVisibleCardsSelected {
            selectedCardIds.subtract(visibleCardIDs)
        } else {
            selectedCardIds.formUnion(visibleCardIDs)
        }
    }

    @MainActor
    private func saveChanges() async {
        guard !collection.isUnsortedBinder else {
            isEditing = false
            return
        }

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
                colorHex: selectedColor.toHex(),
                // "" clears the stored default; nil would leave it unchanged.
                defaultCondition: editedDefaultCondition == (collection.defaultCondition ?? "")
                    ? nil
                    : editedDefaultCondition
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
    private func deleteCopy(_ context: CardCopyContext) async {
        guard let copy = context.copy else {
            copyPendingDeletion = nil
            return
        }
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            copyPendingDeletion = nil
            return
        }

        defer {
            copyPendingDeletion = nil
        }

        do {
            try await apiService.deleteCardFromBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: collection.id,
                collectionCardId: copy.id
            )
            await reloadBinderCards()
            HapticManager.notification(.success)
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
        variant: CardCopyVariant? = nil,
        isSigned: Bool = false,
        isAltered: Bool = false,
        gradingCompany: String?,
        gradingScore: String?,
        certNumber: String?,
        storageLocation: String?,
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
                variant: variant,
                isSigned: isSigned,
                isAltered: isAltered,
                gradingCompany: gradingCompany,
                gradingScore: gradingScore,
                certNumber: certNumber,
                storageLocation: storageLocation,
                includeOwnedCopyDetails: true,
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
            withAnimation(.snappy) {
                _ = expandedCardIds.insert(card.id)
            }
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
        editContext = CardEditContext(
            card: card,
            collectionEntryId: copy.id,
            copy: copy,
            canEditQuantity: false
        )
    }

    @MainActor
    private func toggleCopies(for card: CollectionCard) {
        withAnimation(.snappy) {
            if expandedCardIds.contains(card.id) {
                expandedCardIds.remove(card.id)
            } else {
                expandedCardIds.insert(card.id)
            }
        }
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

    private func clearFilters() {
        selectedTagFilters.removeAll()
        selectedConditionFilters.removeAll()
        minPriceFilter = ""
        maxPriceFilter = ""
        searchText = ""
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
            moveContext = nil
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
            moveContext = nil
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

    @MainActor
    private func markCardAsSold(card: CollectionCard, amount: Double, platform: String?, removeFromBinder: Bool) async {
        guard let token = environmentStore.authToken else { return }

        do {
            _ = try await apiService.createTransaction(
                config: environmentStore.serverConfiguration,
                token: token,
                type: "sale",
                cardName: card.name,
                tcg: card.tcg,
                quantity: card.quantity,
                amount: amount,
                platform: platform
            )

            if removeFromBinder {
                try await apiService.deleteCardFromBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: collection.id,
                    collectionCardId: card.id
                )
                cards.removeAll { $0.id == card.id }
            }

            HapticManager.notification(.success)
            cardToSell = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct BinderListModeModifier: ViewModifier {
    let isEditing: Bool
    @Binding var searchText: String

    @ViewBuilder
    func body(content: Content) -> some View {
        if isEditing {
            content
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
                .background(Color(.systemGroupedBackground))
                .scrollDismissesKeyboard(.interactively)
        } else {
            content
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .searchable(
                    text: $searchText,
                    placement: .navigationBarDrawer(displayMode: .always),
                    prompt: "Search cards, sets, or codes"
                )
        }
    }
}

private struct CardEditContext: Identifiable, Equatable {
    let id = UUID()
    let card: CollectionCard
    let collectionEntryId: String
    let copy: CollectionCardCopy?
    let canEditQuantity: Bool
}

private struct CardCopyContext: Identifiable {
    let card: CollectionCard
    let copy: CollectionCardCopy?

    init(card: CollectionCard, copy: CollectionCardCopy? = nil) {
        self.card = card
        self.copy = copy
    }

    var id: String {
        "\(card.id):\(copy?.id ?? "all")"
    }
}

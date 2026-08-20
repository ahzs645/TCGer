import SwiftUI

struct DecksView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var decks: [Deck] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var sheet: DecksSheet?

    private let apiService = APIService()

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    private var filteredDecks: [Deck] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return decks }
        return decks.filter {
            $0.name.localizedCaseInsensitiveContains(query) ||
                $0.tcg.localizedCaseInsensitiveContains(query) ||
                ($0.format?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    var body: some View {
        Group {
            if parentProvidesNavigation { content } else { NavigationStack { content } }
        }
    }

    private var content: some View {
        Group {
            if environmentStore.serverConfiguration.isOnDevice {
                ContentUnavailableView(
                    "Connect a Server for Decks",
                    systemImage: "rectangle.stack.badge.person.crop",
                    description: Text("Decks sync through a TCGer server and aren’t stored in on-device mode yet.")
                )
            } else if isLoading {
                ProgressView("Loading decks…")
            } else if let errorMessage {
                ErrorView(title: "Couldn’t Load Decks", message: errorMessage) {
                    Task { await load() }
                }
            } else if decks.isEmpty {
                ContentUnavailableView {
                    Label("No Decks", systemImage: "rectangle.stack")
                } description: {
                    Text("Build a deck from scratch or import an existing list.")
                } actions: {
                    Button("New Deck") { sheet = .create }
                        .buttonStyle(.borderedProminent)
                    Button("Import") { sheet = .importDeck }
                        .buttonStyle(.bordered)
                }
            } else {
                List {
                    ForEach(filteredDecks) { deck in
                        NavigationLink {
                            DeckDetailView(deckID: deck.id)
                                .environmentObject(environmentStore)
                        } label: {
                            DeckRow(deck: deck)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task { await delete(deck) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Decks")
        .searchable(text: $searchText, prompt: "Search decks")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Menu {
                    Button { sheet = .create } label: {
                        Label("New Deck", systemImage: "plus")
                    }
                    Button { sheet = .importDeck } label: {
                        Label("Import Deck", systemImage: "square.and.arrow.down")
                    }
                } label: {
                    Image(systemName: "plus")
                }
                .disabled(environmentStore.serverConfiguration.isOnDevice)
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $sheet) { item in
            switch item {
            case .create:
                CreateDeckSheet { deck in
                    decks.insert(deck, at: 0)
                }
                .environmentObject(environmentStore)
            case .importDeck:
                ImportDeckSheet { result in
                    decks.insert(result.deck, at: 0)
                }
                .environmentObject(environmentStore)
            }
        }
    }

    @MainActor
    private func load() async {
        guard !environmentStore.serverConfiguration.isOnDevice else {
            isLoading = false
            return
        }
        guard let token = environmentStore.authToken else {
            isLoading = false
            errorMessage = "Sign in is required to view decks."
            return
        }
        isLoading = decks.isEmpty
        errorMessage = nil
        do {
            decks = try await apiService.getDecks(config: environmentStore.serverConfiguration, token: token)
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func delete(_ deck: Deck) async {
        guard let token = environmentStore.authToken else { return }
        do {
            try await apiService.deleteDeck(
                config: environmentStore.serverConfiguration, token: token, deckId: deck.id
            )
            decks.removeAll { $0.id == deck.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum DecksSheet: String, Identifiable {
    case create
    case importDeck
    var id: String { rawValue }
}

private struct DeckRow: View {
    let deck: Deck

    @MainActor
    private var deckColor: Color {
        guard let colorHex = deck.colorHex else { return .accentColor }
        return Color(hex: colorHex)
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "rectangle.stack.fill")
                .font(.title2)
                .foregroundStyle(deckColor)
                .frame(width: 38)
            VStack(alignment: .leading, spacing: 5) {
                Text(deck.name).font(.headline).lineLimit(1)
                HStack(spacing: 8) {
                    GameBadge(tcg: deck.tcg)
                    if let format = deck.format, !format.isEmpty {
                        Text(format.capitalized).font(.caption).foregroundStyle(.secondary)
                    }
                    Label("\(deck.cardCount)", systemImage: "rectangle.stack")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

private struct CreateDeckSheet: View {
    let onCreated: (Deck) -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var game = TCGGame.pokemon
    @State private var format = ""
    @State private var isPublic = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Form {
                Section("Deck") {
                    TextField("Name", text: $name)
                    TextField("Description", text: $description, axis: .vertical)
                    Picker("Game", selection: $game) {
                        ForEach(environmentStore.enabledGames) { Text($0.displayName).tag($0) }
                    }
                    TextField("Format (optional)", text: $format)
                    Toggle("Public Deck", isOn: $isPublic)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .navigationTitle("New Deck")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Creating…" : "Create") { Task { await create() } }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
            .onAppear {
                if let first = environmentStore.enabledGames.first { game = first }
            }
        }
    }

    @MainActor
    private func create() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true
        errorMessage = nil
        do {
            let deck = try await apiService.createDeck(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                description: description.nilIfBlank,
                tcg: game.rawValue,
                format: format.nilIfBlank,
                isPublic: isPublic
            )
            onCreated(deck)
            HapticManager.notification(.success)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }
}

private struct ImportDeckSheet: View {
    let onImported: (DeckImportResult) -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var source = "text"
    @State private var data = ""
    @State private var name = ""
    @State private var game = TCGGame.pokemon
    @State private var format = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Form {
                Picker("Source", selection: $source) {
                    Text("Text List").tag("text")
                    Text("YDK").tag("ydk")
                    Text("Magic Arena").tag("arena")
                    Text("Moxfield URL").tag("moxfield")
                    Text("Archidekt URL").tag("archidekt")
                }
                Section("Details") {
                    TextField("Deck name (optional)", text: $name)
                    Picker("Game", selection: $game) {
                        ForEach(environmentStore.enabledGames) { Text($0.displayName).tag($0) }
                    }
                    .disabled(source == "ydk")
                    TextField("Format (optional)", text: $format)
                }
                Section(source == "moxfield" || source == "archidekt" ? "URL" : "Deck List") {
                    TextEditor(text: $data).frame(minHeight: 180)
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Import Deck")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Importing…" : "Import") { Task { await importDeck() } }
                        .disabled(data.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
            .onAppear { if let first = environmentStore.enabledGames.first { game = first } }
        }
    }

    @MainActor
    private func importDeck() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true
        errorMessage = nil
        do {
            let result = try await apiService.importDeck(
                config: environmentStore.serverConfiguration,
                token: token,
                source: source,
                data: data,
                name: name.nilIfBlank,
                tcg: source == "ydk" ? nil : game.rawValue,
                format: format.nilIfBlank
            )
            onImported(result)
            HapticManager.notification(.success)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }
}

private struct DeckDetailView: View {
    let deckID: String

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var deck: Deck?
    @State private var validation: DeckValidation?
    @State private var ownership: DeckOwnership?
    @State private var ydkExport: DeckYDKExport?
    @State private var isLoading = true
    @State private var isChecking = false
    @State private var errorMessage: String?
    @State private var activeSheet: DeckDetailSheet?

    private let apiService = APIService()

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Loading deck…")
            } else if let errorMessage, deck == nil {
                ErrorView(title: "Couldn’t Load Deck", message: errorMessage) { Task { await load() } }
            } else if let deck {
                List {
                    Section {
                        HStack {
                            GameBadge(tcg: deck.tcg)
                            if let format = deck.format { Text(format.capitalized).foregroundStyle(.secondary) }
                            Spacer()
                            Label("\(deck.cardCount)", systemImage: "rectangle.stack")
                                .foregroundStyle(.secondary)
                        }
                        if let description = deck.description, !description.isEmpty {
                            Text(description).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }

                    if let validation {
                        Section("Validation") {
                            Label(
                                validation.valid ? "Deck is valid" : "Deck needs attention",
                                systemImage: validation.valid ? "checkmark.seal.fill" : "exclamationmark.triangle.fill"
                            )
                            .foregroundStyle(validation.valid ? .green : .orange)
                            ForEach(validation.errors, id: \.self) { Text($0).foregroundStyle(.red) }
                            ForEach(validation.warnings, id: \.self) { Text($0).foregroundStyle(.orange) }
                        }
                    }

                    if let ownership, ownership.missingCount > 0 {
                        Section("Missing \(ownership.missingCount) Cards") {
                            ForEach(ownership.missing) { card in
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(card.name)
                                        Text(card.zone.capitalized).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text("×\(card.quantity)").monospacedDigit()
                                }
                            }
                        }
                    }

                    ForEach(groupedCards(deck), id: \.zone) { group in
                        Section("\(group.zone.capitalized) · \(group.cards.reduce(0) { $0 + $1.quantity })") {
                            ForEach(group.cards) { card in
                                Button { activeSheet = .editCard(card) } label: {
                                    DeckCardRow(card: card)
                                }
                                .buttonStyle(.plain)
                                .swipeActions {
                                    Button(role: .destructive) { Task { await remove(card) } } label: {
                                        Label("Remove", systemImage: "trash")
                                    }
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle(deck?.name ?? "Deck")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                if let ydkExport {
                    ShareLink(item: ydkExport.content) { Image(systemName: "square.and.arrow.up") }
                }
                Menu {
                    Button { activeSheet = .addCard } label: { Label("Add Card", systemImage: "plus") }
                    Button { Task { await runChecks() } } label: {
                        Label("Validate & Check Ownership", systemImage: "checkmark.shield")
                    }
                    Button { Task { await exportYDK() } } label: {
                        Label("Prepare YDK Export", systemImage: "square.and.arrow.up")
                    }
                } label: {
                    if isChecking { ProgressView() } else { Image(systemName: "ellipsis.circle") }
                }
                .disabled(deck == nil || isChecking)
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .addCard:
                if let deck {
                    DeckCardPicker(deck: deck) { await load() }
                        .environmentObject(environmentStore)
                }
            case .editCard(let card):
                EditDeckCardSheet(deckID: deckID, card: card) { await load() }
                    .environmentObject(environmentStore)
            }
        }
        .alert("Deck", isPresented: Binding(
            get: { errorMessage != nil && deck != nil },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "") }
    }

    private func groupedCards(_ deck: Deck) -> [(zone: String, cards: [DeckCard])] {
        let order = ["main", "extra", "side"]
        let groups = Dictionary(grouping: deck.cards, by: \.zone)
        return order.compactMap { zone in groups[zone].map { (zone, $0) } } +
            groups.keys.filter { !order.contains($0) }.sorted().map { ($0, groups[$0] ?? []) }
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else { return }
        isLoading = deck == nil
        do {
            deck = try await apiService.getDeck(
                config: environmentStore.serverConfiguration, token: token, deckId: deckID
            )
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    @MainActor
    private func runChecks() async {
        guard let token = environmentStore.authToken else { return }
        isChecking = true
        do {
            async let result = apiService.validateDeck(
                config: environmentStore.serverConfiguration, token: token, deckId: deckID, format: deck?.format
            )
            async let owned = apiService.getDeckOwnership(
                config: environmentStore.serverConfiguration, token: token, deckId: deckID
            )
            validation = try await result
            ownership = try await owned
        } catch { errorMessage = error.localizedDescription }
        isChecking = false
    }

    @MainActor
    private func exportYDK() async {
        guard let token = environmentStore.authToken else { return }
        isChecking = true
        do {
            ydkExport = try await apiService.exportDeckYDK(
                config: environmentStore.serverConfiguration, token: token, deckId: deckID
            )
        } catch { errorMessage = error.localizedDescription }
        isChecking = false
    }

    @MainActor
    private func remove(_ card: DeckCard) async {
        guard let token = environmentStore.authToken else { return }
        do {
            try await apiService.removeDeckCard(
                config: environmentStore.serverConfiguration,
                token: token,
                deckId: deckID,
                cardId: card.id
            )
            await load()
        } catch { errorMessage = error.localizedDescription }
    }
}

private enum DeckDetailSheet: Identifiable {
    case addCard
    case editCard(DeckCard)

    var id: String {
        switch self {
        case .addCard: "add"
        case .editCard(let card): "edit-\(card.id)"
        }
    }
}

private struct DeckCardRow: View {
    let card: DeckCard

    var body: some View {
        HStack(spacing: 12) {
            if let value = card.imageUrlSmall ?? card.imageUrl, let url = URL(string: value) {
                CachedAsyncImage(url: url) { phase in
                    if case .success(let image) = phase { image.resizable().scaledToFit() }
                    else { Color(.tertiarySystemFill) }
                }
                .frame(width: 34, height: 46)
                .clipShape(.rect(cornerRadius: 3))
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(card.name).font(.subheadline.weight(.medium)).lineLimit(1)
                if let set = card.setName ?? card.setCode { Text(set).font(.caption).foregroundStyle(.secondary) }
            }
            Spacer()
            Text("×\(card.quantity)").font(.headline.monospacedDigit())
        }
    }
}

private struct DeckCardPicker: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss

    let deck: Deck
    let onAdded: () async -> Void

    @State private var searchModel = CatalogCardSearchModel()
    @State private var selectedCard: Card?
    @State private var quantity = 1
    @State private var zone = "main"
    @State private var addErrorMessage: String?

    private let apiService = APIService()

    var body: some View {
        @Bindable var searchModel = searchModel

        NavigationStack {
            Group {
                if searchModel.isSearching { ProgressView("Searching…") }
                else if let errorMessage = searchModel.errorMessage ?? addErrorMessage {
                    ErrorView(title: "Search Failed", message: errorMessage)
                }
                else if searchModel.results.isEmpty {
                    ContentUnavailableView("Search for Cards", systemImage: "magnifyingglass")
                } else {
                    List(searchModel.results) { card in
                        Button { selectedCard = card } label: {
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(card.name).foregroundStyle(.primary)
                                    Text(card.setName ?? card.setCode ?? deck.tcg.capitalized)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "plus.circle")
                            }
                        }
                    }
                }
            }
            .navigationTitle("Add Card")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchModel.query, prompt: "Search \(TCGGame(rawValue: deck.tcg)?.shortName ?? deck.tcg)")
            .onSubmit(of: .search) { Task { await search() } }
            .onChange(of: searchModel.query) {
                searchModel.resetIfQueryIsEmpty()
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $selectedCard) { card in
                NavigationStack {
                    Form {
                        Section { Text(card.name).font(.headline) }
                        Stepper("Quantity: \(quantity)", value: $quantity, in: 1...99)
                        Picker("Zone", selection: $zone) {
                            Text("Main").tag("main")
                            Text("Extra").tag("extra")
                            Text("Side").tag("side")
                        }
                    }
                    .navigationTitle("Add to Deck")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { selectedCard = nil } }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Add") { Task { await add(card) } }
                        }
                    }
                }
            }
        }
    }

    @MainActor
    private func search() async {
        addErrorMessage = nil
        await searchModel.search(
            config: environmentStore.serverConfiguration,
            authToken: environmentStore.authToken,
            game: TCGGame(rawValue: deck.tcg) ?? .all
        )
    }

    @MainActor
    private func add(_ card: Card) async {
        guard let token = environmentStore.authToken else { return }
        do {
            _ = try await apiService.addCardToDeck(
                config: environmentStore.serverConfiguration,
                token: token,
                deckId: deck.id,
                card: card,
                quantity: quantity,
                zone: zone
            )
            await onAdded()
            HapticManager.notification(.success)
            selectedCard = nil
        } catch { addErrorMessage = error.localizedDescription; selectedCard = nil }
    }
}

private struct EditDeckCardSheet: View {
    let deckID: String
    let card: DeckCard
    let onSaved: () async -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var quantity: Int
    @State private var zone: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    init(deckID: String, card: DeckCard, onSaved: @escaping () async -> Void) {
        self.deckID = deckID
        self.card = card
        self.onSaved = onSaved
        _quantity = State(initialValue: card.quantity)
        _zone = State(initialValue: card.zone)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(card.name).font(.headline) }
                Stepper("Quantity: \(quantity)", value: $quantity, in: 1...99)
                Picker("Zone", selection: $zone) {
                    Text("Main").tag("main")
                    Text("Extra").tag("extra")
                    Text("Side").tag("side")
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
            }
            .navigationTitle("Edit Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }.disabled(isSaving)
                }
            }
        }
    }

    @MainActor
    private func save() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true
        do {
            _ = try await apiService.updateDeckCard(
                config: environmentStore.serverConfiguration,
                token: token,
                deckId: deckID,
                cardId: card.id,
                quantity: quantity,
                zone: zone
            )
            await onSaved()
            dismiss()
        } catch { errorMessage = error.localizedDescription; isSaving = false }
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

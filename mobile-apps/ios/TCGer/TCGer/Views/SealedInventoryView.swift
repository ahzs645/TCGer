import SwiftUI

struct SealedInventoryView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var inventory: [SealedInventoryItem] = []
    @State private var ledgers: [SealedOpeningLedger] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showingCatalog = false
    @State private var showingBarcodeScanner = false
    @State private var showingPackOpening = false
    @State private var scannedProduct: SealedProduct?
    @State private var barcodeError: String?
    @State private var searchText = ""
    @State private var actionSheet: SealedActionSheet?

    private let apiService = APIService()

    private var filteredInventory: [SealedInventoryItem] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return inventory }
        return inventory.filter {
            $0.product.name.localizedCaseInsensitiveContains(query) ||
            $0.product.tcg.localizedCaseInsensitiveContains(query) ||
            ($0.product.setCode?.localizedCaseInsensitiveContains(query) ?? false) ||
            ($0.product.upc?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    private var filteredLedgers: [SealedOpeningLedger] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return ledgers }
        return ledgers.filter { $0.productName.localizedCaseInsensitiveContains(query) }
    }

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                sealedInventoryContent
            } else {
                NavigationStack {
                    sealedInventoryContent
                }
            }
        }
    }

    private var sealedInventoryContent: some View {
        Group {
                if isLoading {
                    ProgressView("Loading sealed inventory...")
                } else if let error = errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 50))
                            .foregroundColor(.orange)
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                        Button("Retry") { Task { await loadInventory() } }
                            .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if inventory.isEmpty && ledgers.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "shippingbox")
                            .font(.system(size: 50))
                            .foregroundColor(.secondary)
                        Text("No Sealed Products")
                            .font(.title3)
                            .fontWeight(.semibold)
                        Text("Track your sealed product inventory")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Button {
                            showingCatalog = true
                        } label: {
                            Label("Browse Products", systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    if filteredInventory.isEmpty && filteredLedgers.isEmpty {
                        ContentUnavailableView.search(text: searchText)
                    } else {
                        List {
                        if !filteredLedgers.isEmpty {
                            Section("Opened Product P&L") {
                                ForEach(filteredLedgers) { ledger in
                                    Button {
                                        actionSheet = .ledger(ledger)
                                    } label: {
                                        SealedLedgerRow(ledger: ledger)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                        if !filteredInventory.isEmpty {
                            Section("Sealed Inventory") {
                                ForEach(filteredInventory) { item in
                                    SealedInventoryRow(item: item)
                                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                            Button(role: .destructive) {
                                                Task { await deleteItem(item) }
                                            } label: {
                                                Label("Delete", systemImage: "trash")
                                            }
                                            if !environmentStore.serverConfiguration.isOnDevice {
                                                Button {
                                                    actionSheet = .open(item)
                                                } label: {
                                                    Label("Open", systemImage: "shippingbox.and.arrow.backward")
                                                }
                                                .tint(.orange)
                                            }
                                        }
                                    }
                            }
                        }
                    }
                        .listStyle(.insetGrouped)
                    }
                }
        }
        .scrollEdgeEffectStyle(.soft, for: .top)
        .navigationTitle("Sealed Products")
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search inventory"
            )
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        showingPackOpening = true
                    } label: {
                        Image(systemName: "shippingbox.and.arrow.backward.fill")
                    }
                    .accessibilityLabel("Open packs")

                    Button {
                        showingBarcodeScanner = true
                    } label: {
                        Image(systemName: "barcode.viewfinder")
                    }
                    .accessibilityLabel("Scan sealed product barcode")

                    Button {
                        showingCatalog = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable { await loadInventory() }
            .task { await loadInventory() }
            .sheet(isPresented: $showingCatalog) {
                SealedProductCatalogSheet(onAdd: { productId, qty, price in
                    Task {
                        await addToInventory(productId: productId, quantity: qty, purchasePrice: price)
                    }
                })
                .environmentObject(environmentStore)
            }
            .sheet(isPresented: $showingBarcodeScanner) {
                SealedBarcodeScannerSheet { barcode in
                    Task { await findProduct(barcode: barcode) }
                }
            }
            .fullScreenCover(isPresented: $showingPackOpening) {
                PackOpeningView()
            }
            .sheet(item: $scannedProduct) { product in
                ScannedSealedProductSheet(product: product) { quantity, purchasePrice in
                    Task {
                        await addToInventory(
                            productId: product.id,
                            quantity: quantity,
                            purchasePrice: purchasePrice
                        )
                    }
                }
            }
            .sheet(item: $actionSheet) { action in
                switch action {
                case .open(let item):
                    RecordSealedOpeningSheet(item: item) {
                        await loadInventory()
                    }
                    .environmentObject(environmentStore)
                case .ledger(let ledger):
                    SealedLedgerDetailSheet(ledger: ledger) {
                        await loadInventory()
                    }
                    .environmentObject(environmentStore)
                }
            }
        .alert("Barcode Scan", isPresented: Binding(
            get: { barcodeError != nil },
            set: { if !$0 { barcodeError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(barcodeError ?? "Unable to look up that barcode.")
        }
    }

    @MainActor
    private func loadInventory() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }
        isLoading = inventory.isEmpty
        do {
            inventory = try await apiService.getUserSealedInventory(
                config: environmentStore.serverConfiguration, token: token
            )
            ledgers = (try? await apiService.getSealedOpeningLedgers(
                config: environmentStore.serverConfiguration,
                token: token
            )) ?? []
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func addToInventory(productId: String, quantity: Int, purchasePrice: Double?) async {
        guard let token = environmentStore.authToken else { return }
        do {
            let item = try await apiService.addSealedInventory(
                config: environmentStore.serverConfiguration, token: token,
                productId: productId, quantity: quantity, purchasePrice: purchasePrice
            )
            inventory.insert(item, at: 0)
            HapticManager.notification(.success)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func findProduct(barcode: String) async {
        let token = environmentStore.authToken ?? ""
        if !environmentStore.serverConfiguration.isOnDevice, token.isEmpty {
            barcodeError = "Sign in before looking up sealed products."
            return
        }
        do {
            scannedProduct = try await apiService.getSealedProduct(
                config: environmentStore.serverConfiguration,
                token: token,
                barcode: barcode
            )
        } catch {
            barcodeError = error.localizedDescription
        }
    }

    @MainActor
    private func deleteItem(_ item: SealedInventoryItem) async {
        guard let token = environmentStore.authToken else { return }
        do {
            try await apiService.deleteSealedInventory(
                config: environmentStore.serverConfiguration, token: token, itemId: item.id
            )
            inventory.removeAll { $0.id == item.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum SealedActionSheet: Identifiable {
    case open(SealedInventoryItem)
    case ledger(SealedOpeningLedger)

    var id: String {
        switch self {
        case .open(let item): "open-\(item.id)"
        case .ledger(let ledger): "ledger-\(ledger.id)"
        }
    }
}

private struct SealedLedgerRow: View {
    let ledger: SealedOpeningLedger

    private var tcg: String? {
        ledger.cards.first {
            !$0.tcg.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }?.tcg
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(ledger.productName)
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                Text(
                    "\(ledger.profitLoss >= 0 ? "+" : "")\(ledger.profitLoss.priceText)"
                )
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(ledger.profitLoss >= 0 ? .green : .red)
            }
            HStack(spacing: 12) {
                Label("\(ledger.invested.priceText) in", systemImage: "creditcard")
                Label("\(ledger.liveValue.priceText) live", systemImage: "chart.line.uptrend.xyaxis")
                Label("\(ledger.realizedProceeds.priceText) sold", systemImage: "banknote")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
            HStack(spacing: 8) {
                if let tcg, !tcg.isEmpty {
                    GameBadge(tcg: tcg)
                }
                Text("\(ledger.activeCopies) active · \(ledger.soldCopies) sold")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct SealedInventoryRow: View {
    let item: SealedInventoryItem

    var body: some View {
        HStack(spacing: 12) {
            if let url = item.product.imageUrl, let imageURL = URL(string: url) {
                CachedAsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().aspectRatio(contentMode: .fit)
                    default:
                        Rectangle().fill(Color(.systemGray5))
                            .overlay(Image(systemName: "shippingbox").foregroundColor(.secondary))
                    }
                }
                .frame(width: 50, height: 50)
                .cornerRadius(6)
            } else {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color(.systemGray5))
                    .frame(width: 50, height: 50)
                    .overlay(Image(systemName: "shippingbox").foregroundColor(.secondary))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(item.product.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    GameBadge(tcg: item.product.tcg)

                    Text(item.product.productType.capitalized)
                        .font(.caption2)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color.accentColor.opacity(0.15))
                        .foregroundColor(.accentColor)
                        .cornerRadius(4)

                    Text("Qty: \(item.quantity)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if let price = item.purchasePrice {
                    Text(price.priceText)
                        .font(.caption)
                        .foregroundColor(.green)
                }
            }
            Spacer()
        }
        .padding(.vertical, 4)
    }
}

private struct RecordSealedOpeningSheet: View {
    let item: SealedInventoryItem
    let onSaved: () async -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var openedQuantity = 1
    @State private var openedAt = Date()
    @State private var notes = ""
    @State private var collections: [Collection] = []
    @State private var selectedCollectionCardIDs = Set<String>()
    @State private var searchText = ""
    @State private var isLoadingCards = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    private var pulledCards: [(collection: Collection, card: CollectionCard)] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return collections.flatMap { collection in
            collection.cards.compactMap { card in
                guard query.isEmpty || card.name.localizedCaseInsensitiveContains(query) else { return nil }
                return (collection, card)
            }
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Opening") {
                    Text(item.product.name).font(.headline)
                    Stepper(
                        "Quantity: \(openedQuantity)",
                        value: $openedQuantity,
                        in: 1...max(1, item.quantity)
                    )
                    DatePicker("Opened", selection: $openedAt, displayedComponents: [.date, .hourAndMinute])
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                }

                Section {
                    if isLoadingCards {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    } else if pulledCards.isEmpty {
                        Text("No collection cards found. You can record the opening now and link pulls later from the server.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(pulledCards, id: \.card.id) { entry in
                            Button {
                                if selectedCollectionCardIDs.contains(entry.card.id) {
                                    selectedCollectionCardIDs.remove(entry.card.id)
                                } else {
                                    selectedCollectionCardIDs.insert(entry.card.id)
                                }
                            } label: {
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(entry.card.name).foregroundStyle(.primary)
                                        Text(entry.collection.name).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: selectedCollectionCardIDs.contains(entry.card.id) ? "checkmark.circle.fill" : "circle")
                                }
                            }
                        }
                    }
                } header: {
                    Text("Link Pulled Cards (\(selectedCollectionCardIDs.count))")
                } footer: {
                    Text("Select copies already added to your collection that came from this opening.")
                }

                if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
            }
            .navigationTitle("Record Opening")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Search collection cards")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }.disabled(isSaving)
                }
            }
            .task { await loadCards() }
        }
    }

    @MainActor
    private func loadCards() async {
        guard let token = environmentStore.authToken else { isLoadingCards = false; return }
        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: environmentStore.offlineModeEnabled
            )
        } catch { errorMessage = "Cards couldn’t be loaded for linking: \(error.localizedDescription)" }
        isLoadingCards = false
    }

    @MainActor
    private func save() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true
        errorMessage = nil
        do {
            _ = try await apiService.createSealedOpening(
                config: environmentStore.serverConfiguration,
                token: token,
                inventoryId: item.id,
                openedQuantity: openedQuantity,
                collectionIds: Array(selectedCollectionCardIDs),
                openedAt: ISO8601DateFormatter().string(from: openedAt),
                notes: notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes
            )
            await onSaved()
            HapticManager.notification(.success)
            dismiss()
        } catch { errorMessage = error.localizedDescription; isSaving = false }
    }
}

private struct SealedLedgerDetailSheet: View {
    let ledger: SealedOpeningLedger
    let onChanged: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedCard: SealedLedgerCard?

    var body: some View {
        NavigationStack {
            List {
                Section("Summary") {
                    LabeledContent("Invested", value: ledger.invested.priceText)
                    LabeledContent("Live Value", value: ledger.liveValue.priceText)
                    LabeledContent("Realized", value: ledger.realizedProceeds.priceText)
                    LabeledContent("Profit / Loss") {
                        Text("\(ledger.profitLoss >= 0 ? "+" : "")\(ledger.profitLoss.priceText)")
                            .foregroundStyle(ledger.profitLoss >= 0 ? .green : .red)
                    }
                }
                Section("Opened Cards") {
                    ForEach(ledger.cards) { card in
                        Button {
                            if card.status == "active" { selectedCard = card }
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(card.cardName).foregroundStyle(.primary)
                                    HStack { GameBadge(tcg: card.tcg); Text("×\(card.quantity)") }
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                VStack(alignment: .trailing) {
                                    Text(card.status.capitalized)
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(card.status == "sold" ? .green : .secondary)
                                    Text((card.status == "sold" ? card.realizedProceeds : card.liveValue).priceText)
                                        .font(.subheadline.monospacedDigit())
                                }
                            }
                        }
                        .disabled(card.status != "active")
                    }
                }
            }
            .navigationTitle(ledger.productName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .sheet(item: $selectedCard) { card in
                RecordOpenedCardSaleSheet(card: card) {
                    await onChanged()
                    dismiss()
                }
            }
        }
    }
}

private struct RecordOpenedCardSaleSheet: View {
    let card: SealedLedgerCard
    let onSaved: () async -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var proceeds = ""
    @State private var soldAt = Date()
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Form {
                Section { Text(card.cardName).font(.headline); GameBadge(tcg: card.tcg) }
                Section("Sale") {
                    TextField("Total proceeds", text: $proceeds).keyboardType(.decimalPad)
                    DatePicker("Sold", selection: $soldAt, displayedComponents: [.date, .hourAndMinute])
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
            }
            .navigationTitle("Record Sale")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(Double(proceeds) == nil || isSaving)
                }
            }
        }
    }

    @MainActor
    private func save() async {
        guard let token = environmentStore.authToken, let value = Double(proceeds), value >= 0 else { return }
        isSaving = true
        do {
            _ = try await apiService.recordOpenedCardSale(
                config: environmentStore.serverConfiguration,
                token: token,
                cardId: card.id,
                proceeds: value,
                soldAt: ISO8601DateFormatter().string(from: soldAt)
            )
            await onSaved()
            HapticManager.notification(.success)
            dismiss()
        } catch { errorMessage = error.localizedDescription; isSaving = false }
    }
}

private struct SealedProductCatalogSheet: View {
    let onAdd: (String, Int, Double?) -> Void
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var products: [SealedProduct] = []
    @State private var isLoading = true
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var selectedProduct: SealedProduct?
    @State private var quantity = 1
    @State private var priceText = ""

    private let apiService = APIService()

    private var filteredProducts: [SealedProduct] {
        let game = environmentStore.enabledGames.count == 1
            ? environmentStore.enabledGames[0]
            : selectedGame
        let gameFiltered = game == .all
            ? products.filter { product in
                environmentStore.enabledGames.contains {
                    $0.rawValue.caseInsensitiveCompare(product.tcg) == .orderedSame
                }
            }
            : products.filter { $0.tcg.caseInsensitiveCompare(game.rawValue) == .orderedSame }

        if searchText.isEmpty { return gameFiltered }
        let query = searchText.lowercased()
        return gameFiltered.filter { $0.name.lowercased().contains(query) }
    }

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading products...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if products.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "shippingbox.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                        Text("No sealed products available")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    VStack(spacing: 0) {
                        if environmentStore.shouldShowGamePicker {
                            GamePickerPills(
                                selection: $selectedGame,
                                games: environmentStore.gamePickerGames
                            )
                            .background(Color(.systemBackground))

                            Divider()
                        }

                        List(filteredProducts) { product in
                            Button {
                                selectedProduct = product
                            } label: {
                                HStack(spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(product.name)
                                            .font(.subheadline)
                                            .fontWeight(.medium)
                                        HStack(spacing: 6) {
                                            GameBadge(tcg: product.tcg)

                                            Text(product.productType.capitalized)
                                                .font(.caption2)
                                                .padding(.horizontal, 5)
                                                .padding(.vertical, 2)
                                                .background(Color.accentColor.opacity(0.15))
                                                .foregroundColor(.accentColor)
                                                .cornerRadius(4)
                                            if let msrp = product.msrp {
                                                Text("MSRP \(msrp.priceText)")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                            }
                                        }
                                    }
                                    Spacer()
                                    Image(systemName: "plus.circle")
                                        .foregroundColor(.accentColor)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .searchable(
                        text: $searchText,
                        placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search products"
                    )
                }
            }
            .navigationTitle("Product Catalog")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task { await loadProducts() }
            .alert("Add to Inventory", isPresented: Binding(
                get: { selectedProduct != nil },
                set: { if !$0 { selectedProduct = nil; quantity = 1; priceText = "" } }
            )) {
                TextField("Purchase Price", text: $priceText)
                    .keyboardType(.decimalPad)
                Button("Add") {
                    if let product = selectedProduct {
                        onAdd(product.id, quantity, Double(priceText))
                        selectedProduct = nil
                        quantity = 1
                        priceText = ""
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Add \(selectedProduct?.name ?? "") to your inventory?")
            }
        }
    }

    @MainActor
    private func loadProducts() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }
        do {
            products = try await apiService.getSealedProducts(
                config: environmentStore.serverConfiguration, token: token
            )
            isLoading = false
        } catch {
            isLoading = false
        }
    }
}

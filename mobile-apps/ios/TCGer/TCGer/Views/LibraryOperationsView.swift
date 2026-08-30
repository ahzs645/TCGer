import SwiftUI

struct LibraryOperationsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    var body: some View {
        Group {
            if environmentStore.serverConfiguration.isOnDevice {
                ContentUnavailableView(
                    "Connect a Server",
                    systemImage: "externaldrive.badge.wifi",
                    description: Text("Physical storage, checkout, certification, and audit workflows sync through a TCGer server.")
                )
            } else {
                List {
                    Section("Organize") {
                        NavigationLink {
                            PhysicalStorageView()
                        } label: {
                            OperationRow(
                                title: "Physical Storage",
                                subtitle: "Binders, boxes, pages, slots, locks, and Unsorted",
                                systemImage: "square.grid.3x3.square"
                            )
                        }
                        NavigationLink {
                            RapidSetEntryView()
                        } label: {
                            OperationRow(
                                title: "Rapid Set Entry",
                                subtitle: "Keep a set pinned and enter collector numbers",
                                systemImage: "keyboard.badge.ellipsis"
                            )
                        }
                    }

                    Section("Intake & Finance") {
                        NavigationLink {
                            AcquisitionCostSplitterView()
                        } label: {
                            OperationRow(
                                title: "Acquisition Cost Split",
                                subtitle: "Allocate exact cents and keep an audit receipt",
                                systemImage: "divide.circle"
                            )
                        }
                        NavigationLink {
                            PSACertIntakeView()
                        } label: {
                            OperationRow(
                                title: "PSA Certification Intake",
                                subtitle: "Look up a cert and confirm the exact printing",
                                systemImage: "checkmark.seal"
                            )
                        }
                        NavigationLink {
                            PrintedIdentityEditorView()
                        } label: {
                            OperationRow(
                                title: "Printed Identity",
                                subtitle: "Localized printed names and searchable aliases",
                                systemImage: "character.book.closed"
                            )
                        }
                    }

                    Section("Pricing") {
                        NavigationLink {
                            PricingProvenanceView()
                        } label: {
                            OperationRow(
                                title: "Price Provenance",
                                subtitle: "Native quotes, FX source, match confidence, and coverage",
                                systemImage: "chart.line.text.clipboard"
                            )
                        }
                    }
                }
            }
        }
        .navigationTitle("Library Operations")
    }
}

private struct OperationRow: View {
    let title: String
    let subtitle: String
    let systemImage: String

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(Color.accentColor)
        }
        .padding(.vertical, 3)
    }
}

private struct PhysicalStorageView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var containers: [StorageContainer] = []
    @State private var state: OperationLoadState = .loading
    @State private var showingCreate = false

    private let apiService = APIService()

    var body: some View {
        Group {
            switch state {
            case .idle, .loading:
                ProgressView("Loading storage…")
            case .failed(let message):
                ErrorView(title: "Couldn’t Load Storage", message: message) {
                    Task { await load() }
                }
            case .loaded:
                if containers.isEmpty {
                    ContentUnavailableView {
                        Label("No Physical Storage", systemImage: "shippingbox")
                    } description: {
                        Text("Create a binder or box. TCGer will keep an Unsorted queue for cards without a slot.")
                    } actions: {
                        Button("Create Storage") { showingCreate = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else {
                    List(containers) { container in
                        NavigationLink {
                            StorageContainerEditorView(container: container, onChanged: load)
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: container.kind == .binder ? "books.vertical" : "shippingbox")
                                    .foregroundStyle(container.isUnsorted ? Color.orange : Color.accentColor)
                                    .frame(width: 28)
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(container.name)
                                    Text("\(container.compartments.count) sections · \(placementCount(container)) placed")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if container.locked { Image(systemName: "lock.fill").foregroundStyle(.secondary) }
                            }
                        }
                    }
                }
            }
        }
        .navigationTitle("Physical Storage")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showingCreate = true } label: { Image(systemName: "plus") }
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(isPresented: $showingCreate) {
            CreateStorageContainerSheet {
                showingCreate = false
                await load()
            }
            .environmentObject(environmentStore)
        }
    }

    private func placementCount(_ container: StorageContainer) -> Int {
        container.compartments.reduce(0) { result, compartment in
            result + compartment.placements.reduce(0) { $0 + $1.quantity }
        }
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else {
            state = .failed("Sign in is required.")
            return
        }
        if containers.isEmpty { state = .loading }
        do {
            containers = try await apiService.getStorageContainers(
                config: environmentStore.serverConfiguration,
                token: token
            )
            state = .loaded
        } catch is CancellationError {
            return
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

private struct CreateStorageContainerSheet: View {
    let onCreated: () async -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var kind = StorageContainerKind.binder
    @State private var isUnsorted = false
    @State private var locked = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Form {
                Section("Container") {
                    TextField("Name", text: $name)
                    Picker("Kind", selection: $kind) {
                        ForEach(StorageContainerKind.allCases) { kind in
                            Text(kind.title).tag(kind)
                        }
                    }
                    Toggle("Unsorted queue", isOn: $isUnsorted)
                    Toggle("Lock changes", isOn: $locked)
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("New Storage")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Creating…" : "Create") { Task { await create() } }
                        .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
    }

    @MainActor
    private func create() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true
        errorMessage = nil
        do {
            _ = try await apiService.createStorageContainer(
                config: environmentStore.serverConfiguration,
                token: token,
                request: CreateStorageContainerRequest(
                    name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                    kind: kind,
                    binderId: nil,
                    order: nil,
                    isUnsorted: isUnsorted,
                    locked: locked
                )
            )
            await onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }
}

private struct StorageContainerEditorView: View {
    let container: StorageContainer
    let onChanged: () async -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var showingAddCompartment = false
    @State private var placementTarget: StoragePlacementTarget?
    @State private var mutationError: String?
    @State private var isMutating = false
    private let apiService = APIService()

    var body: some View {
        List {
            if container.locked {
                Label("This container is locked", systemImage: "lock.fill")
                    .foregroundStyle(.secondary)
            }
            if let mutationError { Text(mutationError).foregroundStyle(.red) }
            ForEach(container.compartments.sorted { $0.order < $1.order }) { compartment in
                Section {
                    LazyVGrid(
                        columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: max(1, compartment.columns)),
                        spacing: 8
                    ) {
                        ForEach(0..<compartment.capacity, id: \.self) { slot in
                            StorageSlotView(
                                slot: slot,
                                placements: compartment.placements.filter { $0.slotIndex == slot },
                                isLocked: container.locked || compartment.locked,
                                onAssign: { placementTarget = .init(compartment: compartment, slot: slot) },
                                onRemove: { placement in Task { await remove(placement) } }
                            )
                        }
                    }
                    .padding(.vertical, 6)
                } header: {
                    HStack {
                        Text(compartment.label)
                        if let page = compartment.pageNumber { Text("Page \(page)") }
                        if compartment.locked { Image(systemName: "lock.fill") }
                        Spacer()
                        Menu {
                            Button(compartment.locked ? "Unlock" : "Lock") {
                                Task { await update(compartment, locked: !compartment.locked) }
                            }
                            Button("Move earlier") { Task { await update(compartment, order: max(0, compartment.order - 1)) } }
                            Button("Move later") { Task { await update(compartment, order: compartment.order + 1) } }
                        } label: { Image(systemName: "ellipsis.circle") }
                        .disabled(container.locked || isMutating)
                    }
                }
            }
        }
        .navigationTitle(container.name)
        .toolbar {
            ToolbarItem(placement: .secondaryAction) {
                Button(container.locked ? "Unlock" : "Lock") { Task { await updateContainerLock() } }
                    .disabled(isMutating)
            }
            ToolbarItem(placement: .primaryAction) {
                Button { showingAddCompartment = true } label: { Image(systemName: "plus.rectangle.on.rectangle") }
                    .disabled(container.locked)
            }
        }
        .sheet(isPresented: $showingAddCompartment) {
            CreateCompartmentSheet(container: container) {
                showingAddCompartment = false
                await onChanged()
            }
        }
        .sheet(item: $placementTarget) { target in
            AssignStorageSlotSheet(container: container, target: target) {
                placementTarget = nil
                await onChanged()
            }
            .environmentObject(environmentStore)
        }
    }

    @MainActor private func updateContainerLock() async {
        guard let token = environmentStore.authToken else { return }
        isMutating = true; mutationError = nil
        defer { isMutating = false }
        do {
            _ = try await apiService.updateStorageContainer(
                config: environmentStore.serverConfiguration, token: token, containerId: container.id,
                request: .init(name: nil, order: nil, locked: !container.locked)
            )
            await onChanged()
        } catch { mutationError = error.localizedDescription }
    }

    @MainActor private func update(_ compartment: StorageCompartment, locked: Bool? = nil, order: Int? = nil) async {
        guard let token = environmentStore.authToken else { return }
        isMutating = true; mutationError = nil
        defer { isMutating = false }
        do {
            _ = try await apiService.updateStorageCompartment(
                config: environmentStore.serverConfiguration, token: token, compartmentId: compartment.id,
                request: .init(label: nil, order: order, pageNumber: nil, locked: locked)
            )
            await onChanged()
        } catch { mutationError = error.localizedDescription }
    }

    @MainActor private func remove(_ placement: StoragePlacement) async {
        guard let token = environmentStore.authToken else { return }
        isMutating = true; mutationError = nil
        defer { isMutating = false }
        do {
            try await apiService.removeStoragePlacement(
                config: environmentStore.serverConfiguration, token: token, placementId: placement.id
            )
            await onChanged()
        } catch { mutationError = error.localizedDescription }
    }
}

private struct StorageSlotView: View {
    let slot: Int
    let placements: [StoragePlacement]
    let isLocked: Bool
    let onAssign: () -> Void
    let onRemove: (StoragePlacement) -> Void

    var body: some View {
        VStack(spacing: 4) {
            Text("\(slot + 1)").font(.caption2).foregroundStyle(.secondary)
            if let placement = placements.first {
                Text(placement.printedName ?? placement.cardName ?? placement.collectionEntryId)
                    .font(.caption2)
                    .lineLimit(2)
                if placement.quantity > 1 {
                    Text("×\(placement.quantity)").font(.caption2.bold())
                }
                if !isLocked {
                    Button(role: .destructive) { onRemove(placement) } label: {
                        Image(systemName: "xmark.circle.fill").font(.caption)
                    }.buttonStyle(.plain)
                }
            } else {
                Button(action: onAssign) {
                    Image(systemName: "plus.rectangle.on.rectangle").foregroundStyle(.tertiary)
                }.buttonStyle(.plain).disabled(isLocked)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 64)
        .background(.quaternary, in: .rect(cornerRadius: 8))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(placements.isEmpty ? "Slot \(slot + 1), empty" : "Slot \(slot + 1), occupied")
    }
}

private struct StoragePlacementTarget: Identifiable {
    let compartment: StorageCompartment
    let slot: Int
    var id: String { "\(compartment.id):\(slot)" }
}

private struct AssignStorageSlotSheet: View {
    let container: StorageContainer
    let target: StoragePlacementTarget
    let onSaved: () async -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var entryId = ""
    @State private var quantity = 1
    @State private var allowDuplicateStacking = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Form {
                LabeledContent("Location", value: "\(target.compartment.label) · Slot \(target.slot + 1)")
                TextField("Collection entry ID", text: $entryId).textInputAutocapitalization(.never)
                Stepper("Quantity: \(quantity)", value: $quantity, in: 1...999)
                Toggle("Stack duplicates in this slot", isOn: $allowDuplicateStacking)
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("Assign Card")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(entryId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving || container.locked || target.compartment.locked)
                }
            }
        }
    }

    @MainActor private func save() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true; errorMessage = nil
        do {
            _ = try await apiService.placeCollectionEntry(
                config: environmentStore.serverConfiguration, token: token,
                request: .init(
                    compartmentId: target.compartment.id,
                    collectionEntryId: entryId.trimmingCharacters(in: .whitespacesAndNewlines),
                    slotIndex: target.slot, quantity: quantity,
                    allowDuplicateStacking: allowDuplicateStacking
                )
            )
            await onSaved(); dismiss()
        } catch { errorMessage = error.localizedDescription; isSaving = false }
    }
}

private struct CreateCompartmentSheet: View {
    let container: StorageContainer
    let onCreated: () async -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var label = ""
    @State private var pageNumber = 1
    @State private var rows = 3
    @State private var columns = 3
    @State private var locked = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Form {
                TextField("Label", text: $label)
                Stepper("Page: \(pageNumber)", value: $pageNumber, in: 1...10_000)
                Stepper("Rows: \(rows)", value: $rows, in: 1...20)
                Stepper("Columns: \(columns)", value: $columns, in: 1...20)
                LabeledContent("Capacity", value: "\(rows * columns)")
                Toggle("Lock after creation", isOn: $locked)
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("Add Section")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Adding…" : "Add") { Task { await add() } }
                        .disabled(label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isSaving)
                }
            }
        }
    }

    @MainActor
    private func add() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true
        errorMessage = nil
        do {
            _ = try await apiService.createStorageCompartment(
                config: environmentStore.serverConfiguration,
                token: token,
                containerId: container.id,
                request: CreateStorageCompartmentRequest(
                    containerId: container.id,
                    label: label.trimmingCharacters(in: .whitespacesAndNewlines),
                    order: container.compartments.count,
                    pageNumber: pageNumber,
                    rows: rows,
                    columns: columns,
                    capacity: rows * columns,
                    locked: locked
                )
            )
            await onCreated()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
            isSaving = false
        }
    }
}

private struct RapidSetEntryView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @FocusState private var numberFocused: Bool
    @State private var binderId = ""
    @State private var game = TCGGame.pokemon
    @State private var setCode = ""
    @State private var collectorNumber = ""
    @State private var quantity = 1
    @State private var printedName = ""
    @State private var receipts: [RapidSetEntryReceipt] = []
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        List {
            Section("Pinned Destination") {
                TextField("Binder ID", text: $binderId)
                Picker("Game", selection: $game) {
                    ForEach(environmentStore.enabledGames) { game in Text(game.displayName).tag(game) }
                }
                TextField("Set code", text: $setCode)
                    .textInputAutocapitalization(.characters)
            }
            Section("Next Card") {
                TextField("Collector number", text: $collectorNumber)
                    .keyboardType(.asciiCapable)
                    .focused($numberFocused)
                    .onSubmit { Task { await add() } }
                TextField("Printed name (optional)", text: $printedName)
                Stepper("Quantity: \(quantity)", value: $quantity, in: 1...99)
                Button(isSubmitting ? "Adding…" : "Add and Keep Typing") { Task { await add() } }
                    .disabled(!canSubmit || isSubmitting)
            }
            if let errorMessage {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
            if !receipts.isEmpty {
                Section("Receipt") {
                    ForEach(receipts) { receipt in
                        HStack {
                            VStack(alignment: .leading) {
                                Text(receipt.printedName ?? receipt.cardName ?? "Added card")
                                if let item = receipt.items.first {
                                    Text("\(setCode) #\(item.collectorNumber) · ×\(item.quantity)")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Button("Undo") { Task { await undo(receipt) } }
                                .buttonStyle(.borderless)
                        }
                    }
                }
            }
        }
        .navigationTitle("Rapid Set Entry")
        .onAppear { numberFocused = true }
    }

    private var canSubmit: Bool {
        !binderId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !setCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !collectorNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    @MainActor
    private func add() async {
        guard canSubmit, let token = environmentStore.authToken else { return }
        isSubmitting = true
        errorMessage = nil
        do {
            let query = collectorNumber.trimmingCharacters(in: .whitespacesAndNewlines)
            let search = try await apiService.searchCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: query,
                game: game
            )
            guard let card = search.cards.first(where: {
                $0.setCode?.caseInsensitiveCompare(setCode.trimmingCharacters(in: .whitespacesAndNewlines)) == .orderedSame &&
                    $0.collectorNumber?.caseInsensitiveCompare(query) == .orderedSame
            }) else {
                throw APIService.APIError.serverError(
                    status: 404,
                    message: "No exact card matched set \(setCode) collector number \(query)."
                )
            }
            var receipt = try await apiService.rapidSetEntry(
                config: environmentStore.serverConfiguration,
                token: token,
                request: RapidSetEntryRequest(
                    binderId: binderId.trimmingCharacters(in: .whitespacesAndNewlines),
                    tcg: game.rawValue,
                    setCode: setCode.trimmingCharacters(in: .whitespacesAndNewlines),
                    entries: [
                        .init(
                            rowId: UUID().uuidString,
                            collectorNumber: query,
                            card: .init(
                                name: card.name,
                                printedName: printedName.nilIfBlank,
                                searchAliases: nil,
                                tcg: card.tcg,
                                externalId: card.id,
                                setCode: card.setCode,
                                setName: card.setName,
                                collectorNumber: card.collectorNumber,
                                imageUrl: card.imageUrl,
                                imageUrlSmall: card.imageUrlSmall
                            ),
                            quantity: quantity
                        )
                    ]
                )
            )
            receipt.cardName = card.name
            receipt.printedName = printedName.nilIfBlank
            receipts.insert(receipt, at: 0)
            collectorNumber = ""
            printedName = ""
            quantity = 1
            numberFocused = true
        } catch {
            errorMessage = error.localizedDescription
        }
        isSubmitting = false
    }

    @MainActor
    private func undo(_ receipt: RapidSetEntryReceipt) async {
        guard let token = environmentStore.authToken else { return }
        do {
            try await apiService.undoRapidSetEntry(
                config: environmentStore.serverConfiguration,
                token: token,
                auditId: receipt.items.first?.auditId ?? ""
            )
            receipts.removeAll { $0.id == receipt.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct AcquisitionCostSplitterView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var total = ""
    @State private var currency = "USD"
    @State private var method = "equal"
    @State private var itemText = ""
    @State private var note = ""
    @State private var receipt: AcquisitionCostSplitReceipt?
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        Form {
            Section("Purchase") {
                TextField("Total", text: $total)
                    .keyboardType(.decimalPad)
                TextField("Currency", text: $currency)
                    .textInputAutocapitalization(.characters)
                Picker("Split", selection: $method) {
                    Text("Equal").tag("equal")
                    Text("Weighted").tag("weighted")
                }
                TextField("Note (optional)", text: $note)
            }
            Section("Collection Entries") {
                TextEditor(text: $itemText)
                    .frame(minHeight: 120)
                Text(method == "equal" ? "One collection entry ID per line." : "Use entry ID,weight on each line.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            Button(isSaving ? "Splitting…" : "Record Exact-Cent Split") { Task { await split() } }
                .disabled(parsedItems.isEmpty || totalCents == nil || isSaving)
            if let receipt {
                Section("Audit Receipt") {
                    ForEach(receipt.allocations) { allocation in
                        LabeledContent(allocation.collectionEntryId) {
                            Text(format(cents: allocation.allocatedCents, currency: receipt.currency))
                        }
                    }
                    LabeledContent("Allocated total") {
                        Text(format(cents: receipt.totalCents, currency: receipt.currency)).bold()
                    }
                }
            }
        }
        .navigationTitle("Cost Split")
    }

    private var totalCents: Int? {
        Decimal(string: total).flatMap { amount in
            let scaled = NSDecimalNumber(decimal: amount).multiplying(byPowerOf10: 2)
            let rounded = scaled.rounding(accordingToBehavior: DecimalCentsRoundingBehavior())
            guard scaled == rounded else { return nil }
            return rounded.intValue
        }
    }

    private var parsedItems: [AcquisitionCostSplitRequest.Line] {
        itemText.split(whereSeparator: \.isNewline).compactMap { line in
            let parts = line.split(separator: ",", maxSplits: 1).map {
                $0.trimmingCharacters(in: .whitespacesAndNewlines)
            }
            guard let id = parts.first, !id.isEmpty else { return nil }
            let weight = method == "equal" ? 1 : (parts.count > 1 ? Int(parts[1]) ?? 0 : 0)
            guard weight > 0 else { return nil }
            return AcquisitionCostSplitRequest.Line(collectionEntryId: id, weight: weight)
        }
    }

    @MainActor
    private func split() async {
        guard let token = environmentStore.authToken, let totalCents else { return }
        isSaving = true
        errorMessage = nil
        do {
            receipt = try await apiService.splitAcquisitionCost(
                config: environmentStore.serverConfiguration,
                token: token,
                request: AcquisitionCostSplitRequest(
                    totalCents: totalCents,
                    currency: currency.uppercased(),
                    mode: method,
                    lines: parsedItems,
                    notes: note.nilIfBlank
                )
            )
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    private func format(cents: Int, currency: String) -> String {
        (Double(cents) / 100).formatted(.currency(code: currency))
    }
}

private struct PSACertIntakeView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var certificationNumber = ""
    @State private var binderId = ""
    @State private var entryId = ""
    @State private var lookup: PSACertificationLookup?
    @State private var state = OperationLoadState.idle
    @State private var savedMessage: String?

    private let apiService = APIService()

    var body: some View {
        Form {
            Section("Certification") {
                TextField("PSA certification number", text: $certificationNumber)
                    .keyboardType(.numberPad)
                Button("Look Up") { Task { await lookupCert() } }
                    .disabled(certificationNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state == .loading)
            }
            if state == .loading { ProgressView("Checking PSA…") }
            if case .failed(let message) = state { Text(message).foregroundStyle(.red) }
            if let lookup {
                Section("PSA Result") {
                    LabeledContent("Card", value: lookup.searchableName ?? lookup.subject ?? "Unknown card")
                    LabeledContent(
                        "Grade",
                        value: psaGradeText(lookup)
                    )
                    if let variety = lookup.variety { LabeledContent("Variety", value: variety) }
                    LabeledContent("Fetched", value: lookup.retrievedAt)
                    if let cardId = lookup.cardId { LabeledContent("Provider printing", value: cardId) }
                }
                Section("Confirm Exact Printing") {
                    TextField("Binder ID", text: $binderId)
                    TextField("Owned collection entry ID", text: $entryId)
                    Button("Apply PSA Details") { Task { await intake() } }
                        .disabled(binderId.isEmpty || entryId.isEmpty)
                }
            }
            if let savedMessage { Text(savedMessage).foregroundStyle(.green) }
        }
        .navigationTitle("PSA Intake")
    }

    private func psaGradeText(_ lookup: PSACertificationLookup) -> String {
        let grade = lookup.gradeLabel ?? lookup.grade.map { String($0) } ?? "Unknown"
        return "\(lookup.grader) \(grade)"
    }

    @MainActor
    private func lookupCert() async {
        guard let token = environmentStore.authToken else { return }
        state = .loading
        lookup = nil
        do {
            let result = try await apiService.lookupPSACertification(
                config: environmentStore.serverConfiguration,
                token: token,
                certificationNumber: certificationNumber.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            lookup = result
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    @MainActor
    private func intake() async {
        guard let token = environmentStore.authToken, let lookup else { return }
        let grade = lookup.gradeLabel ?? lookup.grade.map { String($0) }
        do {
            let card = try await apiService.intakePSACertification(
                config: environmentStore.serverConfiguration,
                token: token,
                request: PSACertIntakeRequest(
                    binderId: binderId,
                    entryId: entryId,
                    gradingCompany: lookup.grader,
                    gradingScore: grade,
                    certNumber: lookup.certNumber
                )
            )
            savedMessage = "Updated \(card.name) with \(lookup.grader) \(grade ?? "grade")."
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

private struct PrintedIdentityEditorView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var binderId = ""
    @State private var entryId = ""
    @State private var printedName = ""
    @State private var aliases = ""
    @State private var state = OperationLoadState.idle

    private let apiService = APIService()

    var body: some View {
        Form {
            Section("Owned Copy") {
                TextField("Binder ID", text: $binderId)
                TextField("Collection entry ID", text: $entryId)
                TextField("Name printed on the card", text: $printedName)
                TextField("Search aliases, comma-separated", text: $aliases)
            }
            if state == .loading { ProgressView() }
            if case .failed(let message) = state { Text(message).foregroundStyle(.red) }
            if state == .loaded { Label("Printed identity saved", systemImage: "checkmark.circle.fill").foregroundStyle(.green) }
            Button("Save Printed Identity") { Task { await save() } }
                .disabled(
                    binderId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        entryId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state == .loading
                )
        }
        .navigationTitle("Printed Identity")
    }

    @MainActor
    private func save() async {
        guard let token = environmentStore.authToken else { return }
        state = .loading
        do {
            _ = try await apiService.updatePrintedIdentity(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: binderId.trimmingCharacters(in: .whitespacesAndNewlines),
                collectionEntryId: entryId.trimmingCharacters(in: .whitespacesAndNewlines),
                request: PrintedIdentityUpdateRequest(
                    printedName: printedName.nilIfBlank,
                    searchAliases: aliases.split(separator: ",").map {
                        $0.trimmingCharacters(in: .whitespacesAndNewlines)
                    }.filter { !$0.isEmpty }
                )
            )
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

private struct PricingProvenanceView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var game = TCGGame.pokemon
    @State private var externalId = ""
    @State private var result: LibraryTrackedPriceResult?
    @State private var state = OperationLoadState.idle

    private let apiService = APIService()

    var body: some View {
        List {
            Section {
                Picker("Game", selection: $game) {
                    ForEach(environmentStore.enabledGames) { game in Text(game.displayName).tag(game) }
                }
                TextField("Card external ID", text: $externalId)
                Button("Load Tracked Quote") { Task { await load() } }
                    .disabled(externalId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || state == .loading)
            }
            if state == .loading { ProgressView("Loading tracked quote…") }
            if case .failed(let message) = state { Text(message).foregroundStyle(.red) }
            if let result {
                Section("Tracked Quote") {
                    LabeledContent("Provider", value: result.source ?? result.provenance?.provider ?? "Unavailable")
                    if let price = result.price, let currency = result.currency {
                        LabeledContent("Current", value: price.formatted(.currency(code: currency)))
                    }
                    LabeledContent("Cache", value: result.cached ? "Cached" : "Fresh")
                    if let error = result.error { Text(error).foregroundStyle(.red) }
                }
                if let provenance = result.provenance {
                    Section("Native Currency & Match") {
                        ForEach(Array(provenance.originalQuotes.enumerated()), id: \.offset) { _, quote in
                            LabeledContent(
                                quote.source,
                                value: quote.amount.formatted(.currency(code: quote.currency))
                            )
                        }
                        if let fx = provenance.fx {
                            Text("FX \(fx.fromCurrency) → \(fx.toCurrency): \(fx.rate.formatted()) · \(fx.source) · \(fx.asOf)")
                                .font(.caption)
                        }
                        if let match = provenance.match {
                            Text("Match: \(match.method) · \(match.confidence.formatted(.percent.precision(.fractionLength(0))))\(match.ambiguous == true ? " · ambiguous" : "")")
                                .font(.caption)
                        }
                    }
                }
            }
        }
        .navigationTitle("Price Provenance")
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else { return }
        state = .loading
        do {
            result = try await apiService.getTrackedPrice(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: game.rawValue,
                externalId: externalId.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

private enum OperationLoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

private final class DecimalCentsRoundingBehavior: NSObject, NSDecimalNumberBehaviors {
    func roundingMode() -> Decimal.RoundingMode { .plain }
    func scale() -> Int16 { 0 }
    func exceptionDuringOperation(
        _ operation: Selector,
        error: NSDecimalNumber.CalculationError,
        leftOperand: NSDecimalNumber,
        rightOperand: NSDecimalNumber?
    ) -> NSDecimalNumber? { nil }
}

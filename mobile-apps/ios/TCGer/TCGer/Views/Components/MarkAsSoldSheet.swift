import SwiftUI

struct MarkAsSoldSheet: View {
    let card: CollectionCard
    let collectionID: String
    let onSell: (InventorySaleRequest) async throws -> Void
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var amountText = ""
    @State private var currency = "USD"
    @State private var platform = ""
    @State private var costBasisText = ""
    @State private var feesText = ""
    @State private var shippingText = ""
    @State private var removeFromBinder = true
    @State private var selectedCopyIDs: Set<String>
    @State private var frozenRequest: InventorySaleRequest?
    @State private var isSelling = false
    @State private var errorMessage: String?

    init(card: CollectionCard, collectionID: String, onSell: @escaping (InventorySaleRequest) async throws -> Void) {
        self.card = card
        self.collectionID = collectionID
        self.onSell = onSell
        _selectedCopyIDs = State(initialValue: Set(card.copies.map(\.id)))
    }

    private var canRecordSale: Bool {
        environmentStore.serverConfiguration.isOnDevice || environmentStore.serverFeatures.atomicSales
    }

    private var validAmount: Double? {
        guard let amount = Double(amountText), amount.isFinite, amount >= 0 else { return nil }
        return amount
    }

    private func optionalAmount(_ value: String) -> Double? {
        guard let number = Double(value), number.isFinite, number >= 0 else { return nil }
        return number
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Copies being sold") {
                    Text(card.name).font(.headline)
                    ForEach(Array(card.copies.enumerated()), id: \.element.id) { index, copy in
                        Toggle(isOn: Binding(
                            get: { selectedCopyIDs.contains(copy.id) },
                            set: { if $0 { selectedCopyIDs.insert(copy.id) } else { selectedCopyIDs.remove(copy.id) } }
                        )) {
                            VStack(alignment: .leading) {
                                Text(copy.displayTitle(index: index, totalCount: card.copies.count) ?? "Owned copy")
                                Text([copy.condition, copy.language, copy.notes].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                    if card.copies.isEmpty {
                        Text("Reload this binder to obtain its physical copy IDs before selling.").foregroundStyle(.secondary)
                    }
                }
                .disabled(isSelling || frozenRequest != nil)
                Section {
                    TextField("Sale amount", text: $amountText).keyboardType(.decimalPad)
                    TextField("Currency (for example CAD)", text: $currency)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    TextField("Platform", text: $platform)
                    TextField("Marketplace fees", text: $feesText).keyboardType(.decimalPad)
                    TextField("Shipping cost", text: $shippingText).keyboardType(.decimalPad)
                    TextField("Total acquisition cost, if known", text: $costBasisText).keyboardType(.decimalPad)
                } header: { Text("Sale details") } footer: {
                    Text("All entered amounts use the selected currency. Leave acquisition cost blank to use known copy costs in that currency; other currencies are not converted or combined.")
                }
                .disabled(isSelling || frozenRequest != nil)
                Section {
                    Toggle("Remove selected copies from inventory", isOn: $removeFromBinder)
                } footer: {
                    Text("The sale and selected copy removals are saved together. Repeating a pending save returns the original receipt.")
                }
                .disabled(isSelling || frozenRequest != nil)
                if frozenRequest != nil {
                    Section {
                        Text("This attempt is saved on this phone. Retry its original details here, or use Settings → Pending saves after reopening the app.")
                    }
                }
                if !canRecordSale {
                    Section {
                        Text("This server does not support atomic sales. Connect to a fully Convex-backed TCGer server, or use phone-only mode for local inventory.")
                    }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red) }
                }
            }

            .navigationTitle("Record sale")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }.disabled(isSelling)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSelling ? "Saving…" : (frozenRequest == nil ? "Save sale" : "Retry save")) {
                        Task { await save() }
                    }
                    .disabled(isSelling || !canRecordSale || (frozenRequest == nil && (validAmount == nil || selectedCopyIDs.isEmpty || currency.uppercased().range(of: "^[A-Z]{3}$", options: .regularExpression) == nil)))
                }
            }
            .task { restorePendingAttempt() }
            .interactiveDismissDisabled(isSelling)
        }
    }

    @MainActor
    private func restorePendingAttempt() {
        guard let token = environmentStore.authToken else { return }
        let scope = InventoryOperationJournal.scope(config: environmentStore.serverConfiguration, userID: environmentStore.currentUser?.id, token: token)
        do {
            for operation in try InventoryOperationJournal.shared.pending(scope: scope) {
                if case .sale(let request) = operation, request.collectionId == collectionID,
                   !Set(request.copyIds).isDisjoint(with: Set(card.copies.map(\.id))) {
                    frozenRequest = request
                    amountText = String(request.amount)
                    currency = request.currency
                    selectedCopyIDs = Set(request.copyIds)
                    platform = request.platform ?? ""
                    feesText = request.fees.map { String($0) } ?? ""
                    shippingText = request.shippingCost.map { String($0) } ?? ""
                    costBasisText = request.costBasis.map { String($0) } ?? ""
                    removeFromBinder = request.removeFromInventory
                    return
                }
            }
            currency = environmentStore.displayCurrencyCode
        } catch { errorMessage = error.localizedDescription }
    }

    @MainActor
    private func save() async {
        guard !isSelling, canRecordSale, let token = environmentStore.authToken else { return }
        let session = environmentStore.sessionIdentity
        let scope = InventoryOperationJournal.scope(config: session.configuration, userID: environmentStore.currentUser?.id, token: token)
        isSelling = true
        errorMessage = nil
        defer { isSelling = false }
        do {
            let request: InventorySaleRequest
            if let frozenRequest { request = frozenRequest }
            else {
                guard let amount = validAmount else { return }
                for value in [feesText, shippingText, costBasisText] where !value.isEmpty {
                    guard optionalAmount(value) != nil else {
                        throw APIService.APIError.serverError(status: 400, message: "Costs must be nonnegative amounts in the selected currency")
                    }
                }
                request = InventorySaleRequest(
                    operationId: UUID().uuidString, collectionId: collectionID,
                    copyIds: selectedCopyIDs.sorted(), amount: amount, currency: currency.uppercased(),
                    removeFromInventory: removeFromBinder, platform: platform.isEmpty ? nil : platform,
                    costBasis: optionalAmount(costBasisText), fees: optionalAmount(feesText),
                    shippingCost: optionalAmount(shippingText)
                )
                try InventoryOperationJournal.shared.save(.sale(request), scope: scope)
                frozenRequest = request
            }
            try await onSell(request)
            // A completed request may remove only its own recovery record.
            try InventoryOperationJournal.shared.complete(id: request.operationId, scope: scope)
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            HapticManager.notification(.success)
            dismiss()
        } catch {
            guard environmentStore.matches(session), !(error is CancellationError) else { return }
            errorMessage = error.localizedDescription
        }
    }
}

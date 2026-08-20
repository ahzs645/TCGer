import SwiftUI

struct CardAcquisitionSection: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let card: CollectionCard
    let binderId: String
    let collectionEntryId: String
    let copyDetails: CollectionCardCopy?

    @State private var transaction: Transaction?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var editorContext: AcquisitionEditorContext?

    private let apiService = APIService()

    var body: some View {
        Section {
            Button {
                editorContext = AcquisitionEditorContext(transaction: transaction)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: transaction == nil ? "cart.badge.plus" : "cart.fill")
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 24)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(transaction == nil ? "Add purchase details" : "Purchased")
                            .foregroundStyle(.primary)
                        if isLoading {
                            Text("Loading…")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else if let transaction {
                            Text(summary(for: transaction))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let platform = transaction.platform, !platform.isEmpty {
                                Text(platform)
                                    .font(.caption)
                                    .foregroundStyle(.tertiary)
                            }
                        } else if let fallbackSummary {
                            Text(fallbackSummary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }

                    Spacer()
                    if isLoading {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "chevron.right")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isLoading)

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        } header: {
            Text("Acquisition")
        } footer: {
            Text("Purchase details are used for cost and return calculations in Prices.")
        }
        .task(id: collectionEntryId) {
            await loadTransaction()
        }
        .sheet(item: $editorContext) { context in
            CardAcquisitionEditorSheet(
                card: card,
                binderId: binderId,
                collectionEntryId: collectionEntryId,
                copyDetails: copyDetails,
                existingTransaction: context.transaction
            ) { updated in
                transaction = updated
                errorMessage = nil
            }
            .environmentObject(environmentStore)
        }
    }

    private var fallbackSummary: String? {
        guard let price = copyDetails?.acquisitionPrice else { return nil }
        // Legacy copy-level costs did not store a currency; the previous API
        // contract treated all monetary values as USD.
        var parts = [price.formatted(.currency(code: "USD"))]
        if let acquiredAt = copyDetails?.acquiredAt,
           let date = ISO8601DateFormatter().date(from: acquiredAt) {
            parts.append(date.formatted(date: .abbreviated, time: .omitted))
        }
        return parts.joined(separator: " · ")
    }

    private func summary(for transaction: Transaction) -> String {
        let amount = Decimal(transaction.amount).formatted(.currency(code: transaction.currency))
        guard let date = ISO8601DateFormatter().date(from: transaction.date) else { return amount }
        return "\(amount) · \(date.formatted(date: .abbreviated, time: .omitted))"
    }

    @MainActor
    private func loadTransaction() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }
        isLoading = true
        errorMessage = nil
        do {
            transaction = try await apiService.getTransactions(
                config: environmentStore.serverConfiguration,
                token: token,
                collectionEntryId: collectionEntryId
            )
            .first(where: { $0.type == "purchase" })
        } catch {
            errorMessage = "Purchase details could not be loaded."
        }
        isLoading = false
    }
}

private struct AcquisitionEditorContext: Identifiable {
    let id = UUID()
    let transaction: Transaction?
}

private struct CardAcquisitionEditorSheet: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss

    let card: CollectionCard
    let binderId: String
    let collectionEntryId: String
    let copyDetails: CollectionCardCopy?
    let existingTransaction: Transaction?
    let onSaved: (Transaction?) -> Void

    @State private var amountText: String
    @State private var currency: String
    @State private var purchaseDate: Date
    @State private var source: String
    @State private var sourceURL: String
    @State private var notes: String
    @State private var supportedCurrencies: [SupportedCurrency]
    @State private var isSaving = false
    @State private var errorMessage: String?
    @FocusState private var focusedField: Field?

    private let apiService = APIService()

    private enum Field {
        case amount
        case source
        case sourceURL
        case notes
    }

    init(
        card: CollectionCard,
        binderId: String,
        collectionEntryId: String,
        copyDetails: CollectionCardCopy?,
        existingTransaction: Transaction?,
        onSaved: @escaping (Transaction?) -> Void
    ) {
        self.card = card
        self.binderId = binderId
        self.collectionEntryId = collectionEntryId
        self.copyDetails = copyDetails
        self.existingTransaction = existingTransaction
        self.onSaved = onSaved

        let fallbackCurrency = CurrencyDisplayState.shared.currentCurrencyCode
        let initialAmount = existingTransaction?.amount ?? copyDetails?.acquisitionPrice
        _amountText = State(initialValue: initialAmount.map { String(format: "%.2f", $0) } ?? "")
        _currency = State(initialValue: existingTransaction?.currency ?? fallbackCurrency)
        _purchaseDate = State(initialValue: Self.purchaseDate(
            transaction: existingTransaction,
            copyDetails: copyDetails
        ))
        _source = State(initialValue: existingTransaction?.platform ?? "")
        _sourceURL = State(initialValue: existingTransaction?.sourceUrl ?? "")
        _notes = State(initialValue: existingTransaction?.notes ?? "")
        _supportedCurrencies = State(initialValue: Self.initialCurrencies(selected: existingTransaction?.currency ?? fallbackCurrency))
    }

    private var parsedAmount: Double? {
        Double(amountText.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private var normalizedSourceURL: String? {
        let value = sourceURL.trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }

    private var sourceURLIsValid: Bool {
        guard let normalizedSourceURL else { return true }
        guard let url = URL(string: normalizedSourceURL),
              let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "https" || scheme == "http"
    }

    private var canSave: Bool {
        parsedAmount.map { $0 > 0 && $0.isFinite } == true &&
            currency.count == 3 &&
            sourceURLIsValid &&
            !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        CardArtworkImage(card: card.previewCard, useFullResolution: false)
                            .frame(width: 48, height: 68)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(card.name)
                                .font(.headline)
                            Text(copyDetails?.detailLine ?? "Collection copy")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section {
                    HStack {
                        TextField("Total paid", text: $amountText)
                            .keyboardType(.decimalPad)
                            .focused($focusedField, equals: .amount)
                        Picker("Currency", selection: $currency) {
                            ForEach(supportedCurrencies) { option in
                                Text(option.isoCode).tag(option.isoCode)
                            }
                        }
                        .labelsHidden()
                    }

                    DatePicker(
                        "Purchase date",
                        selection: $purchaseDate,
                        in: ...Date(),
                        displayedComponents: .date
                    )

                    TextField("Source (optional)", text: $source)
                        .textInputAutocapitalization(.words)
                        .focused($focusedField, equals: .source)
                } header: {
                    Text("Purchase")
                } footer: {
                    Text("Total paid should include any tax, shipping, or marketplace costs you want included in your cost basis.")
                }

                Section("Optional Reference") {
                    TextField("Receipt or listing link", text: $sourceURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .focused($focusedField, equals: .sourceURL)
                    if !sourceURLIsValid {
                        Text("Enter a complete http or https link.")
                            .font(.caption)
                            .foregroundStyle(.red)
                    }

                    TextField("Notes", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                        .focused($focusedField, equals: .notes)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }

                if existingTransaction != nil {
                    Section {
                        Button("Remove Purchase Details", role: .destructive) {
                            Task { await remove() }
                        }
                        .disabled(isSaving)
                    }
                }
            }
            .navigationTitle("Purchase Details")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task { await save() }
                    }
                    .disabled(!canSave)
                }
            }
            .task {
                await loadCurrencies()
                if existingTransaction == nil && copyDetails?.acquisitionPrice == nil {
                    focusedField = .amount
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(isSaving)
    }

    @MainActor
    private func save() async {
        guard let token = environmentStore.authToken,
              let amount = parsedAmount,
              amount > 0 else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        let date = ISO8601DateFormatter().string(from: purchaseDate.noonUTC)
        let trimmedSource = source.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedNotes = notes.trimmingCharacters(in: .whitespacesAndNewlines)

        do {
            _ = try await apiService.updateCardInBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: binderId,
                collectionCardId: collectionEntryId,
                acquisitionPrice: amount,
                acquiredAt: date,
                includeAcquisitionDetails: true
            )

            let transaction: Transaction
            if let existingTransaction {
                transaction = try await apiService.updateTransaction(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    transactionId: existingTransaction.id,
                    collectionEntryId: collectionEntryId,
                    cardId: card.cardId,
                    externalId: card.externalId,
                    cardName: card.name,
                    tcg: card.tcg,
                    quantity: 1,
                    amount: amount,
                    currency: currency,
                    platform: trimmedSource.isEmpty ? nil : trimmedSource,
                    sourceUrl: normalizedSourceURL,
                    notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
                    date: date
                )
            } else {
                transaction = try await apiService.createTransaction(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    type: "purchase",
                    collectionEntryId: collectionEntryId,
                    cardId: card.cardId,
                    externalId: card.externalId,
                    cardName: card.name,
                    tcg: card.tcg,
                    quantity: 1,
                    amount: amount,
                    currency: currency,
                    platform: trimmedSource.isEmpty ? nil : trimmedSource,
                    sourceUrl: normalizedSourceURL,
                    notes: trimmedNotes.isEmpty ? nil : trimmedNotes,
                    date: date
                )
            }
            NotificationCenter.default.post(name: .collectionDidChange, object: nil)
            HapticManager.notification(.success)
            onSaved(transaction)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func remove() async {
        guard let token = environmentStore.authToken,
              let existingTransaction else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        do {
            _ = try await apiService.updateCardInBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: binderId,
                collectionCardId: collectionEntryId,
                acquisitionPrice: nil,
                acquiredAt: nil,
                includeAcquisitionDetails: true
            )
            try await apiService.deleteTransaction(
                config: environmentStore.serverConfiguration,
                token: token,
                transactionId: existingTransaction.id
            )
            NotificationCenter.default.post(name: .collectionDidChange, object: nil)
            onSaved(nil)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func loadCurrencies() async {
        do {
            let currencies = try await CurrencyConverter.shared.supportedCurrencies()
            supportedCurrencies = currencies
            if !supportedCurrencies.contains(where: { $0.isoCode == currency }) {
                supportedCurrencies.append(
                    SupportedCurrency(isoCode: currency, name: currency, symbol: nil)
                )
                supportedCurrencies.sort { $0.isoCode < $1.isoCode }
            }
        } catch {
            // Common currencies remain available when the reference service is offline.
        }
    }

    private static func purchaseDate(
        transaction: Transaction?,
        copyDetails: CollectionCardCopy?
    ) -> Date {
        if let transaction,
           let date = ISO8601DateFormatter().date(from: transaction.date) {
            return date
        }
        if let acquiredAt = copyDetails?.acquiredAt,
           let date = ISO8601DateFormatter().date(from: acquiredAt) {
            return date
        }
        return Date()
    }

    private static func initialCurrencies(selected: String) -> [SupportedCurrency] {
        var currencies = SupportedCurrency.fallback
        if !currencies.contains(where: { $0.isoCode == selected }) {
            currencies.append(SupportedCurrency(isoCode: selected, name: selected, symbol: nil))
        }
        return currencies.sorted { $0.isoCode < $1.isoCode }
    }
}

private extension Date {
    var noonUTC: Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let components = calendar.dateComponents([.year, .month, .day], from: self)
        return calendar.date(from: DateComponents(
            timeZone: calendar.timeZone,
            year: components.year,
            month: components.month,
            day: components.day,
            hour: 12
        )) ?? self
    }
}

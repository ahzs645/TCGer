import SwiftUI

struct TransactionsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var transactions: [Transaction] = []
    @State private var summary: FinanceSummaryByCurrency?
    @State private var performance: RealizedPerformance?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var filterType: String = "all"
    @State private var showingCreateSheet = false
    @State private var selectedTransaction: Transaction?
    @State private var deletingIDs: Set<String> = []
    @State private var loadID: UUID?

    private let apiService = APIService()

    private var filteredTransactions: [Transaction] {
        if filterType == "all" { return transactions }
        return transactions.filter { $0.type == filterType }
    }

    var body: some View {
        List {
            if let summary {
                ForEach(summary.byCurrency, id: \.currency) { totals in
                    Section("Transactions · \(totals.currency)") {
                        LabeledContent("Spent", value: totals.totalSpent.priceText(currency: totals.currency))
                        LabeledContent("Earned", value: totals.totalEarned.priceText(currency: totals.currency))
                        LabeledContent("Profit / loss", value: totals.profitLoss.priceText(currency: totals.currency))
                    }
                }
            }

            if let performance {
                ForEach(performance.byCurrency, id: \.currency) { realized in
                    Section("Sales performance · \(realized.currency)") {
                        LabeledContent("Realized profit", value: realized.realizedProfit.priceText(currency: realized.currency))
                        LabeledContent("Net proceeds", value: realized.netProceeds.priceText(currency: realized.currency))
                        LabeledContent("Fees + shipping", value: (realized.fees + realized.shippingCost).priceText(currency: realized.currency))
                        if let days = realized.averageHoldingDays {
                            LabeledContent("Average hold", value: "\(days) days")
                        }
                        Text("\(realized.costedSaleCount) of \(realized.saleCount) sales include acquisition cost")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                if let costs = performance.inventoryCostsByCurrency, !costs.isEmpty {
                    Section("Owned inventory acquisition costs") {
                        ForEach(costs, id: \.currency) { cost in
                            LabeledContent(cost.currency == "UNKNOWN" ? "Currency unknown" : cost.currency,
                                           value: cost.currency == "UNKNOWN" ? String(format: "%.2f", cost.cost) : cost.cost.priceText(currency: cost.currency))
                        }
                    }
                }
            }

            Section {
                Picker("Type", selection: $filterType) {
                    Text("All").tag("all")
                    Text("Purchases").tag("purchase")
                    Text("Sales").tag("sale")
                    Text("Trades").tag("trade")
                }
                .pickerStyle(.segmented)
            }

            if isLoading {
                Section {
                    HStack { Spacer(); ProgressView(); Spacer() }
                }
            } else if filteredTransactions.isEmpty {
                Section {
                    VStack(spacing: 12) {
                        Image(systemName: "dollarsign.circle")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                        Text("No Transactions")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 20)
                }
            } else {
                Section {
                    ForEach(filteredTransactions) { txn in
                        TransactionRow(transaction: txn)
                            .contentShape(Rectangle())
                            .onTapGesture { selectedTransaction = txn }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    Task { await deleteTransaction(txn) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                                .disabled(deletingIDs.contains(txn.id))
                            }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Transactions")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showingCreateSheet = true
                } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .refreshable { await loadData() }
        .task { await loadData() }
        .sheet(isPresented: $showingCreateSheet) {
            CreateTransactionSheet { draft in
                try await createTransaction(draft)
            }
        }
        .sheet(item: $selectedTransaction) { transaction in
            TransactionDetailSheet(transaction: transaction)
        }
        .alert("Transactions", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) { }
        } message: { Text(errorMessage ?? "") }
    }

    @MainActor
    private func loadData() async {
        let session = environmentStore.sessionIdentity
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }
        let requestID = UUID()
        loadID = requestID
        isLoading = transactions.isEmpty
        defer { if loadID == requestID, environmentStore.matches(session) { isLoading = false } }
        do {
            async let txns = apiService.getTransactions(config: session.configuration, token: token)
            async let sum = apiService.getFinanceSummaryByCurrency(config: session.configuration, token: token)
            async let realized = apiService.getRealizedPerformance(config: session.configuration, token: token)
            let loadedTransactions = try await txns
            guard environmentStore.matches(session), loadID == requestID, !Task.isCancelled else { return }
            transactions = loadedTransactions
            let (loadedSummary, loadedPerformance) = try await (sum, realized)
            guard environmentStore.matches(session), loadID == requestID, !Task.isCancelled else { return }
            summary = loadedSummary
            performance = loadedPerformance
            errorMessage = nil
        } catch {
            guard environmentStore.matches(session), loadID == requestID, !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func createTransaction(_ draft: NewTransactionDetails) async throws {
        let session = environmentStore.sessionIdentity
        guard let token = environmentStore.authToken else { throw APIService.APIError.unauthorized }
        let txn = try await apiService.createTransaction(
            config: session.configuration, token: token,
            type: draft.type, cardName: draft.cardName, tcg: draft.tcg,
            quantity: draft.quantity, amount: draft.amount, currency: draft.currency,
            platform: draft.platform,
            costBasis: draft.costBasis, fees: draft.fees,
            shippingCost: draft.shippingCost, acquiredAt: draft.acquiredAt,
            notes: draft.notes
        )
        guard environmentStore.matches(session), !Task.isCancelled else { throw CancellationError() }
        transactions.insert(txn, at: 0)
        HapticManager.notification(.success)
        await loadData()
    }

    @MainActor
    private func deleteTransaction(_ txn: Transaction) async {
        let session = environmentStore.sessionIdentity
        guard let token = environmentStore.authToken else { return }
        guard session.configuration.isOnDevice || txn.type != "purchase" || txn.collectionEntryId == nil || environmentStore.serverFeatures.linkedAcquisitions else {
            errorMessage = "This linked purchase requires a server that can update the purchase and owned-copy cost together."
            return
        }
        guard deletingIDs.insert(txn.id).inserted else { return }
        defer { if environmentStore.matches(session) { deletingIDs.remove(txn.id) } }
        do {
            try await apiService.deleteTransaction(
                config: session.configuration, token: token, transactionId: txn.id
            )
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            transactions.removeAll { $0.id == txn.id }
            CollectionMutationNotice.post(config: session.configuration, token: token)
            await loadData()
        } catch {
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }
}

private struct TransactionDetailSheet: View {
    let transaction: Transaction
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section("Transaction") {
                    LabeledContent("Type", value: transaction.type.capitalized)
                    LabeledContent("Amount", value: transaction.amount.priceText(currency: transaction.currency))
                    LabeledContent("Quantity", value: "\(transaction.quantity)")
                    if let platform = transaction.platform { LabeledContent("Platform", value: platform) }
                    LabeledContent("Date", value: transaction.date)
                }
                if transaction.type == "sale" {
                    Section("Realized Sale") {
                        if let cost = transaction.costBasis { LabeledContent("Acquisition cost", value: cost.priceText(currency: transaction.currency)) }
                        LabeledContent("Fees", value: (transaction.fees ?? 0).priceText(currency: transaction.currency))
                        LabeledContent("Shipping", value: (transaction.shippingCost ?? 0).priceText(currency: transaction.currency))
                        if let net = transaction.netProceeds { LabeledContent("Net proceeds", value: net.priceText(currency: transaction.currency)) }
                        if let profit = transaction.realizedProfit {
                            LabeledContent("Realized profit", value: profit.priceText(currency: transaction.currency))
                        } else {
                            Text("Add acquisition cost to calculate realized profit.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let days = transaction.holdingDays { LabeledContent("Holding time", value: "\(days) days") }
                    }
                }
                if let notes = transaction.notes, !notes.isEmpty {
                    Section("Notes") { Text(notes) }
                }
            }
            .navigationTitle(transaction.cardName ?? "Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct TransactionRow: View {
    let transaction: Transaction

    private var typeIcon: String {
        switch transaction.type {
        case "purchase": return "cart.fill"
        case "sale": return "dollarsign.circle.fill"
        case "trade": return "arrow.triangle.2.circlepath"
        default: return "questionmark.circle"
        }
    }

    private var typeColor: Color {
        switch transaction.type {
        case "purchase": return .red
        case "sale": return .green
        case "trade": return .blue
        default: return .secondary
        }
    }

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: typeIcon)
                .foregroundColor(typeColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                Text(transaction.cardName ?? transaction.type.capitalized)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)

                HStack(spacing: 6) {
                    Text(transaction.type.capitalized)
                        .font(.caption2)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(typeColor.opacity(0.15))
                        .foregroundColor(typeColor)
                        .cornerRadius(4)

                    if let tcg = transaction.tcg,
                       !tcg.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        GameBadge(tcg: tcg)
                    }

                    if let platform = transaction.platform, !platform.isEmpty {
                        Text(platform)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text("\(transaction.type == "purchase" ? "-" : "+")\(transaction.amount.priceText(currency: transaction.currency))")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(typeColor)

                if transaction.quantity > 1 {
                    Text("x\(transaction.quantity)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                if let profit = transaction.realizedProfit {
                    Text("\(profit >= 0 ? "+" : "−")\(abs(profit).priceText(currency: transaction.currency)) realized")
                        .font(.caption)
                        .foregroundStyle(profit >= 0 ? Color.green : Color.red)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Create Transaction Sheet

private struct NewTransactionDetails {
    let type: String
    let cardName: String?
    let tcg: String?
    let quantity: Int
    let amount: Double
    let currency: String
    let platform: String?
    let costBasis: Double?
    let fees: Double?
    let shippingCost: Double?
    let acquiredAt: String?
    let notes: String?
}

private struct CreateTransactionSheet: View {
    let onCreate: (NewTransactionDetails) async throws -> Void
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var type = "purchase"
    @State private var cardName = ""
    @State private var tcg = ""
    @State private var quantity = 1
    @State private var amountText = ""
    @State private var currency = "USD"
    @State private var supportedCurrencies = SupportedCurrency.fallback
    @State private var platform = ""
    @State private var costBasisText = ""
    @State private var feesText = ""
    @State private var shippingText = ""
    @State private var hasAcquiredDate = false
    @State private var acquiredDate = Date()
    @State private var notes = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let platforms = ["", "TCGPlayer", "CardMarket", "eBay", "Local", "Other"]

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Type", selection: $type) {
                        Text("Purchase").tag("purchase")
                        Text("Sale").tag("sale")
                        Text("Trade").tag("trade")
                    }
                    .pickerStyle(.segmented)
                }

                Section {
                    TextField("Card Name (optional)", text: $cardName)
                    Picker("TCG", selection: $tcg) {
                        Text("None").tag("")
                        ForEach(environmentStore.enabledGames) { game in
                            GameLabel(game: game)
                                .tag(game.rawValue)
                        }
                    }
                    Stepper("Quantity: \(quantity)", value: $quantity, in: 1...999)
                } header: {
                    Text("Details")
                }

                Section {
                    HStack {
                        TextField("Amount", text: $amountText)
                            .keyboardType(.decimalPad)
                        Picker("Currency", selection: $currency) {
                            ForEach(supportedCurrencies) { option in
                                Text(option.isoCode).tag(option.isoCode)
                            }
                        }
                        .labelsHidden()
                    }
                    Picker("Platform", selection: $platform) {
                        ForEach(platforms, id: \.self) { p in
                            Text(p.isEmpty ? "None" : p).tag(p)
                        }
                    }
                } header: {
                    Text("Payment")
                }

                if type == "sale" {
                    Section("Realized Sale") {
                        TextField("Acquisition cost (\(currency))", text: $costBasisText)
                            .keyboardType(.decimalPad)
                        TextField("Marketplace fees (\(currency))", text: $feesText)
                            .keyboardType(.decimalPad)
                        TextField("Shipping cost (\(currency))", text: $shippingText)
                            .keyboardType(.decimalPad)
                        Toggle("Include acquisition date", isOn: $hasAcquiredDate)
                        if hasAcquiredDate {
                            DatePicker("Acquired", selection: $acquiredDate, displayedComponents: .date)
                        }
                    }
                }

                Section {
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                        .lineLimit(3...5)
                } header: {
                    Text("Notes")
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
            }
            .disabled(isSaving)
            .navigationTitle("New Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        guard !isSaving, let amount = Double(amountText), amount.isFinite, amount > 0 else { return }
                        let session = environmentStore.sessionIdentity
                        isSaving = true
                        errorMessage = nil
                        let draft = NewTransactionDetails(
                            type: type,
                            cardName: cardName.isEmpty ? nil : cardName,
                            tcg: tcg.isEmpty ? nil : tcg,
                            quantity: quantity,
                            amount: amount,
                            currency: currency,
                            platform: platform.isEmpty ? nil : platform,
                            costBasis: Double(costBasisText),
                            fees: Double(feesText),
                            shippingCost: Double(shippingText),
                            acquiredAt: hasAcquiredDate ? ISO8601DateFormatter().string(from: acquiredDate) : nil,
                            notes: notes.isEmpty ? nil : notes
                        )
                        Task { @MainActor in
                            defer { isSaving = false }
                            do {
                                try await onCreate(draft)
                                guard environmentStore.matches(session), !Task.isCancelled else { return }
                                dismiss()
                            } catch {
                                guard environmentStore.matches(session), !(error is CancellationError) else { return }
                                errorMessage = error.localizedDescription
                            }
                        }
                    }
                    .disabled(isSaving || amountText.isEmpty || Double(amountText) == nil)
                }
            }
        }
        .presentationDetents([.large])
        .interactiveDismissDisabled(isSaving)
        .onAppear {
            if amountText.isEmpty {
                currency = environmentStore.displayCurrencyCode
                includeSelectedCurrency()
            }
        }
        .task {
            if let currencies = try? await CurrencyConverter.shared.supportedCurrencies() {
                supportedCurrencies = currencies
                includeSelectedCurrency()
            }
        }
    }

    private func includeSelectedCurrency() {
        guard !supportedCurrencies.contains(where: { $0.isoCode == currency }) else { return }
        supportedCurrencies.append(SupportedCurrency(isoCode: currency, name: currency, symbol: nil))
        supportedCurrencies.sort { $0.isoCode < $1.isoCode }
    }
}

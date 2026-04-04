import SwiftUI

struct TransactionsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var transactions: [Transaction] = []
    @State private var summary: FinanceSummary?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var filterType: String = "all"
    @State private var showingCreateSheet = false

    private let apiService = APIService()

    private var filteredTransactions: [Transaction] {
        if filterType == "all" { return transactions }
        return transactions.filter { $0.type == filterType }
    }

    var body: some View {
        List {
            if let summary {
                Section {
                    HStack(spacing: 16) {
                        FinanceStatBlock(title: "Spent", value: summary.totalSpent, color: .red)
                        FinanceStatBlock(title: "Earned", value: summary.totalEarned, color: .green)
                        FinanceStatBlock(title: "P/L", value: summary.profitLoss, color: summary.profitLoss >= 0 ? .green : .red)
                    }
                    .padding(.vertical, 4)
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
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    Task { await deleteTransaction(txn) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
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
            CreateTransactionSheet { type, cardName, tcg, qty, amount, platform, notes in
                Task {
                    await createTransaction(type: type, cardName: cardName, tcg: tcg, quantity: qty, amount: amount, platform: platform, notes: notes)
                }
            }
        }
    }

    @MainActor
    private func loadData() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }
        isLoading = transactions.isEmpty
        do {
            async let txns = apiService.getTransactions(config: environmentStore.serverConfiguration, token: token)
            async let sum = apiService.getFinanceSummary(config: environmentStore.serverConfiguration, token: token)
            transactions = try await txns
            summary = try await sum
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func createTransaction(type: String, cardName: String?, tcg: String?, quantity: Int, amount: Double, platform: String?, notes: String?) async {
        guard let token = environmentStore.authToken else { return }
        do {
            let txn = try await apiService.createTransaction(
                config: environmentStore.serverConfiguration, token: token,
                type: type, cardName: cardName, tcg: tcg, quantity: quantity,
                amount: amount, platform: platform, notes: notes
            )
            transactions.insert(txn, at: 0)
            summary = try? await apiService.getFinanceSummary(config: environmentStore.serverConfiguration, token: token)
            HapticManager.notification(.success)
            showingCreateSheet = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func deleteTransaction(_ txn: Transaction) async {
        guard let token = environmentStore.authToken else { return }
        do {
            try await apiService.deleteTransaction(
                config: environmentStore.serverConfiguration, token: token, transactionId: txn.id
            )
            transactions.removeAll { $0.id == txn.id }
            summary = try? await apiService.getFinanceSummary(config: environmentStore.serverConfiguration, token: token)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct FinanceStatBlock: View {
    let title: String
    let value: Double
    let color: Color

    var body: some View {
        VStack(spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundColor(.secondary)
            Text("$\(String(format: "%.2f", abs(value)))")
                .font(.subheadline)
                .fontWeight(.bold)
                .foregroundColor(color)
        }
        .frame(maxWidth: .infinity)
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

                    if let platform = transaction.platform, !platform.isEmpty {
                        Text(platform)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text("\(transaction.type == "purchase" ? "-" : "+")$\(String(format: "%.2f", transaction.amount))")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                    .foregroundColor(typeColor)

                if transaction.quantity > 1 {
                    Text("x\(transaction.quantity)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Create Transaction Sheet

private struct CreateTransactionSheet: View {
    let onCreate: (String, String?, String?, Int, Double, String?, String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var type = "purchase"
    @State private var cardName = ""
    @State private var tcg = ""
    @State private var quantity = 1
    @State private var amountText = ""
    @State private var platform = ""
    @State private var notes = ""

    private let platforms = ["", "TCGPlayer", "CardMarket", "eBay", "Local", "Other"]

    var body: some View {
        NavigationView {
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
                        Text("Pokemon").tag("pokemon")
                        Text("Magic").tag("magic")
                        Text("Yu-Gi-Oh!").tag("yugioh")
                    }
                    Stepper("Quantity: \(quantity)", value: $quantity, in: 1...999)
                } header: {
                    Text("Details")
                }

                Section {
                    TextField("Amount ($)", text: $amountText)
                        .keyboardType(.decimalPad)
                    Picker("Platform", selection: $platform) {
                        ForEach(platforms, id: \.self) { p in
                            Text(p.isEmpty ? "None" : p).tag(p)
                        }
                    }
                } header: {
                    Text("Payment")
                }

                Section {
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                        .lineLimit(3...5)
                } header: {
                    Text("Notes")
                }
            }
            .navigationTitle("New Transaction")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        guard let amount = Double(amountText), amount > 0 else { return }
                        onCreate(
                            type,
                            cardName.isEmpty ? nil : cardName,
                            tcg.isEmpty ? nil : tcg,
                            quantity,
                            amount,
                            platform.isEmpty ? nil : platform,
                            notes.isEmpty ? nil : notes
                        )
                        dismiss()
                    }
                    .disabled(amountText.isEmpty || Double(amountText) == nil)
                }
            }
        }
        .presentationDetents([.large])
    }
}

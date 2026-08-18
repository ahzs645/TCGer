import SwiftUI

struct SaleDetails {
    let amount: Double
    let platform: String?
    let costBasis: Double?
    let fees: Double?
    let shippingCost: Double?
    let acquiredAt: String?
    let removeFromBinder: Bool
}

struct MarkAsSoldSheet: View {
    let card: CollectionCard
    let onSell: (SaleDetails) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amountText = ""
    @State private var platform = ""
    @State private var costBasisText: String
    @State private var feesText = ""
    @State private var shippingText = ""
    @State private var removeFromBinder = true

    private let platforms = ["", "TCGPlayer", "CardMarket", "eBay", "Local", "Other"]

    private var earliestAcquiredAt: String? {
        guard let value = card.copies.compactMap(\.acquiredAt).min() else { return nil }
        if ISO8601DateFormatter().date(from: value) != nil { return value }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        guard let date = formatter.date(from: value) else { return nil }
        return ISO8601DateFormatter().string(from: date)
    }

    init(card: CollectionCard, onSell: @escaping (SaleDetails) -> Void) {
        self.card = card
        self.onSell = onSell
        let hasCompleteCost = !card.copies.isEmpty && card.copies.allSatisfy { $0.acquisitionPrice != nil }
        let suggestedCost = hasCompleteCost
            ? card.copies.reduce(0.0) { $0 + ($1.acquisitionPrice ?? 0) }
            : nil
        _costBasisText = State(initialValue: suggestedCost.map { String(format: "%.2f", $0) } ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        CardArtworkImage(card: card.previewCard, useFullResolution: false)
                            .frame(width: 40, height: 56)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(card.name)
                                .font(.subheadline)
                                .fontWeight(.medium)
                            if let setName = card.setName {
                                Text(setName)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            Text("Qty: \(card.quantity)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                    }
                } header: {
                    Text("Card")
                }

                Section {
                    TextField("Sale Amount ($)", text: $amountText)
                        .keyboardType(.decimalPad)

                    Picker("Platform", selection: $platform) {
                        ForEach(platforms, id: \.self) { p in
                            Text(p.isEmpty ? "None" : p).tag(p)
                        }
                    }
                    TextField("Marketplace Fees ($)", text: $feesText)
                        .keyboardType(.decimalPad)
                    TextField("Shipping Cost ($)", text: $shippingText)
                        .keyboardType(.decimalPad)
                    TextField("Acquisition Cost ($)", text: $costBasisText)
                        .keyboardType(.decimalPad)
                } header: {
                    Text("Sale Details")
                } footer: {
                    Text("Profit is sale amount minus fees, shipping, and acquisition cost. Leave acquisition cost blank when it is unknown.")
                }

                Section {
                    Toggle("Remove card from binder", isOn: $removeFromBinder)
                } footer: {
                    Text("When enabled, the card will be removed from this binder after recording the sale.")
                        .font(.caption)
                }
            }
            .navigationTitle("Mark as Sold")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Sell") {
                        guard let amount = Double(amountText), amount > 0 else { return }
                        onSell(SaleDetails(
                            amount: amount,
                            platform: platform.isEmpty ? nil : platform,
                            costBasis: Double(costBasisText),
                            fees: Double(feesText),
                            shippingCost: Double(shippingText),
                            acquiredAt: earliestAcquiredAt,
                            removeFromBinder: removeFromBinder
                        ))
                        dismiss()
                    }
                    .disabled(amountText.isEmpty || Double(amountText) == nil)
                    .fontWeight(.semibold)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

import SwiftUI

struct MarkAsSoldSheet: View {
    let card: CollectionCard
    let onSell: (Double, String?, Bool) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var amountText = ""
    @State private var platform = ""
    @State private var removeFromBinder = true

    private let platforms = ["", "TCGPlayer", "CardMarket", "eBay", "Local", "Other"]

    var body: some View {
        NavigationView {
            Form {
                Section {
                    HStack(spacing: 12) {
                        if let url = card.imageUrlSmall ?? card.imageUrl, let imageURL = URL(string: url) {
                            CachedAsyncImage(url: imageURL) { phase in
                                if case .success(let image) = phase {
                                    image.resizable().aspectRatio(contentMode: .fit)
                                } else {
                                    Rectangle().fill(Color(.systemGray5))
                                }
                            }
                            .frame(width: 40, height: 56)
                            .cornerRadius(4)
                        }
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
                } header: {
                    Text("Sale Details")
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
                        onSell(amount, platform.isEmpty ? nil : platform, removeFromBinder)
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

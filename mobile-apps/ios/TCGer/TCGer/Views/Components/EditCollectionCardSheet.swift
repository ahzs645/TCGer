import SwiftUI

struct EditCollectionCardSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let card: CollectionCard
    let isSaving: Bool
    let onSave: (Int, String?, String?, String?, Card?) async -> Void

    @State private var quantity: Int
    @State private var conditionSelection: String
    @State private var languageSelection: String
    @State private var notes: String
    @State private var showingPrintSelection = false
    @State private var selectedPrint: Card?

    private let conditions = ["", "Mint", "Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor"]
    private let languages = ["", "English", "Japanese", "German", "French", "Italian", "Spanish", "Portuguese", "Korean", "Chinese"]

    private var supportsPrintSelection: Bool {
        card.supportsPrintSelection
    }

    init(card: CollectionCard, isSaving: Bool, onSave: @escaping (Int, String?, String?, String?, Card?) async -> Void) {
        self.card = card
        self.isSaving = isSaving
        self.onSave = onSave

        _quantity = State(initialValue: max(1, card.quantity))
        _conditionSelection = State(initialValue: card.condition ?? "")
        _languageSelection = State(initialValue: card.language ?? "")
        _notes = State(initialValue: card.notes ?? "")
    }

    var body: some View {
        NavigationView {
            Form {
                Section {
                    HStack(spacing: 12) {
                        AsyncImage(url: URL(string: card.imageUrlSmall ?? card.imageUrl ?? "")) { phase in
                            switch phase {
                            case .success(let image):
                                image.resizable().aspectRatio(contentMode: .fit)
                            case .empty, .failure:
                                Rectangle()
                                    .fill(Color(.systemGray5))
                                    .overlay(Image(systemName: "photo").foregroundColor(.secondary))
                            @unknown default:
                                Rectangle()
                                    .fill(Color(.systemGray5))
                                    .overlay(Image(systemName: "photo").foregroundColor(.secondary))
                            }
                        }
                        .frame(width: 60, height: 84)
                        .cornerRadius(6)

                        VStack(alignment: .leading, spacing: 6) {
                            Text(card.name)
                                .font(.headline)
                            if let setCode = card.setCode {
                                Text(setCode)
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                            Text("Currently ×\(card.quantity)")
                                .font(.caption)
                                .foregroundColor(.secondary)
                        }
                        Spacer()
                    }
                } header: {
                    Text("Card")
                }

                Section {
                    Stepper(value: $quantity, in: 1...999) {
                        Text("Quantity: \(quantity)")
                    }
                } header: {
                    Text("Quantity")
                }

                // Print selection for games that support multiple printings
                if supportsPrintSelection {
                    Section {
                        Button {
                            // Create a minimal Card object for print selection
                            let externalCardId = card.externalId ?? card.cardId
                            selectedPrint = Card(
                                id: externalCardId,
                                name: card.name,
                                tcg: card.tcg,
                                setCode: card.setCode,
                                setName: card.setName,
                                rarity: card.rarity,
                                imageUrl: card.imageUrl,
                                imageUrlSmall: card.imageUrlSmall,
                                price: card.price,
                                collectorNumber: card.collectorNumber,
                                releasedAt: nil
                            )
                            showingPrintSelection = true
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Print")
                                        .foregroundColor(.primary)
                                    if let setName = selectedPrint?.setName ?? card.setName {
                                        Text(setName)
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                    if let collectorNumber = selectedPrint?.collectorNumber ?? card.collectorNumber {
                                        Text("#\(collectorNumber)")
                                            .font(.caption)
                                            .foregroundColor(.secondary)
                                    }
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                    } header: {
                        Text("Print Selection")
                    } footer: {
                        Text("Change to a different printing of this card")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Section {
                    Picker("Condition", selection: $conditionSelection) {
                        Text("Unspecified").tag("")
                        ForEach(conditions.filter { !$0.isEmpty }, id: \.self) { option in
                            Text(option).tag(option)
                        }
                    }

                    Picker("Language", selection: $languageSelection) {
                        Text("Unspecified").tag("")
                        ForEach(languages.filter { !$0.isEmpty }, id: \.self) { option in
                            Text(option).tag(option)
                        }
                    }
                } header: {
                    Text("Details")
                }

                Section {
                    TextField("Description or notes", text: $notes, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Notes")
                } footer: {
                    Text("Use this space to track card-specific notes such as condition issues or purchase details.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("Edit Card")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving..." : "Save") {
                        Task {
                            await onSave(
                                quantity,
                                conditionSelection.isEmpty ? nil : conditionSelection,
                                languageSelection.isEmpty ? nil : languageSelection,
                                notes.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : notes,
                                selectedPrint
                            )
                        }
                    }
                    .disabled(isSaving)
                }
            }
            .sheet(isPresented: $showingPrintSelection) {
                if let print = selectedPrint {
                    SelectPrintSheet(card: print, selectedPrint: Binding(
                        get: { selectedPrint ?? print },
                        set: { selectedPrint = $0 }
                    ))
                    .environmentObject(environmentStore)
                }
            }
        }
    }
}

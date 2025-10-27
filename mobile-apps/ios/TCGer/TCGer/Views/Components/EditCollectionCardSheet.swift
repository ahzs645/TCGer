import SwiftUI

struct EditCollectionCardSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    struct SavePayload: Sendable {
        let quantity: Int
        let condition: String?
        let language: String?
        let notes: String?
        let selectedPrint: Card?
    }

    let card: CollectionCard
    let isIndividualCopy: Bool
    let copyDetails: CollectionCardCopy?
    let isSaving: Bool
    let onSave: (SavePayload) async -> Void

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

    private var copyTitle: String? {
        guard let copy = copyDetails else { return nil }
        if let serial = copy.serialNumber, !serial.isEmpty {
            return serial
        }
        if let index = card.copies.firstIndex(where: { $0.id == copy.id }) {
            return "Copy #\(index + 1)"
        }
        return "Copy"
    }

    private var copyDetailsLine: String? {
        guard let copy = copyDetails else { return nil }
        var parts: [String] = []
        if let condition = copy.condition, !condition.isEmpty {
            parts.append(condition)
        }
        if let language = copy.language, !language.isEmpty {
            parts.append(language)
        }
        return parts.joined(separator: " • ")
    }

    init(
        card: CollectionCard,
        isIndividualCopy: Bool = false,
        copyDetails: CollectionCardCopy? = nil,
        isSaving: Bool,
        onSave: @escaping (SavePayload) async -> Void
    ) {
        self.card = card
        self.isIndividualCopy = isIndividualCopy
        self.copyDetails = copyDetails
        self.isSaving = isSaving
        self.onSave = onSave

        _quantity = State(initialValue: max(1, card.quantity))
        _conditionSelection = State(initialValue: copyDetails?.condition ?? card.condition ?? "")
        _languageSelection = State(initialValue: copyDetails?.language ?? card.language ?? "")
        _notes = State(initialValue: copyDetails?.notes ?? card.notes ?? "")
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
                            if let copyTitle {
                                Text(copyTitle)
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                            }
                            if let copyDetailsLine {
                                Text(copyDetailsLine)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            } else {
                                Text("Currently ×\(card.quantity)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        Spacer()
                    }
                } header: {
                    Text("Card")
                }

                if !isIndividualCopy {
                    Section {
                        Stepper(value: $quantity, in: 1...999) {
                            Text("Quantity: \(quantity)")
                        }
                    } header: {
                        Text("Quantity")
                    }
                }

                // Print selection for games that support multiple printings
                if supportsPrintSelection {
                    Section {
                        Button {
                            // Create a minimal Card object for print selection
                            // Use externalId if available and non-empty, otherwise fall back to cardId
                            let externalCardId = card.externalId.flatMap { $0.isEmpty ? nil : $0 } ?? card.cardId
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
                        let quantityToSave = quantity
                        let conditionToSave = conditionSelection.trimmingCharacters(in: .whitespacesAndNewlines)
                        let languageToSave = languageSelection.trimmingCharacters(in: .whitespacesAndNewlines)
                        let notesToSave = notes.trimmingCharacters(in: .whitespacesAndNewlines)
                        let selectedPrintToSave = selectedPrint
                        let payload = SavePayload(
                            quantity: quantityToSave,
                            condition: conditionToSave.isEmpty ? nil : conditionToSave,
                            language: languageToSave.isEmpty ? nil : languageToSave,
                            notes: notesToSave.isEmpty ? nil : notesToSave,
                            selectedPrint: selectedPrintToSave
                        )
#if DEBUG
                        print("EditCollectionCardSheet.onSave -> quantity:\(payload.quantity) condition:\(payload.condition ?? "nil") language:\(payload.language ?? "nil") notes:\(payload.notes ?? "nil") print:\(payload.selectedPrint?.id ?? "nil")")
#endif

                        Task {
                            await onSave(payload)
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

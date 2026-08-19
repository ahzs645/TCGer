import SwiftUI

struct CardEditorDraft {
    var quantity: Int
    var condition: String
    var language: String
    var notes: String
    var isFoil: Bool
    var isSigned: Bool
    var isAltered: Bool
    var finishCode: String
    var edition: String
    var stamp: String
    var isSealedPromo: Bool
    var isOversized: Bool
    var isPeelOff: Bool
    var selectedPrint: Card?
    var gradingCompany: String
    var gradingScore: String
    var certNumber: String
    var storageLocation: String
    var selectedTagIds: Set<String>

    var variant: CardCopyVariant {
        let trimmedEdition = edition.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedStamp = stamp.trimmingCharacters(in: .whitespacesAndNewlines)
        return CardCopyVariant(
            finishCode: finishCode.isEmpty ? nil : finishCode,
            finishLabel: finishCode.isEmpty ? nil : PokemonFinishOption.label(for: finishCode),
            edition: trimmedEdition.isEmpty ? nil : trimmedEdition,
            stamp: trimmedStamp.isEmpty ? nil : trimmedStamp,
            isSealedPromo: isSealedPromo,
            isOversized: isOversized,
            isPeelOff: isPeelOff
        )
    }

    func finishOptions(for fallbackCard: Card) -> [PokemonFinishOption] {
        PokemonFinishOption.options(for: selectedPrint ?? fallbackCard, includeCatalog: true)
    }

    mutating func applyPrintDefaults(for card: Card) {
        let options = PokemonFinishOption.options(for: card, includeCatalog: true)
        if !options.contains(where: { $0.code.caseInsensitiveCompare(finishCode) == .orderedSame }) {
            finishCode = options.first?.code ?? ""
        }
        edition = card.pokemonPrint?.variants?.firstEdition == true ? "1st Edition" : ""
        stamp = card.pokemonPrint?.worldChampionship?.stamp ?? ""
    }
}

struct CardPrintSelectionSection: View {
    let card: Card
    let selectedPrint: Card?
    let isDisabled: Bool
    let onSelect: () -> Void

    var body: some View {
        Section {
            Button(action: onSelect) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Print")
                            .foregroundStyle(.primary)
                        if let setName = selectedPrint?.setName ?? card.setName {
                            Text(setName)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        if let collectorNumber = selectedPrint?.collectorNumber ?? card.collectorNumber {
                            Text("#\(collectorNumber)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
            }
            .disabled(isDisabled)
        } header: {
            Text("Print Selection")
        } footer: {
            Text("Choose from every available printing, including World Championship versions.")
        }
    }
}

struct CardEditorDetailsSection: View {
    @Binding var quantity: Int
    @Binding var condition: String
    @Binding var language: String
    let showsQuantity: Bool

    private let languages = PokemonCardLanguage.allCases.map(\.rawValue)

    var body: some View {
        Section {
            if showsQuantity {
                Stepper("Quantity: \(quantity)", value: $quantity, in: 1...999)
            }

            ConditionPicker(selection: $condition, includeUnspecified: true)

            Picker("Language", selection: $language) {
                Text("Unspecified").tag("")
                ForEach(languages, id: \.self) { option in
                    Text(option).tag(option)
                }
            }
        } header: {
            Text("Card Details")
        }
    }
}

struct CardEditorAttributesSection: View {
    let card: Card
    let finishOptions: [PokemonFinishOption]
    @Binding var isFoil: Bool
    @Binding var isSigned: Bool
    @Binding var isAltered: Bool
    @Binding var finishCode: String
    @Binding var edition: String
    @Binding var stamp: String
    @Binding var isSealedPromo: Bool
    @Binding var isOversized: Bool
    @Binding var isPeelOff: Bool

    var body: some View {
        Section {
            if card.tcg.lowercased() == TCGGame.pokemon.rawValue {
                Picker("Finish", selection: $finishCode) {
                    Text("Not specified").tag("")
                    ForEach(finishOptions) { finish in
                        Text(finish.label).tag(finish.code)
                    }
                }
                TextField("Edition (e.g. 1st Edition)", text: $edition)
                TextField("Stamp (e.g. Prerelease, Staff)", text: $stamp)
                Toggle("Sealed promo", isOn: $isSealedPromo)
                Toggle("Oversized", isOn: $isOversized)
                Toggle("Peel-off", isOn: $isPeelOff)
            } else {
                Toggle(isOn: $isFoil) {
                    Label("Foil", systemImage: "sparkles")
                }
            }
            Toggle(isOn: $isSigned) {
                Label("Signed", systemImage: "pencil.line")
            }
            Toggle(isOn: $isAltered) {
                Label("Altered Art", systemImage: "paintpalette")
            }
        } header: {
            Text("Attributes")
        }
    }
}

struct CardEditorGradingSection: View {
    @Binding var company: String
    @Binding var score: String
    @Binding var certNumber: String

    var body: some View {
        Section {
            Picker("Company", selection: $company) {
                Text("None").tag("")
                Text("PSA").tag("PSA")
                Text("BGS / Beckett").tag("BGS")
                Text("CGC").tag("CGC")
                Text("SGC").tag("SGC")
                Text("Other").tag("Other")
            }
            if !company.isEmpty {
                TextField("Grade (e.g., 10, 9.5)", text: $score)
                    .keyboardType(.decimalPad)
                TextField("Certificate Number", text: $certNumber)
                    .keyboardType(.numberPad)
            }
        } header: {
            Text("Grading")
        }
    }
}

struct CardEditorStorageSection: View {
    @Binding var storageLocation: String

    var body: some View {
        Section {
            TextField("e.g., Home Safe, Display Case, PSA Submission", text: $storageLocation)
        } header: {
            Text("Storage Location")
        }
    }
}

struct CardEditorNotesSection: View {
    @Binding var notes: String

    var body: some View {
        Section {
            TextField("Notes (optional)", text: $notes, axis: .vertical)
                .lineLimit(3...6)
        } header: {
            Text("Notes")
        } footer: {
            Text("Track card-specific details such as condition issues or purchase information.")
        }
    }
}

struct CardEditorTagsSection: View {
    @Binding var tags: [CollectionCardTag]
    @Binding var selectedTagIds: Set<String>
    let onCreateTag: ((String) async throws -> CollectionCardTag)?

    @State private var newTagLabel = ""
    @State private var isCreatingTag = false
    @State private var tagError: String?

    var body: some View {
        Section {
            if tags.isEmpty {
                Text("No tags yet. Create one below.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(tags) { tag in
                    Button {
                        toggle(tag)
                    } label: {
                        HStack(spacing: 10) {
                            Circle()
                                .fill(Color.fromHex(tag.colorHex))
                                .frame(width: 10, height: 10)
                            Text(tag.label)
                                .foregroundStyle(.primary)
                            Spacer()
                            if selectedTagIds.contains(tag.id) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(Color.accentColor)
                            }
                        }
                    }
                }
            }

            if onCreateTag != nil {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        TextField("Create new tag", text: $newTagLabel)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Button(isCreatingTag ? "Adding..." : "Add") {
                            Task { await createTag() }
                        }
                        .disabled(isCreatingTag || newTagLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }

                    if let tagError {
                        Text(tagError)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            }
        } header: {
            Text("Tags")
        } footer: {
            Text("Assign tags to this copy for filtering and organization.")
        }
    }

    private func toggle(_ tag: CollectionCardTag) {
        if selectedTagIds.contains(tag.id) {
            selectedTagIds.remove(tag.id)
        } else {
            selectedTagIds.insert(tag.id)
        }
    }

    @MainActor
    private func createTag() async {
        guard let onCreateTag else { return }
        let label = newTagLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return }

        tagError = nil
        isCreatingTag = true
        defer { isCreatingTag = false }

        do {
            let tag = try await onCreateTag(label)
            if !tags.contains(where: { $0.id == tag.id }) {
                tags.append(tag)
                tags.sort { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
            }
            selectedTagIds.insert(tag.id)
            newTagLabel = ""
        } catch {
            tagError = error.localizedDescription
        }
    }
}

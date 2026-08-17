import SwiftUI

struct EditCollectionCardSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    struct SavePayload: Sendable {
        let quantity: Int
        let condition: String?
        let language: String?
        let notes: String?
        let isFoil: Bool
        let isSigned: Bool
        let isAltered: Bool
        let variant: CardCopyVariant
        let tags: [String]
        let selectedPrint: Card?
        let gradingCompany: String?
        let gradingScore: String?
        let certNumber: String?
        let storageLocation: String?
    }

    let card: CollectionCard
    let isIndividualCopy: Bool
    let copyDetails: CollectionCardCopy?
    let isSaving: Bool
    let onCreateTag: ((String) async throws -> CollectionCardTag)?
    let onSave: @Sendable (SavePayload) -> Void

    @State private var quantity: Int
    @State private var conditionSelection: String
    @State private var languageSelection: String
    @State private var notes: String
    @State private var selectedTagIds: Set<String>
    @State private var localTags: [CollectionCardTag]
    @State private var isFoil: Bool
    @State private var isSigned: Bool
    @State private var isAltered: Bool
    @State private var finishCode: String
    @State private var edition: String
    @State private var stamp: String
    @State private var isSealedPromo: Bool
    @State private var isOversized: Bool
    @State private var isPeelOff: Bool
    @State private var newTagLabel = ""
    @State private var isCreatingTag = false
    @State private var tagError: String?
    @State private var showingPrintSelection = false
    @State private var selectedPrint: Card?
    @State private var gradingCompany: String
    @State private var gradingScore: String
    @State private var certNumber: String
    @State private var storageLocation: String

    private let languages = [""] + PokemonCardLanguage.allCases.map(\.rawValue)

    private var supportsPrintSelection: Bool {
        card.supportsPrintSelection
    }

    private var finishOptions: [PokemonFinishOption] {
        var options = PokemonFinishOption.catalog
        if let selectedPrint {
            for option in PokemonFinishOption.options(for: selectedPrint) where
                !options.contains(where: { $0.code.caseInsensitiveCompare(option.code) == .orderedSame }) {
                options.append(option)
            }
        }
        if let metadata = card.pokemonPrint {
            metadata.finishes?.forEach { code in
                guard !options.contains(where: { $0.code.caseInsensitiveCompare(code) == .orderedSame }) else { return }
                options.append(.init(code: code, label: PokemonFinishOption.label(for: code)))
            }
        }
        return options
    }

    private var copyTitle: String? {
        guard let copy = copyDetails else { return nil }
        let index = card.copies.firstIndex(where: { $0.id == copy.id }) ?? 0
        return copy.displayTitle(index: index, totalCount: card.copies.count)
    }

    private var copyDetailsLine: String? {
        copyDetails?.detailLine
    }

    init(
        card: CollectionCard,
        isIndividualCopy: Bool = false,
        copyDetails: CollectionCardCopy? = nil,
        isSaving: Bool,
        availableTags: [CollectionCardTag] = [],
        selectedTagIds: [String] = [],
        onCreateTag: ((String) async throws -> CollectionCardTag)? = nil,
        onSave: @escaping @Sendable (SavePayload) -> Void
    ) {
        self.card = card
        self.isIndividualCopy = isIndividualCopy
        self.copyDetails = copyDetails
        self.isSaving = isSaving
        self.onCreateTag = onCreateTag
        self.onSave = onSave

        _quantity = State(initialValue: max(1, card.quantity))
        _conditionSelection = State(initialValue: (copyDetails?.condition ?? card.condition).map(CardCondition.canonicalize) ?? "")
        _languageSelection = State(initialValue: copyDetails?.language ?? card.language ?? "")
        _notes = State(initialValue: copyDetails?.notes ?? card.notes ?? "")
        _isFoil = State(initialValue: copyDetails?.isFoil ?? false)
        _isSigned = State(initialValue: copyDetails?.isSigned ?? false)
        _isAltered = State(initialValue: copyDetails?.isAltered ?? false)
        _finishCode = State(initialValue: copyDetails?.finishCode ?? (copyDetails?.isFoil == true ? "foil" : ""))
        _edition = State(initialValue: copyDetails?.edition ?? "")
        _stamp = State(initialValue: copyDetails?.stamp ?? "")
        _isSealedPromo = State(initialValue: copyDetails?.isSealedPromo ?? false)
        _isOversized = State(initialValue: copyDetails?.isOversized ?? false)
        _isPeelOff = State(initialValue: copyDetails?.isPeelOff ?? false)
        _selectedTagIds = State(initialValue: Set(selectedTagIds))
        _localTags = State(initialValue: availableTags.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending })
        _gradingCompany = State(initialValue: copyDetails?.gradingCompany ?? "")
        _gradingScore = State(initialValue: copyDetails?.gradingScore ?? "")
        _certNumber = State(initialValue: copyDetails?.certNumber ?? "")
        _storageLocation = State(initialValue: copyDetails?.storageLocation ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 12) {
                        CardArtworkImage(card: card.previewCard, useFullResolution: false)
                            .frame(width: 60, height: 84)

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
                                releasedAt: nil,
                                supertype: card.supertype,
                                formatLegality: card.formatLegality,
                                dexEntries: card.dexEntries,
                                region: card.region,
                                setSymbolUrl: card.setSymbolUrl,
                                setLogoUrl: card.setLogoUrl,
                                regulationMark: card.regulationMark,
                                language: card.languageCode,
                                pokemonPrint: card.pokemonPrint,
                                attributes: card.attributes,
                                provenance: card.provenance,
                                legalityPeriods: card.legalityPeriods,
                                evolution: card.evolution,
                                functionalIdentity: card.functionalIdentity,
                                baseExternalId: card.baseExternalId,
                                printingKey: card.printingKey,
                                artworkId: card.artworkId,
                                printingKind: card.printingKind,
                                sanctionedPlayLegal: card.sanctionedPlayLegal,
                                originalPrintingKey: card.originalPrintingKey
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
                    ConditionPicker(selection: $conditionSelection, includeUnspecified: true)

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
                    if card.tcg.lowercased() == "pokemon" {
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

                Section {
                    Picker("Company", selection: $gradingCompany) {
                        Text("None").tag("")
                        Text("PSA").tag("PSA")
                        Text("BGS / Beckett").tag("BGS")
                        Text("CGC").tag("CGC")
                        Text("SGC").tag("SGC")
                        Text("Other").tag("Other")
                    }
                    if !gradingCompany.isEmpty {
                        TextField("Grade (e.g., 10, 9.5)", text: $gradingScore)
                            .keyboardType(.decimalPad)
                        TextField("Certificate Number", text: $certNumber)
                            .keyboardType(.numberPad)
                    }
                } header: {
                    Text("Grading")
                }

                Section {
                    TextField("e.g., Home Safe, Display Case, PSA Submission", text: $storageLocation)
                } header: {
                    Text("Storage Location")
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

                Section {
                    if localTags.isEmpty {
                        Text("No tags yet. Create one below.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    } else {
                        ForEach(localTags) { tag in
                            Button {
                                if selectedTagIds.contains(tag.id) {
                                    selectedTagIds.remove(tag.id)
                                } else {
                                    selectedTagIds.insert(tag.id)
                                }
                            } label: {
                                HStack(spacing: 10) {
                                    Circle()
                                        .fill(Color.fromHex(tag.colorHex))
                                        .frame(width: 10, height: 10)
                                    Text(tag.label)
                                        .foregroundColor(.primary)
                                    Spacer()
                                    if selectedTagIds.contains(tag.id) {
                                        Image(systemName: "checkmark")
                                            .foregroundColor(.accentColor)
                                    }
                                }
                            }
                        }
                    }

                    if onCreateTag != nil {
                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                TextField("Create new tag", text: $newTagLabel)
                                    .autocapitalization(.none)
                                    .disableAutocorrection(true)
                                Button(isCreatingTag ? "Adding..." : "Add") {
                                    Task { await createTag() }
                                }
                                .disabled(isCreatingTag || newTagLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }

                            if let tagError {
                                Text(tagError)
                                    .font(.caption)
                                    .foregroundColor(.red)
                            }
                        }
                    }
                } header: {
                    Text("Tags")
                } footer: {
                    Text("Assign tags to this copy for filtering and organization.")
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
                        let gradingCompanyTrimmed = gradingCompany.trimmingCharacters(in: .whitespacesAndNewlines)
                        let gradingScoreTrimmed = gradingScore.trimmingCharacters(in: .whitespacesAndNewlines)
                        let certNumberTrimmed = certNumber.trimmingCharacters(in: .whitespacesAndNewlines)
                        let storageTrimmed = storageLocation.trimmingCharacters(in: .whitespacesAndNewlines)
                        let editionTrimmed = edition.trimmingCharacters(in: .whitespacesAndNewlines)
                        let stampTrimmed = stamp.trimmingCharacters(in: .whitespacesAndNewlines)
                        let variant = CardCopyVariant(
                            finishCode: finishCode.isEmpty ? nil : finishCode,
                            finishLabel: finishCode.isEmpty ? nil : PokemonFinishOption.label(for: finishCode),
                            edition: editionTrimmed.isEmpty ? nil : editionTrimmed,
                            stamp: stampTrimmed.isEmpty ? nil : stampTrimmed,
                            isSealedPromo: isSealedPromo,
                            isOversized: isOversized,
                            isPeelOff: isPeelOff
                        )
                        let payload = SavePayload(
                            quantity: quantityToSave,
                            condition: conditionToSave.isEmpty ? nil : conditionToSave,
                            language: languageToSave.isEmpty ? nil : languageToSave,
                            notes: notesToSave.isEmpty ? nil : notesToSave,
                            isFoil: card.tcg.lowercased() == "pokemon" ? variant.isFoil : isFoil,
                            isSigned: isSigned,
                            isAltered: isAltered,
                            variant: variant,
                            tags: selectedTagIds.sorted(),
                            selectedPrint: selectedPrintToSave,
                            gradingCompany: gradingCompanyTrimmed.isEmpty ? nil : gradingCompanyTrimmed,
                            gradingScore: gradingScoreTrimmed.isEmpty ? nil : gradingScoreTrimmed,
                            certNumber: certNumberTrimmed.isEmpty ? nil : certNumberTrimmed,
                            storageLocation: storageTrimmed.isEmpty ? nil : storageTrimmed
                        )
#if DEBUG
                        print("EditCollectionCardSheet.onSave -> quantity:\(payload.quantity) condition:\(payload.condition ?? "nil") language:\(payload.language ?? "nil") notes:\(payload.notes ?? "nil") tags:\(payload.tags) print:\(payload.selectedPrint?.id ?? "nil")")
#endif

                        onSave(payload)
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
            .onChange(of: selectedPrint?.id) { _, _ in
                guard let selectedPrint else { return }
                let options = PokemonFinishOption.options(for: selectedPrint, includeCatalog: true)
                if !options.contains(where: { $0.code == finishCode }) {
                    finishCode = options.first?.code ?? ""
                }
                edition = selectedPrint.pokemonPrint?.variants?.firstEdition == true
                    ? "1st Edition"
                    : ""
            }
        }
    }

    @MainActor
    private func createTag() async {
        guard let onCreateTag else { return }

        let label = newTagLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return }

        tagError = nil
        isCreatingTag = true

        defer {
            isCreatingTag = false
        }

        do {
            let tag = try await onCreateTag(label)
            if !localTags.contains(where: { $0.id == tag.id }) {
                localTags.append(tag)
                localTags.sort { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
            }
            selectedTagIds.insert(tag.id)
            newTagLabel = ""
        } catch {
            tagError = error.localizedDescription
        }
    }
}

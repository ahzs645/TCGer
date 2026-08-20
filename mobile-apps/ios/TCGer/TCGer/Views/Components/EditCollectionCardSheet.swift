import SwiftUI

struct EditCollectionCardSheet: View {
    @Environment(\.dismiss) private var dismiss

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

    @State private var draft: CardEditorDraft
    @State private var localTags: [CollectionCardTag]

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

        _draft = State(initialValue: CardEditorDraft(
            quantity: max(1, card.quantity),
            condition: (copyDetails?.condition ?? card.condition).map(CardCondition.canonicalize) ?? "",
            language: copyDetails?.language ?? card.language ?? "",
            notes: copyDetails?.notes ?? card.notes ?? "",
            isFoil: copyDetails?.isFoil ?? false,
            isSigned: copyDetails?.isSigned ?? false,
            isAltered: copyDetails?.isAltered ?? false,
            finishCode: copyDetails?.finishCode ?? (copyDetails?.isFoil == true ? "foil" : ""),
            edition: copyDetails?.edition ?? "",
            stamp: copyDetails?.stamp ?? "",
            isSealedPromo: copyDetails?.isSealedPromo ?? false,
            isOversized: copyDetails?.isOversized ?? false,
            isPeelOff: copyDetails?.isPeelOff ?? false,
            gradingCompany: copyDetails?.gradingCompany ?? "",
            gradingScore: copyDetails?.gradingScore ?? "",
            certNumber: copyDetails?.certNumber ?? "",
            storageLocation: copyDetails?.storageLocation ?? "",
            selectedTagIds: Set(selectedTagIds)
        ))
        _localTags = State(initialValue: availableTags.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending })
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

                CardCopyEditorSections(
                    card: card.previewCard,
                    draft: $draft,
                    tags: $localTags,
                    showsQuantity: !isIndividualCopy,
                    onCreateTag: onCreateTag
                )
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
                    Button(isSaving ? "Saving..." : "Save", action: save)
                    .disabled(isSaving)
                }
            }
        }
    }

    private func save() {
        func trimmed(_ value: String) -> String? {
            let result = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return result.isEmpty ? nil : result
        }

        let variant = draft.variant
        let payload = SavePayload(
            quantity: draft.quantity,
            condition: trimmed(draft.condition),
            language: trimmed(draft.language),
            notes: trimmed(draft.notes),
            isFoil: card.tcg.lowercased() == TCGGame.pokemon.rawValue ? variant.isFoil : draft.isFoil,
            isSigned: draft.isSigned,
            isAltered: draft.isAltered,
            variant: variant,
            tags: draft.selectedTagIds.sorted(),
            gradingCompany: trimmed(draft.gradingCompany),
            gradingScore: trimmed(draft.gradingScore),
            certNumber: trimmed(draft.certNumber),
            storageLocation: trimmed(draft.storageLocation)
        )
#if DEBUG
        print("EditCollectionCardSheet.onSave -> quantity:\(payload.quantity) condition:\(payload.condition ?? "nil") language:\(payload.language ?? "nil") notes:\(payload.notes ?? "nil") tags:\(payload.tags)")
#endif
        onSave(payload)
    }
}

import SwiftUI

struct EditCollectionCardSheet: View {
    @Environment(\.dismiss) private var dismiss

    typealias SavePayload = CardCopyEditorValues

    let card: CollectionCard
    let binderId: String
    let collectionEntryId: String
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
        binderId: String,
        collectionEntryId: String,
        isIndividualCopy: Bool = false,
        copyDetails: CollectionCardCopy? = nil,
        isSaving: Bool,
        availableTags: [CollectionCardTag] = [],
        selectedTagIds: [String] = [],
        onCreateTag: ((String) async throws -> CollectionCardTag)? = nil,
        onSave: @escaping @Sendable (SavePayload) -> Void
    ) {
        self.card = card
        self.binderId = binderId
        self.collectionEntryId = collectionEntryId
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
                    CardIdentityRow(card: card.previewCard) {
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
                } header: {
                    Text("Card")
                }

                CardAcquisitionSection(
                    card: card,
                    binderId: binderId,
                    collectionEntryId: collectionEntryId,
                    copyDetails: copyDetails
                )

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
        let payload = draft.normalizedValues(for: card.previewCard)
#if DEBUG
        print("EditCollectionCardSheet.onSave -> quantity:\(payload.quantity) condition:\(payload.condition ?? "nil") language:\(payload.language ?? "nil") notes:\(payload.notes ?? "nil") tags:\(payload.tags)")
#endif
        onSave(payload)
    }
}

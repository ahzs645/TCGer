import SwiftUI

/// Shared "New Binder" form (name, description, color, default condition)
/// used by the collections screen and binder-selection flows.
struct CreateBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var confirmingDiscard = false
    @State private var isCreating = false
    @State private var name = ""
    @State private var description = ""
    @State private var selectedColor: Color = Color.binderColors[0]
    @State private var defaultCondition = ""
    @State private var containerType = ""
    @State private var imageUrl = ""
    let onCreate: (String, String?, String?, String?, BinderPresentationInput) async -> Void
    private let includesPresentationFields: Bool

    init(onCreate: @escaping (String, String?, String?, String?) async -> Void) {
        includesPresentationFields = false
        self.onCreate = { name, description, colorHex, defaultCondition, _ in
            await onCreate(name, description, colorHex, defaultCondition)
        }
    }

    init(
        onCreateWithPresentation: @escaping (
            String,
            String?,
            String?,
            String?,
            BinderPresentationInput
        ) async -> Void
    ) {
        includesPresentationFields = true
        self.onCreate = onCreateWithPresentation
    }

    private var hasChanges: Bool {
        !name.isEmpty || !description.isEmpty || !defaultCondition.isEmpty ||
        !containerType.isEmpty || !imageUrl.isEmpty ||
        selectedColor.toHex() != Color.binderColors[0].toHex()
    }

    private var coverURLIsValid: Bool {
        let trimmed = imageUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return true }
        guard let url = URL(string: trimmed), let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    var body: some View {
        NavigationStack {
            Form {
                NameDescriptionColorSections(
                    namePlaceholder: "Binder Name",
                    name: $name,
                    description: $description,
                    selectedColor: $selectedColor,
                    nameAccessibilityIdentifier: ParityControlID.inputCollectionsName
                )

                Section {
                    ConditionPicker(selection: $defaultCondition, includeUnspecified: true)
                } footer: {
                    Text("Cards added to this binder start with this condition unless you pick another one.")
                }

                if includesPresentationFields {
                    BinderPresentationFields(
                        containerType: $containerType,
                        imageUrl: $imageUrl
                    )

                    if !coverURLIsValid {
                        Section {
                            Label("Enter an http or https cover image URL.", systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
            .disabled(isCreating)
            .navigationTitle("New Binder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if hasChanges { confirmingDiscard = true } else { dismiss() }
                    }
                    .disabled(isCreating)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isCreating ? "Creating…" : "Create") {
                        isCreating = true
                        Task {
                            defer { isCreating = false }
                            await onCreate(
                                name,
                                description.isEmpty ? nil : description,
                                selectedColor.toHex(),
                                defaultCondition.isEmpty ? nil : defaultCondition,
                                .from(
                                    containerType: containerType,
                                    imageUrl: imageUrl
                                )
                            )
                            dismiss()
                        }
                    }
                    .disabled(isCreating || name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !coverURLIsValid)
                    .accessibilityIdentifier(ParityControlID.actionCollectionsConfirmCreate)
                }
            }
        }
        .modifier(UnsavedChangesGuard(hasChanges: hasChanges, isSaving: isCreating, confirmingDiscard: $confirmingDiscard))
        .accessibilityIdentifier(ParityFeatureID.collectionsCreate.screenIdentifier)
    }
}

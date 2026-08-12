import SwiftUI

/// Shared "New Binder" form (name, description, color, default condition)
/// used by the collections screen and binder-selection flows.
struct CreateBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var selectedColor: Color = Color.binderColors[0]
    @State private var defaultCondition = ""
    @State private var containerType = ""
    @State private var imageUrl = ""
    @State private var associatedTcg = ""
    @State private var associatedSetCode = ""
    @State private var associatedSetName = ""
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
                    selectedColor: $selectedColor
                )

                Section {
                    ConditionPicker(selection: $defaultCondition, includeUnspecified: true)
                } footer: {
                    Text("Cards added to this binder start with this condition unless you pick another one.")
                }

                if includesPresentationFields {
                    BinderPresentationFields(
                        containerType: $containerType,
                        imageUrl: $imageUrl,
                        associatedTcg: $associatedTcg,
                        associatedSetCode: $associatedSetCode,
                        associatedSetName: $associatedSetName
                    )

                    if !coverURLIsValid {
                        Section {
                            Label("Enter an http or https cover image URL.", systemImage: "exclamationmark.triangle")
                                .foregroundStyle(.red)
                        }
                    }
                }
            }
            .navigationTitle("New Binder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            await onCreate(
                                name,
                                description.isEmpty ? nil : description,
                                selectedColor.toHex(),
                                defaultCondition.isEmpty ? nil : defaultCondition,
                                .from(
                                    containerType: containerType,
                                    imageUrl: imageUrl,
                                    associatedTcg: associatedTcg,
                                    associatedSetCode: associatedSetCode,
                                    associatedSetName: associatedSetName
                                )
                            )
                            dismiss()
                        }
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !coverURLIsValid)
                }
            }
        }
    }
}

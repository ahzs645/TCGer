import SwiftUI

/// Shared "New Binder" form (name, description, color, default condition)
/// used by the collections screen and the binder-page review target picker.
struct CreateBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var selectedColor: Color = Color.binderColors[0]
    @State private var defaultCondition = ""
    let onCreate: (String, String?, String?, String?) async -> Void

    var body: some View {
        NavigationView {
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
                                defaultCondition.isEmpty ? nil : defaultCondition
                            )
                            dismiss()
                        }
                    }
                    .disabled(name.isEmpty)
                }
            }
        }
    }
}

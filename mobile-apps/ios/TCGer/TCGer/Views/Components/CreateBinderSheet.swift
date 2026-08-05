import SwiftUI

/// Shared "New Binder" form (name, description, color) used by the
/// collections screen and the binder-page review target picker.
struct CreateBinderSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var description = ""
    @State private var selectedColor: Color = Color.binderColors[0]
    let onCreate: (String, String?, String?) async -> Void

    var body: some View {
        NavigationView {
            Form {
                NameDescriptionColorSections(
                    namePlaceholder: "Binder Name",
                    name: $name,
                    description: $description,
                    selectedColor: $selectedColor
                )
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
                            await onCreate(name, description.isEmpty ? nil : description, selectedColor.toHex())
                            dismiss()
                        }
                    }
                    .disabled(name.isEmpty)
                }
            }
        }
    }
}

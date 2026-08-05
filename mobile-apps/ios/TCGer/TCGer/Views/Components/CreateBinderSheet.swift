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
                Section {
                    TextField("Binder Name", text: $name)
                } header: {
                    Text("Name")
                } footer: {
                    Text("Give your binder a memorable name")
                }

                Section {
                    TextField("Description (optional)", text: $description, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Description")
                }

                Section {
                    ColorPickerGrid(selectedColor: $selectedColor)
                        .padding(.vertical, 8)
                } header: {
                    Text("Binder Color")
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

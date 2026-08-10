import SwiftUI

/// A binder-selection field that presents the available binders in a bottom
/// sheet. Use this where the selection is part of a form and deserves more
/// room than a compact menu can provide.
struct BinderPickerSheetButton: View {
    let binders: [Collection]
    @Binding var selectedBinderId: String?
    var placeholder = "Select a binder..."

    @State private var isPickerPresented = false

    private var selectedBinder: Collection? {
        guard let selectedBinderId else { return nil }
        return binders.first { $0.id == selectedBinderId }
    }

    var body: some View {
        Button {
            isPickerPresented = true
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .fill(Color.fromHex(selectedBinder?.colorHex))
                    .frame(width: 14, height: 14)
                Text(selectedBinder?.name ?? placeholder)
                    .foregroundStyle(selectedBinderId == nil ? .secondary : .primary)
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Binder")
        .accessibilityValue(selectedBinder?.name ?? "None selected")
        .accessibilityHint("Shows binder choices")
        .sheet(isPresented: $isPickerPresented) {
            BinderSelectionSheet(
                binders: binders,
                selectedBinderId: $selectedBinderId
            )
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
    }
}

private struct BinderSelectionSheet: View {
    @Environment(\.dismiss) private var dismiss

    let binders: [Collection]
    @Binding var selectedBinderId: String?

    var body: some View {
        NavigationStack {
            List(binders) { binder in
                Button {
                    selectedBinderId = binder.id
                    dismiss()
                } label: {
                    HStack(spacing: 12) {
                        Circle()
                            .fill(Color.fromHex(binder.colorHex))
                            .frame(width: 14, height: 14)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(binder.name)
                                .foregroundStyle(.primary)

                            if let description = binder.description,
                               !description.isEmpty {
                                Text(description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        if selectedBinderId == binder.id {
                            Image(systemName: "checkmark")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(.tint)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(binder.name)
                .accessibilityValue(selectedBinderId == binder.id ? "Selected" : "")
            }
            .navigationTitle("Choose Binder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
        }
    }
}

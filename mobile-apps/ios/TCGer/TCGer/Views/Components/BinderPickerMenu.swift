import SwiftUI

/// The one binder-selection dropdown: each row shows the binder's color dot,
/// name, and optional description; the label shows the current selection.
/// Shared by the add-card and move-card sheets (previously byte-identical
/// copies in each).
struct BinderPickerMenu: View {
    let binders: [Collection]
    @Binding var selectedBinderId: String?
    var placeholder = "Select a binder..."

    private var selectedBinder: Collection? {
        guard let selectedBinderId else { return nil }
        return binders.first { $0.id == selectedBinderId }
    }

    var body: some View {
        Menu {
            ForEach(binders) { binder in
                Button {
                    selectedBinderId = binder.id
                } label: {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(Color.fromHex(binder.colorHex))
                            .frame(width: 14, height: 14)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(binder.name)
                            if let description = binder.description, !description.isEmpty {
                                Text(description)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        } label: {
            HStack(spacing: 10) {
                Circle()
                    .fill(Color.fromHex(selectedBinder?.colorHex))
                    .frame(width: 14, height: 14)
                Text(selectedBinder?.name ?? placeholder)
                    .foregroundColor(selectedBinderId == nil ? .secondary : .primary)
                Spacer()
                Image(systemName: "chevron.down")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color(.systemGray6))
            )
        }
    }
}

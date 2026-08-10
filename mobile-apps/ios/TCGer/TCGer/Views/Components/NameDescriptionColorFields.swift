import SwiftUI

/// Form sections for naming an item, describing it, and picking its color —
/// the shape shared by the binder and wishlist create sheets.
struct NameDescriptionColorSections: View {
    let namePlaceholder: String
    @Binding var name: String
    @Binding var description: String
    @Binding var selectedColor: Color

    var body: some View {
        Section {
            TextField(namePlaceholder, text: $name)
        } header: {
            Text("Name")
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
            Text("Color")
        }
    }
}

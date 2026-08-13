import SwiftUI

struct BinderPresentationInput: Sendable {
    let containerType: String?
    let imageUrl: String?
    let associatedTcg: String?
    let associatedSetCode: String?
    let associatedSetName: String?
}

struct BinderPresentationFields: View {
    @Binding var containerType: String
    @Binding var imageUrl: String

    var body: some View {
        Section {
            TextField("Container type (optional)", text: $containerType)
                .textInputAutocapitalization(.words)

            TextField("Cover image URL (optional)", text: $imageUrl)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        } header: {
            Text("Binder details")
        } footer: {
            Text("These optional details help identify the physical binder and its cover.")
        }
    }
}

extension BinderPresentationInput {
    static func from(
        containerType: String,
        imageUrl: String
    ) -> Self {
        func value(_ text: String) -> String? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }

        return Self(
            containerType: value(containerType),
            imageUrl: value(imageUrl),
            associatedTcg: nil,
            associatedSetCode: nil,
            associatedSetName: nil
        )
    }
}

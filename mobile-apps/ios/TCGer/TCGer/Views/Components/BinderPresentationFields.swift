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
    @Binding var associatedTcg: String
    @Binding var associatedSetCode: String
    @Binding var associatedSetName: String

    var body: some View {
        Section {
            TextField("Container type (optional)", text: $containerType)
                .textInputAutocapitalization(.words)

            TextField("Cover image URL (optional)", text: $imageUrl)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            Picker("Game", selection: $associatedTcg) {
                Text("Any game").tag("")
                ForEach(TCGGame.allCases.filter { $0 != .all }) { game in
                    Text(game.displayName).tag(game.rawValue)
                }
            }

            TextField("Set code (optional)", text: $associatedSetCode)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
            TextField("Set name (optional)", text: $associatedSetName)
        } header: {
            Text("Binder details")
        } footer: {
            Text("These details help distinguish binders, boxes, and set-specific collections.")
        }
    }
}

extension BinderPresentationInput {
    static func from(
        containerType: String,
        imageUrl: String,
        associatedTcg: String,
        associatedSetCode: String,
        associatedSetName: String
    ) -> Self {
        func value(_ text: String) -> String? {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }

        return Self(
            containerType: value(containerType),
            imageUrl: value(imageUrl),
            associatedTcg: value(associatedTcg),
            associatedSetCode: value(associatedSetCode),
            associatedSetName: value(associatedSetName)
        )
    }
}

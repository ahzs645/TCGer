import SwiftUI

/// The one condition picker. Binds to the stored string so callers keep their
/// existing state, but every option comes from `CardCondition`, guaranteeing
/// canonical casing no matter which screen sets the value.
struct ConditionPicker: View {
    @Binding var selection: String
    var includeUnspecified = false

    var body: some View {
        Picker("Condition", selection: $selection) {
            if includeUnspecified {
                Text("Unspecified").tag("")
            }
            ForEach(CardCondition.allCases) { condition in
                Text(condition.rawValue).tag(condition.rawValue)
            }
        }
    }
}

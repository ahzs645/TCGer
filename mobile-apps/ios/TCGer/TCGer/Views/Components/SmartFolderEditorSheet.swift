import SwiftUI

struct SmartFolderEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var selectedColor: Color
    @State private var matchMode: SmartFolder.MatchMode
    @State private var rules: [SmartFolderRule]

    let existingFolder: SmartFolder?
    let onSave: (SmartFolder) -> Void

    init(folder: SmartFolder? = nil, onSave: @escaping (SmartFolder) -> Void) {
        self.existingFolder = folder
        self.onSave = onSave
        _name = State(initialValue: folder?.name ?? "")
        _selectedColor = State(initialValue: Color.fromHex(folder?.colorHex))
        _matchMode = State(initialValue: folder?.matchMode ?? .all)
        _rules = State(initialValue: folder?.rules ?? [])
    }

    private let conditions = ["Mint", "Near Mint", "Excellent", "Good", "Light Played", "Played", "Poor"]

    var body: some View {
        NavigationView {
            Form {
                Section {
                    TextField("Folder Name", text: $name)
                } header: {
                    Text("Name")
                }

                Section {
                    ColorPickerGrid(selectedColor: $selectedColor)
                } header: {
                    Text("Color")
                }

                Section {
                    Picker("Match Mode", selection: $matchMode) {
                        ForEach(SmartFolder.MatchMode.allCases, id: \.self) { mode in
                            Text(mode.rawValue).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Match")
                } footer: {
                    Text(matchMode == .all ? "Card must match ALL rules" : "Card must match ANY rule")
                        .font(.caption)
                }

                Section {
                    ForEach(rules) { rule in
                        RuleRow(rule: rule)
                    }
                    .onDelete { indexSet in
                        rules.remove(atOffsets: indexSet)
                    }

                    Menu {
                        ForEach(SmartFolderRule.RuleType.allCases, id: \.self) { type in
                            Button {
                                addRule(type: type)
                            } label: {
                                Label(type.rawValue, systemImage: type.systemImage)
                            }
                        }
                    } label: {
                        Label("Add Rule", systemImage: "plus.circle")
                    }
                } header: {
                    Text("Rules (\(rules.count))")
                }
            }
            .navigationTitle(existingFolder == nil ? "New Smart Folder" : "Edit Smart Folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        let folder = SmartFolder(
                            id: existingFolder?.id ?? UUID(),
                            name: name,
                            colorHex: selectedColor.toHex(),
                            rules: rules,
                            matchMode: matchMode
                        )
                        onSave(folder)
                        dismiss()
                    }
                    .disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || rules.isEmpty)
                }
            }
        }
    }

    private func addRule(type: SmartFolderRule.RuleType) {
        let defaultValue: String
        switch type {
        case .tcg: defaultValue = "pokemon"
        case .rarity: defaultValue = "Rare"
        case .condition: defaultValue = "Near Mint"
        case .setCode: defaultValue = ""
        case .isFoil: defaultValue = "true"
        }
        rules.append(SmartFolderRule(id: UUID(), type: type, value: defaultValue))
    }
}

private struct RuleRow: View {
    let rule: SmartFolderRule

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: rule.type.systemImage)
                .foregroundColor(.accentColor)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 2) {
                Text(rule.type.rawValue)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(displayValue)
                    .font(.subheadline)
                    .fontWeight(.medium)
            }
        }
    }

    private var displayValue: String {
        switch rule.type {
        case .tcg:
            switch rule.value.lowercased() {
            case "pokemon": return "Pokemon"
            case "magic": return "Magic: The Gathering"
            case "yugioh": return "Yu-Gi-Oh!"
            default: return rule.value
            }
        case .isFoil: return "Foil cards only"
        default: return rule.value.isEmpty ? "(not set)" : rule.value
        }
    }
}

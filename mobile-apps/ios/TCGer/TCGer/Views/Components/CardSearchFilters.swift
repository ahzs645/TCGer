import SwiftUI

struct CardSearchFilterState: Equatable {
    var set: TcgSet?
    var rarity: String?
    var collectorNumber = ""
    var primaryFacet: String?
    var secondaryFacet: String?

    var activeCount: Int {
        [
            set == nil,
            rarity == nil,
            collectorNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            primaryFacet == nil,
            secondaryFacet == nil
        ]
            .filter { !$0 }
            .count
    }

    var isActive: Bool { activeCount > 0 }

    var hasDetailFilters: Bool {
        !collectorNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
            rarity != nil || primaryFacet != nil || secondaryFacet != nil
    }

    var summary: String {
        [
            set?.name,
            collectorNumber.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : "#\(collectorNumber)",
            rarity,
            primaryFacet,
            secondaryFacet
        ]
            .compactMap { $0 }
            .joined(separator: " • ")
    }

    func matches(_ card: Card, game: TCGGame) -> Bool {
        if let set,
           (card.tcg.caseInsensitiveCompare(set.tcg) != .orderedSame ||
            card.setCode?.caseInsensitiveCompare(set.code) != .orderedSame) {
            return false
        }

        if let rarity, card.rarity?.caseInsensitiveCompare(rarity) != .orderedSame {
            return false
        }

        let number = collectorNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        if !number.isEmpty,
           card.collectorNumber?.localizedCaseInsensitiveContains(number) != true {
            return false
        }

        let primaryKind = CardSearchFacetKind.primary(for: game)
        if let primaryFacet,
           !primaryKind.values(for: card).contains(where: {
               $0.caseInsensitiveCompare(primaryFacet) == .orderedSame
           }) {
            return false
        }

        if let secondaryFacet,
           let secondaryKind = CardSearchFacetKind.secondary(for: game),
           !secondaryKind.values(for: card).contains(where: {
               $0.caseInsensitiveCompare(secondaryFacet) == .orderedSame
           }) {
            return false
        }

        return true
    }

    mutating func clearIncompatibleValues(for game: TCGGame) {
        if game != .all, let set, set.tcg.caseInsensitiveCompare(game.rawValue) != .orderedSame {
            self.set = nil
        }
        primaryFacet = nil
        secondaryFacet = nil
    }
}

struct CardSearchFilterBar: View {
    let filters: CardSearchFilterState
    let onOpen: () -> Void
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onOpen) {
                HStack(spacing: 6) {
                    Image(systemName: filters.isActive
                          ? "line.3.horizontal.decrease.circle.fill"
                          : "line.3.horizontal.decrease.circle")
                    Text("Filters")
                    if filters.activeCount > 0 {
                        Text("\(filters.activeCount)")
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .frame(minWidth: 18, minHeight: 18)
                            .background(Color.accentColor, in: Circle())
                    }
                }
            }
            .buttonStyle(.bordered)

            if filters.isActive {
                Text(filters.summary)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text("Set, rarity, and card type")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if filters.isActive {
                Button("Clear", action: onClear)
                    .font(.footnote.weight(.semibold))
            }
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(.systemBackground))
    }
}

struct CardSearchFilterSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let resultCards: [Card]
    let onApply: (TCGGame, CardSearchFilterState) -> Void

    @State private var draftGame: TCGGame
    @State private var draftFilters: CardSearchFilterState
    @State private var sets: [TcgSet] = []
    @State private var isLoadingSets = true
    @State private var setErrorMessage: String?

    private let apiService = APIService()

    init(
        game: TCGGame,
        filters: CardSearchFilterState,
        resultCards: [Card],
        onApply: @escaping (TCGGame, CardSearchFilterState) -> Void
    ) {
        self.resultCards = resultCards
        self.onApply = onApply
        _draftGame = State(initialValue: game)
        _draftFilters = State(initialValue: filters)
    }

    private var availableSets: [TcgSet] {
        let enabledGames = Set(environmentStore.enabledGames.map(\.rawValue))
        return sets
            .filter { set in
                enabledGames.contains(set.tcg.lowercased()) &&
                (draftGame == .all || set.tcg.caseInsensitiveCompare(draftGame.rawValue) == .orderedSame)
            }
            .sorted {
                if ($0.releaseDate ?? "") != ($1.releaseDate ?? "") {
                    return ($0.releaseDate ?? "") > ($1.releaseDate ?? "")
                }
                return $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
    }

    private var facetCards: [Card] {
        resultCards.filter { card in
            guard draftGame == .all || card.tcg.caseInsensitiveCompare(draftGame.rawValue) == .orderedSame else {
                return false
            }
            guard let set = draftFilters.set else { return true }
            return card.tcg.caseInsensitiveCompare(set.tcg) == .orderedSame &&
                card.setCode?.caseInsensitiveCompare(set.code) == .orderedSame
        }
    }

    private var rarityOptions: [String] {
        sortedOptions(facetCards.compactMap(\.rarity))
    }

    private var effectiveGame: TCGGame {
        guard draftGame == .all,
              let setGame = draftFilters.set.flatMap({ TCGGame(rawValue: $0.tcg.lowercased()) }) else {
            return draftGame
        }
        return setGame
    }

    private var primaryKind: CardSearchFacetKind {
        CardSearchFacetKind.primary(for: effectiveGame)
    }

    private var primaryOptions: [String] {
        sortedOptions(facetCards.flatMap { primaryKind.values(for: $0) })
    }

    private var secondaryKind: CardSearchFacetKind? {
        CardSearchFacetKind.secondary(for: effectiveGame)
    }

    private var secondaryOptions: [String] {
        guard let secondaryKind else { return [] }
        return sortedOptions(facetCards.flatMap { secondaryKind.values(for: $0) })
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Game") {
                    Picker("Game", selection: $draftGame) {
                        ForEach(environmentStore.gamePickerGames) { game in
                            Label(game.shortName, systemImage: game.systemIconName)
                                .tag(game)
                        }
                    }
                }

                Section {
                    if isLoadingSets {
                        HStack {
                            ProgressView()
                            Text("Loading sets…")
                                .foregroundStyle(.secondary)
                        }
                    } else if let setErrorMessage {
                        VStack(alignment: .leading, spacing: 8) {
                            Text(setErrorMessage)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                            Button("Retry") {
                                Task { await loadSets() }
                            }
                        }
                    } else {
                        NavigationLink {
                            CardSearchSetPicker(
                                sets: availableSets,
                                selection: $draftFilters.set
                            )
                        } label: {
                            LabeledContent("Set") {
                                Text(draftFilters.set?.name ?? "Any Set")
                                    .foregroundStyle(draftFilters.set == nil ? .secondary : .primary)
                                    .lineLimit(1)
                            }
                        }
                    }
                } header: {
                    Text("Set")
                } footer: {
                    Text("Choose a set to search its complete card list.")
                }

                Section {
                    TextField("Card Number", text: $draftFilters.collectorNumber)
                        .textInputAutocapitalization(.characters)

                    if !rarityOptions.isEmpty {
                        optionalPicker(
                            title: "Rarity",
                            anyTitle: "Any Rarity",
                            selection: $draftFilters.rarity,
                            options: rarityOptions
                        )
                    }

                    if !primaryOptions.isEmpty {
                        optionalPicker(
                            title: primaryKind.title,
                            anyTitle: "Any \(primaryKind.title)",
                            selection: $draftFilters.primaryFacet,
                            options: primaryOptions
                        )
                    }

                    if let secondaryKind, !secondaryOptions.isEmpty {
                        optionalPicker(
                            title: secondaryKind.title,
                            anyTitle: "Any \(secondaryKind.title)",
                            selection: $draftFilters.secondaryFacet,
                            options: secondaryOptions
                        )
                    }
                } header: {
                    Text("Card Details")
                } footer: {
                    if resultCards.isEmpty {
                        Text("Search once to populate rarity and game-specific choices. Card number can be used immediately.")
                    } else if rarityOptions.isEmpty && primaryOptions.isEmpty && secondaryOptions.isEmpty {
                        Text("This catalog does not include additional card metadata. Set and card number filters are still available.")
                    }
                }
            }
            .navigationTitle("Search Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topBarLeading) {
                    Button("Reset") {
                        draftFilters = CardSearchFilterState()
                    }
                    .disabled(!draftFilters.isActive)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        onApply(draftGame, draftFilters)
                        dismiss()
                    }
                    .fontWeight(.semibold)
                }
            }
            .task {
                await loadSets()
            }
            .onChange(of: draftGame) {
                draftFilters.clearIncompatibleValues(for: draftGame)
            }
            .onChange(of: draftFilters.set) {
                if draftGame == .all,
                   let setGame = draftFilters.set.flatMap({ TCGGame(rawValue: $0.tcg.lowercased()) }) {
                    draftGame = setGame
                }
                draftFilters.rarity = nil
                draftFilters.collectorNumber = ""
                draftFilters.primaryFacet = nil
                draftFilters.secondaryFacet = nil
            }
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
    }

    @ViewBuilder
    private func optionalPicker(
        title: String,
        anyTitle: String,
        selection: Binding<String?>,
        options: [String]
    ) -> some View {
        Picker(title, selection: selection) {
            Text(anyTitle).tag(String?.none)
            ForEach(options, id: \.self) { option in
                Text(option).tag(String?.some(option))
            }
        }
        .disabled(options.isEmpty)
    }

    private func sortedOptions(_ values: [String]) -> [String] {
        Array(Set(values.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }))
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    @MainActor
    private func loadSets() async {
        guard let token = environmentStore.authToken else {
            setErrorMessage = "Sign in to load sets."
            isLoadingSets = false
            return
        }

        isLoadingSets = true
        setErrorMessage = nil
        do {
            sets = try await apiService.getSets(
                config: environmentStore.serverConfiguration,
                token: token
            )
        } catch {
            setErrorMessage = error.localizedDescription
        }
        isLoadingSets = false
    }
}

private struct CardSearchSetPicker: View {
    @Environment(\.dismiss) private var dismiss
    let sets: [TcgSet]
    @Binding var selection: TcgSet?
    @State private var searchText = ""

    private var filteredSets: [TcgSet] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return sets }
        return sets.filter {
            $0.name.localizedCaseInsensitiveContains(query) ||
                $0.code.localizedCaseInsensitiveContains(query) ||
                $0.tcgDisplayName.localizedCaseInsensitiveContains(query)
        }
    }

    private var groupedSets: [(String, [TcgSet])] {
        Dictionary(grouping: filteredSets, by: \.tcg)
            .sorted { $0.key.localizedCaseInsensitiveCompare($1.key) == .orderedAscending }
    }

    var body: some View {
        List {
            Section {
                Button {
                    selection = nil
                    dismiss()
                } label: {
                    selectionRow(title: "Any Set", subtitle: "All expansions", isSelected: selection == nil)
                }
            }

            ForEach(groupedSets, id: \.0) { tcg, gameSets in
                Section(TCGGame(rawValue: tcg)?.displayName ?? tcg.capitalized) {
                    ForEach(gameSets) { set in
                        Button {
                            selection = set
                            dismiss()
                        } label: {
                            selectionRow(
                                title: set.name,
                                subtitle: set.code.uppercased(),
                                isSelected: selection?.id == set.id
                            )
                        }
                    }
                }
            }
        }
        .navigationTitle("Set")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search sets or codes")
        .overlay {
            if filteredSets.isEmpty {
                ContentUnavailableView.search(text: searchText)
            }
        }
    }

    private func selectionRow(title: String, subtitle: String, isSelected: Bool) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .foregroundStyle(.primary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if isSelected {
                Image(systemName: "checkmark")
                    .fontWeight(.semibold)
            }
        }
        .contentShape(Rectangle())
    }
}

enum CardSearchFacetKind: String {
    case category
    case cardType
    case energyType
    case color
    case attribute
    case ink
    case monsterType

    var title: String {
        switch self {
        case .category: return "Category"
        case .cardType: return "Card Type"
        case .energyType: return "Energy Type"
        case .color: return "Color"
        case .attribute: return "Attribute"
        case .ink: return "Ink"
        case .monsterType: return "Monster Type"
        }
    }

    static func primary(for game: TCGGame) -> CardSearchFacetKind {
        game == .pokemon ? .category : .cardType
    }

    static func secondary(for game: TCGGame) -> CardSearchFacetKind? {
        switch game {
        case .pokemon: return .energyType
        case .magic, .onepiece, .dragonball: return .color
        case .yugioh: return .monsterType
        case .lorcana: return .ink
        case .all: return nil
        }
    }

    func values(for card: Card) -> [String] {
        switch self {
        case .category:
            return [card.supertype, card.pokemonPrint?.category].compactMap { $0 }
        case .cardType:
            return cardTypeValues(for: card)
        case .energyType:
            return card.types ?? card.attributeStrings(for: "types")
        case .color:
            return colorValues(for: card)
        case .attribute:
            return card.attributeStrings(for: "attribute")
        case .ink:
            return card.attributeStrings(for: "ink")
        case .monsterType:
            return card.attributeStrings(for: "race")
        }
    }

    private func cardTypeValues(for card: Card) -> [String] {
        switch TCGGame(rawValue: card.tcg.lowercased()) {
        case .pokemon:
            return [card.supertype, card.pokemonPrint?.category].compactMap { $0 }
        case .magic:
            guard let typeLine = card.attributeStrings(for: "type_line").first else { return [] }
            let mainType = typeLine.components(separatedBy: "—").first ?? typeLine
            let knownTypes = [
                "Artifact", "Battle", "Creature", "Enchantment", "Instant",
                "Land", "Planeswalker", "Sorcery"
            ]
            let matches = knownTypes.filter { mainType.localizedCaseInsensitiveContains($0) }
            return matches.isEmpty ? [mainType.trimmingCharacters(in: .whitespaces)] : matches
        case .yugioh, .onepiece, .lorcana, .dragonball:
            return card.attributeStrings(for: "type")
        case .all, .none:
            return [card.supertype].compactMap { $0 }
        }
    }

    private func colorValues(for card: Card) -> [String] {
        let values = card.attributeStrings(for: "colors") + card.attributeStrings(for: "color")
        let magicColors = [
            "W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green"
        ]
        return values.map { magicColors[$0.uppercased()] ?? $0 }
    }
}

private extension Card {
    func attributeStrings(for key: String) -> [String] {
        guard let value = attributes?[key] else { return [] }
        switch value {
        case .string(let string):
            return [string]
        case .number(let number):
            return [number.formatted()]
        case .array(let values):
            return values.compactMap {
                if case .string(let string) = $0 { return string }
                return nil
            }
        case .bool, .object, .null:
            return []
        }
    }
}

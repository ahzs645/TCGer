import SwiftUI

/// Sort orders for the cards inside a binder.
enum CardSortOption: String, CaseIterable {
    case name = "Name"
    case number = "Card Number"
    case rarity = "Rarity"

    var systemImage: String {
        switch self {
        case .name: return "textformat.abc"
        case .number: return "number"
        case .rarity: return "sparkles"
        }
    }
}

/// The binder search and filter bar: one compact row for search and the filter
/// toggle, plus a scrollable row of uniform filter chips when expanded. Owns
/// filter selection state via bindings; the parent supplies the available
/// options and the clear-all action.
struct CollectionFilterBar: View {
    private let filterChipHeight: CGFloat = 30

    @Binding var searchText: String
    @Binding var showFilters: Bool
    @Binding var sortOption: CardSortOption
    @Binding var selectedTagFilters: Set<String>
    @Binding var selectedConditionFilters: Set<String>
    @Binding var minPriceFilter: String
    @Binding var maxPriceFilter: String
    @Binding var selectedGameFilter: TCGGame
    @Binding var gameFacetSelections: [TCGGame: [String: CollectionFacetSelection]]
    let tagOptions: [CollectionCardTag]
    let conditionOptions: [String]
    let availableGames: [TCGGame]
    let cards: [CollectionCard]
    let hasActiveFilters: Bool
    let onClearAll: () -> Void

    /// Search text is intentionally excluded — the search bar already shows
    /// it, so counting it here reads as a phantom filter.
    private var activeFilterCount: Int {
        var count = 0
        if !selectedTagFilters.isEmpty { count += 1 }
        if !selectedConditionFilters.isEmpty { count += 1 }
        if !minPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { count += 1 }
        if !maxPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { count += 1 }
        if selectedGameFilter != .all { count += 1 }
        count += currentFacetSelections.values.filter(\.isActive).count
        return count
    }

    private var effectiveGame: TCGGame? {
        if selectedGameFilter != .all { return selectedGameFilter }
        return availableGames.count == 1 ? availableGames.first : nil
    }

    private var gameDefinition: GameCollectionDefinition? {
        GameCollectionDefinitions.definition(for: effectiveGame)
    }

    private var currentFacetSelections: [String: CollectionFacetSelection] {
        guard let effectiveGame else { return [:] }
        return gameFacetSelections[effectiveGame] ?? [:]
    }

    private var hasPriceFilter: Bool {
        !minPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        !maxPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                searchField

                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showFilters.toggle()
                    }
                } label: {
                    AppFilterMenuLabel(
                        kind: .filter,
                        isActive: showFilters || hasActiveFilters,
                        activeCount: activeFilterCount
                    )
                    .font(.title3)
                }
                .buttonStyle(.plain)
                .frame(width: 38, height: 38)
                .contentShape(Rectangle())
                .accessibilityLabel(showFilters ? "Hide filters" : "Show filters")
                .accessibilityValue(activeFilterCount > 0 ? "\(activeFilterCount) active" : "No active filters")
            }

            if showFilters {
                HStack {
                    Text("Filters")
                        .font(.subheadline.weight(.semibold))

                    Spacer()

                    if hasActiveFilters {
                        Button("Clear All") {
                            onClearAll()
                        }
                        .font(.caption.weight(.semibold))
                    }
                }

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        sortMenu
                        gameFilterMenu
                        tagFilterMenu
                        conditionFilterMenu
                        priceFilterFields
                        if let definition = gameDefinition {
                            ForEach(definition.facets) { facet in
                                gameFacetControl(facet, game: definition.game)
                            }
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)

            TextField("Search cards, sets, or codes", text: $searchText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear search")
            }
        }
        .padding(.horizontal, 12)
        .frame(height: 38)
        .background(Color(.secondarySystemBackground), in: Capsule())
    }

    private var sortMenu: some View {
        Menu {
            ForEach(CardSortOption.allCases, id: \.self) { option in
                Button {
                    sortOption = option
                } label: {
                    Label(option.rawValue, systemImage: option.systemImage)
                    if sortOption == option {
                        Image(systemName: "checkmark")
                    }
                }
            }
        } label: {
            filterChipLabel(text: sortOption.rawValue, icon: "arrow.up.arrow.down")
        }
    }

    private var tagFilterMenu: some View {
        Menu {
            if tagOptions.isEmpty {
                Text("No tags in this binder")
            } else {
                ForEach(tagOptions) { tag in
                    Button {
                        toggleTagFilter(tag.id)
                    } label: {
                        Label(
                            tag.label,
                            systemImage: selectedTagFilters.contains(tag.id)
                                ? "checkmark.circle.fill"
                                : "circle"
                        )
                    }
                }
            }
            if !selectedTagFilters.isEmpty {
                Divider()
                Button("Clear Tag Filters") {
                    selectedTagFilters.removeAll()
                }
            }
        } label: {
            filterChipLabel(text: "Tags", icon: "tag", activeCount: selectedTagFilters.count)
        }
    }

    private var gameFilterMenu: some View {
        Menu {
            if availableGames.count > 1 {
                Button {
                    selectedGameFilter = .all
                } label: {
                    Label("All Games", systemImage: selectedGameFilter == .all ? "checkmark.circle.fill" : "circle")
                }
            }
            ForEach(availableGames) { game in
                Button {
                    selectedGameFilter = game
                } label: {
                    Label(game.displayName, systemImage: selectedGameFilter == game ? "checkmark.circle.fill" : "circle")
                }
            }
        } label: {
            filterChipLabel(
                text: selectedGameFilter == .all ? (effectiveGame?.shortName ?? "Games") : selectedGameFilter.shortName,
                icon: "rectangle.stack",
                activeCount: selectedGameFilter == .all ? 0 : 1
            )
        }
    }

    @ViewBuilder
    private func gameFacetControl(_ facet: CollectionFacetDefinition, game: TCGGame) -> some View {
        switch facet.kind {
        case .options:
            let selected = optionSelection(facet.id, game: game)
            let options = CollectionFacetEngine.options(
                for: facet,
                cards: cards.filter { $0.tcg.lowercased() == game.rawValue }
            )
            Menu {
                if options.isEmpty {
                    Text("No values in this binder")
                } else {
                    ForEach(options, id: \.self) { option in
                        Button {
                            toggleFacetOption(option, facetID: facet.id, game: game)
                        } label: {
                            Label(option, systemImage: selected.contains(option.uppercased()) ? "checkmark.circle.fill" : "circle")
                        }
                    }
                }
                if !selected.isEmpty {
                    Divider()
                    Button("Clear \(facet.label)") {
                        updateFacet(.options([]), facetID: facet.id, game: game)
                    }
                }
            } label: {
                filterChipLabel(text: facet.label, icon: "line.3.horizontal.decrease", activeCount: selected.count)
            }
        case .text:
            HStack(spacing: 6) {
                Text(facet.label)
                    .foregroundStyle(.secondary)
                TextField(facet.label, text: textBinding(facet.id, game: game))
                    .textFieldStyle(.plain)
                    .frame(width: 92)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .frame(height: filterChipHeight)
            .background(currentFacetSelections[facet.id]?.isActive == true ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground))
            .clipShape(Capsule())
        case .numberRange:
            let range = rangeSelection(facet.id, game: game)
            HStack(spacing: 5) {
                Text(facet.label)
                    .foregroundStyle(.secondary)
                TextField("Min", text: rangeBinding(facet.id, game: game, minimum: true))
                    .keyboardType(.numbersAndPunctuation)
                    .textFieldStyle(.plain)
                    .frame(width: 42)
                Text("–").foregroundStyle(.secondary)
                TextField("Max", text: rangeBinding(facet.id, game: game, minimum: false))
                    .keyboardType(.numbersAndPunctuation)
                    .textFieldStyle(.plain)
                    .frame(width: 42)
            }
            .font(.caption.weight(.medium))
            .padding(.horizontal, 10)
            .frame(height: filterChipHeight)
            .background(range.isActive ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground))
            .clipShape(Capsule())
        }
    }

    private var conditionFilterMenu: some View {
        Menu {
            if conditionOptions.isEmpty {
                Text("No conditions in this binder")
            } else {
                ForEach(conditionOptions, id: \.self) { option in
                    Button {
                        toggleConditionFilter(option)
                    } label: {
                        Label(
                            option,
                            systemImage: selectedConditionFilters.contains(option)
                                ? "checkmark.circle.fill"
                                : "circle"
                        )
                    }
                }
            }
            if !selectedConditionFilters.isEmpty {
                Divider()
                Button("Clear Condition Filters") {
                    selectedConditionFilters.removeAll()
                }
            }
        } label: {
            filterChipLabel(text: "Condition", icon: "checkmark.seal", activeCount: selectedConditionFilters.count)
        }
    }

    private var priceFilterFields: some View {
        HStack(spacing: 6) {
            Image(systemName: "dollarsign.circle")
                .font(.caption)
            TextField("Min", text: $minPriceFilter)
                .keyboardType(.decimalPad)
                .textFieldStyle(.plain)
                .frame(width: 44)
            Text("–")
                .foregroundColor(.secondary)
            TextField("Max", text: $maxPriceFilter)
                .keyboardType(.decimalPad)
                .textFieldStyle(.plain)
                .frame(width: 44)
        }
        .font(.caption)
        .fontWeight(.medium)
        .padding(.horizontal, 10)
        .frame(height: filterChipHeight)
        .background(hasPriceFilter ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground))
        .clipShape(Capsule())
    }

    private func filterChipLabel(text: String, icon: String, activeCount: Int = 0) -> some View {
        HStack(spacing: 5) {
            Image(systemName: icon)
            Text(text)
                .lineLimit(1)
                .fixedSize()
            if activeCount > 0 {
                Text("\(activeCount)")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(Color.accentColor)
                    .clipShape(Capsule())
            }
            Image(systemName: "chevron.down")
                .font(.caption2)
                .foregroundColor(.secondary)
        }
        .font(.caption)
        .fontWeight(.medium)
        .foregroundColor(activeCount > 0 ? .accentColor : .primary)
        .padding(.horizontal, 10)
        .frame(height: filterChipHeight)
        .background(activeCount > 0 ? Color.accentColor.opacity(0.15) : Color(.secondarySystemBackground))
        .clipShape(Capsule())
    }

    private func toggleTagFilter(_ tagId: String) {
        if selectedTagFilters.contains(tagId) {
            selectedTagFilters.remove(tagId)
        } else {
            selectedTagFilters.insert(tagId)
        }
    }

    private func toggleConditionFilter(_ condition: String) {
        if selectedConditionFilters.contains(condition) {
            selectedConditionFilters.remove(condition)
        } else {
            selectedConditionFilters.insert(condition)
        }
    }

    private func optionSelection(_ facetID: String, game: TCGGame) -> Set<String> {
        guard case .options(let values) = gameFacetSelections[game]?[facetID] else { return [] }
        return Set(values.map { $0.uppercased() })
    }

    private func rangeSelection(_ facetID: String, game: TCGGame) -> CollectionFacetSelection {
        guard case .range = gameFacetSelections[game]?[facetID] else {
            return .range(minimum: "", maximum: "")
        }
        return gameFacetSelections[game]![facetID]!
    }

    private func toggleFacetOption(_ option: String, facetID: String, game: TCGGame) {
        var selected = optionSelection(facetID, game: game)
        let normalized = option.uppercased()
        if selected.contains(normalized) { selected.remove(normalized) } else { selected.insert(normalized) }
        updateFacet(.options(selected), facetID: facetID, game: game)
    }

    private func updateFacet(_ selection: CollectionFacetSelection, facetID: String, game: TCGGame) {
        var gameSelections = gameFacetSelections[game] ?? [:]
        gameSelections[facetID] = selection
        gameFacetSelections[game] = gameSelections
    }

    private func textBinding(_ facetID: String, game: TCGGame) -> Binding<String> {
        Binding(
            get: {
                guard case .text(let value) = gameFacetSelections[game]?[facetID] else { return "" }
                return value
            },
            set: { updateFacet(.text($0), facetID: facetID, game: game) }
        )
    }

    private func rangeBinding(_ facetID: String, game: TCGGame, minimum: Bool) -> Binding<String> {
        Binding(
            get: {
                guard case .range(let lower, let upper) = gameFacetSelections[game]?[facetID] else { return "" }
                return minimum ? lower : upper
            },
            set: { value in
                let current = rangeSelection(facetID, game: game)
                guard case .range(let lower, let upper) = current else { return }
                updateFacet(
                    .range(minimum: minimum ? value : lower, maximum: minimum ? upper : value),
                    facetID: facetID,
                    game: game
                )
            }
        )
    }
}

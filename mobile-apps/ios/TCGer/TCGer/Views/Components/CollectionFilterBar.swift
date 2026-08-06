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

/// The binder filter bar: a toggle header plus one scrollable row of uniform
/// capsule chips (sort, tags, condition, price range). Owns filter selection
/// state via bindings; the parent supplies the available options and the
/// clear-all action (which may also reset state the bar doesn't own, e.g.
/// search text).
struct CollectionFilterBar: View {
    @Binding var showFilters: Bool
    @Binding var sortOption: CardSortOption
    @Binding var selectedTagFilters: Set<String>
    @Binding var selectedConditionFilters: Set<String>
    @Binding var minPriceFilter: String
    @Binding var maxPriceFilter: String
    let tagOptions: [CollectionCardTag]
    let conditionOptions: [String]
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
        return count
    }

    private var hasPriceFilter: Bool {
        !minPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
        !maxPriceFilter.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) {
                        showFilters.toggle()
                    }
                } label: {
                    Image(systemName: showFilters
                        ? "line.3.horizontal.decrease.circle.fill"
                        : "line.3.horizontal.decrease.circle")
                        .font(.title3)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showFilters ? "Hide filters" : "Show filters")

                if showFilters {
                    Text("Filters")
                        .font(.subheadline)
                        .fontWeight(.semibold)
                } else if activeFilterCount > 0 {
                    Text("\(activeFilterCount)")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)
                }

                Spacer()

                if showFilters, hasActiveFilters {
                    Button("Clear All") {
                        onClearAll()
                    }
                    .font(.caption.weight(.semibold))
                }
            }

            if showFilters {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        sortMenu
                        tagFilterMenu
                        conditionFilterMenu
                        priceFilterFields
                    }
                }
                // A refreshable ancestor would otherwise give this horizontal
                // strip its own vertical pull-to-refresh gesture.
                .environment(\.refresh, nil)
            }
        }
        .padding(.vertical, 4)
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
                .frame(width: 44)
            Text("–")
                .foregroundColor(.secondary)
            TextField("Max", text: $maxPriceFilter)
                .keyboardType(.decimalPad)
                .frame(width: 44)
        }
        .font(.caption)
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
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
        .padding(.vertical, 7)
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
}

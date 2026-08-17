import SwiftUI

struct CollectionCardRow: View {
    let card: CollectionCard
    let showPricing: Bool
    let showDeleteConfirmation: Bool
    let onConfirmDelete: (() -> Void)?
    let onCancelDelete: (() -> Void)?
    let isCopiesExpanded: Bool
    let onToggleCopies: (() -> Void)?
    @Environment(\.colorScheme) private var colorScheme

    init(
        card: CollectionCard,
        showPricing: Bool,
        showDeleteConfirmation: Bool = false,
        onConfirmDelete: (() -> Void)? = nil,
        onCancelDelete: (() -> Void)? = nil,
        isCopiesExpanded: Bool = false,
        onToggleCopies: (() -> Void)? = nil
    ) {
        self.card = card
        self.showPricing = showPricing
        self.showDeleteConfirmation = showDeleteConfirmation
        self.onConfirmDelete = onConfirmDelete
        self.onCancelDelete = onCancelDelete
        self.isCopiesExpanded = isCopiesExpanded
        self.onToggleCopies = onToggleCopies
    }

    private func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func normalizedCondition(_ value: String?) -> String? {
        guard let normalized = normalized(value) else { return nil }
        return normalized.uppercased()
    }

    private func uniquePreservingOrder(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }

    private func conditionSummary() -> String? {
        var values = card.copies.compactMap { normalizedCondition($0.condition) }
        if values.isEmpty, let fallback = normalizedCondition(card.condition) {
            values = [fallback]
        }
        let unique = uniquePreservingOrder(values)
        guard !unique.isEmpty else { return nil }
        let sorted = CardCondition.sorted(unique).map(CardCondition.shortCode)
        if sorted.count == 1 {
            return sorted[0]
        }
        return "\(sorted.first!) – \(sorted.last!)"
    }

    private func languageSummary() -> String? {
        var values = card.copies.compactMap { normalized($0.language) }
        if values.isEmpty, let fallback = normalized(card.language) {
            values = [fallback]
        }
        let unique = uniquePreservingOrder(values)
        guard !unique.isEmpty else { return nil }
        if unique.count == 1 {
            return unique[0]
        }
        return unique.joined(separator: ", ")
    }

    private func languageCode() -> String? {
        guard let language = languageSummary() else { return nil }
        return CardLanguage.code(for: language)
    }

    private func notesSummary() -> String? {
        var values = card.copies.compactMap { normalized($0.notes) }
        if values.isEmpty, let fallback = normalized(card.notes) {
            values = [fallback]
        }
        guard !values.isEmpty else { return nil }
        if values.count == 1 {
            return values[0]
        }
        return "Notes vary across copies"
    }

    private func aggregatedTags() -> [CollectionCardTag] {
        var seen = Set<String>()
        var tags: [CollectionCardTag] = []
        for tag in card.copies.flatMap({ $0.tags }) {
            if seen.insert(tag.id).inserted {
                tags.append(tag)
            }
        }
        return tags
    }

    private var hasAnyFoil: Bool {
        card.copies.contains { $0.isFoil == true || $0.collectibleVariant.isFoil }
    }

    private var finishLabels: [String] {
        uniquePreservingOrder(card.copies.compactMap { copy -> String? in
            let variant = copy.collectibleVariant
            guard let code = variant.finishCode else { return nil }
            return variant.finishLabel ?? PokemonFinishOption.label(for: code)
        })
    }

    /// A single unambiguous finish (Holo, Non-Holo, …) is promoted to the
    /// header next to the language chip; mixed finishes stay in the badge row.
    private var headerFinishLabel: String? {
        finishLabels.count == 1 ? finishLabels.first : nil
    }

    private var variantLabels: [String] {
        var labels = uniquePreservingOrder(card.copies.flatMap { $0.collectibleVariant.labels })
        if let headerFinishLabel {
            labels.removeAll { $0 == headerFinishLabel }
        }
        return labels
    }

    private var hasAnySigned: Bool {
        card.copies.contains { $0.isSigned == true }
    }

    private var hasAnyAltered: Bool {
        card.copies.contains { $0.isAltered == true }
    }

    private var gradingSummary: (company: String, score: String)? {
        guard card.copies.count == 1 else { return nil }
        for copy in card.copies {
            if let company = copy.gradingCompany, !company.isEmpty,
               let score = copy.gradingScore, !score.isEmpty {
                return (company, score)
            }
        }
        return nil
    }

    private var storageLocationSummary: String? {
        guard card.copies.count == 1 else { return nil }
        for copy in card.copies {
            if let loc = copy.storageLocation, !loc.isEmpty {
                return loc
            }
        }
        return nil
    }

    private var cardBackgroundColor: Color {
        colorScheme == .dark ? Color(.secondarySystemBackground) : Color(.systemGray6)
    }

    private var cardBorderColor: Color {
        colorScheme == .dark ? .white.opacity(0.08) : .black.opacity(0.06)
    }

    private var previewCardBackgroundColor: Color {
        colorScheme == .dark ? Color(.systemGray4) : Color(.systemGray5)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                CardArtworkImage(card: card.previewCard, useFullResolution: false)
                    .frame(width: 74, height: 104)
                .background(previewCardBackgroundColor)
                .cornerRadius(8)
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(Color.white.opacity(colorScheme == .dark ? 0.10 : 0.0), lineWidth: 1)
                )

                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(card.name)
                            .font(.headline)
                            .fontWeight(.semibold)

                        Spacer()

                        HStack(spacing: 6) {
                            if let finish = headerFinishLabel {
                                AttributeBadge(icon: "circle.hexagongrid", label: finish, color: .indigo)
                            }

                            if let code = languageCode() {
                                Text(code)
                                    .font(.caption2)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.blue)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 4)
                                    .background(Color.blue.opacity(colorScheme == .dark ? 0.24 : 0.12))
                                    .clipShape(Capsule())
                            }
                        }
                    }

                    if card.quantity > 1 || card.rarity != nil {
                        HStack(spacing: 8) {
                            if card.quantity > 1 {
                                Text("×\(card.quantity)")
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    .foregroundColor(.accentColor)
                            }

                            if card.quantity > 1, card.rarity != nil {
                                Text("•")
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }

                            if let rarity = card.rarity {
                                Text(rarity)
                                    .font(.caption2)
                                    .foregroundColor(.secondary)
                            }
                        }
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            GameBadge(tcg: card.tcg, showsName: true)

                            if let conditionSummary = conditionSummary() {
                                MetaTagChip(
                                    title: "Condition",
                                    value: conditionSummary,
                                    icon: "checkmark.seal",
                                    color: .orange
                                )
                            }

                            if hasAnyFoil, finishLabels.isEmpty {
                                AttributeBadge(icon: "sparkles", label: "Foil", color: .yellow)
                            }
                            ForEach(variantLabels.prefix(3), id: \.self) { label in
                                AttributeBadge(icon: "circle.hexagongrid", label: label, color: .indigo)
                            }
                            if hasAnySigned {
                                AttributeBadge(icon: "pencil.line", label: "Signed", color: .purple)
                            }
                            if hasAnyAltered {
                                AttributeBadge(icon: "paintpalette", label: "Altered", color: .pink)
                            }
                            if let grading = gradingSummary {
                                GradingBadge(company: grading.company, score: grading.score)
                            }
                            if let location = storageLocationSummary {
                                AttributeBadge(icon: "mappin.and.ellipse", label: location, color: .teal)
                            }
                        }
                    }

                    if let notesSummary = notesSummary() {
                        SummaryRow(label: "Notes", value: notesSummary, icon: "note.text")
                    }

                    let tags = aggregatedTags()
                    if !tags.isEmpty {
                        TagSummaryRow(tags: tags)
                    }

                    if showPricing, let price = card.price {
                        Text((price * Double(card.quantity)).priceText)
                            .font(.caption)
                            .fontWeight(.medium)
                            .foregroundColor(.green)
                    }
                }
            }

            if showDeleteConfirmation {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Text("This will remove all copies of \(card.name) from this binder.")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    HStack(spacing: 10) {
                        if let onCancelDelete {
                            Button("Cancel") {
                                onCancelDelete()
                            }
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.secondary)
                        }

                        if let onConfirmDelete {
                            Button("Delete \"\(card.name)\"") {
                                onConfirmDelete()
                            }
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.red)
                        }
                    }
                }
                .padding(10)
                .background(Color.red.opacity(colorScheme == .dark ? 0.20 : 0.08))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }

            if card.copies.count > 1,
               !showDeleteConfirmation,
               let onToggleCopies {
                Divider()
                Button(action: onToggleCopies) {
                    HStack {
                        Text(isCopiesExpanded ? "Hide copies" : "View \(card.copies.count) copies")
                            .fontWeight(.semibold)
                        Spacer()
                        Image(systemName: isCopiesExpanded ? "chevron.up" : "chevron.down")
                    }
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityValue(isCopiesExpanded ? "Expanded" : "Collapsed")
            }
        }
        .padding()
        .background(cardBackgroundColor)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(cardBorderColor, lineWidth: 1)
        )
        .cornerRadius(8)
        .contentShape(Rectangle())
        // Foil is suppressed only when the copies have explicit finish data
        // and none of them are foil; unknown finishes keep the rarity default.
        .cardPreviewContextMenu(
            card: card.previewCard,
            showsFoil: hasAnyFoil || finishLabels.isEmpty
        )
    }

    private struct SummaryRow: View {
        let label: String
        let value: String
        let icon: String

        var body: some View {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text("\(label):")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Text(value)
                    .font(.caption)
                    .foregroundColor(.primary)
            }
        }
    }

    private struct MetaTagChip: View {
        let title: String
        let value: String
        let icon: String
        let color: Color
        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                Text("\(title): \(value)")
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
            }
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(colorScheme == .dark ? 0.22 : 0.12))
            .clipShape(Capsule())
        }
    }

    private struct TagSummaryRow: View {
        let tags: [CollectionCardTag]

        var body: some View {
            HStack(spacing: 8) {
                Text("Tags")
                    .font(.caption)
                    .foregroundColor(.secondary)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(tags) { tag in
                            TagChip(tag: tag)
                        }
                    }
                }
            }
        }
    }

    private struct TagChip: View {
        let tag: CollectionCardTag
        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            Text(tag.label)
                .font(.caption2)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.fromHex(tag.colorHex).opacity(colorScheme == .dark ? 0.28 : 0.15))
                .foregroundColor(Color.fromHex(tag.colorHex))
                .cornerRadius(8)
        }
    }

    private struct AttributeBadge: View {
        let icon: String
        let label: String
        let color: Color
        @Environment(\.colorScheme) private var colorScheme

        var body: some View {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                Text(label)
                    .lineLimit(1)
            }
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(colorScheme == .dark ? 0.22 : 0.12))
            .clipShape(Capsule())
        }
    }

}

struct CollectionCardCopyRow: View {
    let copy: CollectionCardCopy
    let index: Int
    let total: Int
    @Environment(\.colorScheme) private var colorScheme

    private var attributeLabels: [String] {
        var labels = copy.collectibleVariant.labels
        if copy.isFoil == true && labels.isEmpty { labels.append("Foil") }
        if copy.isSigned == true { labels.append("Signed") }
        if copy.isAltered == true { labels.append("Altered") }
        return labels
    }

    private var grading: (company: String, score: String)? {
        guard let company = normalized(copy.gradingCompany),
              let score = normalized(copy.gradingScore) else { return nil }
        return (company, score)
    }

    private var storageLocation: String? {
        normalized(copy.storageLocation)
    }

    private func normalized(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
              !trimmed.isEmpty else { return nil }
        return trimmed
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "square.stack.3d.up")
                .font(.body)
                .foregroundColor(.accentColor)
                .frame(width: 24, height: 24)
                .background(Color.accentColor.opacity(colorScheme == .dark ? 0.22 : 0.12))
                .clipShape(Circle())

            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    if let title = copy.displayTitle(index: index, totalCount: total) {
                        Text(title)
                            .font(.subheadline)
                            .fontWeight(.semibold)
                    }
                    Spacer()
                    if total > 1 {
                        Text("\(index + 1) of \(total)")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }

                if let detailLine = copy.detailLine {
                    Text(detailLine)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if !attributeLabels.isEmpty || grading != nil || storageLocation != nil {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(attributeLabels, id: \.self) { label in
                                CopyAttributeBadge(label: label, color: .accentColor)
                            }

                            if let grading {
                                GradingBadge(company: grading.company, score: grading.score)
                            }

                            if let storageLocation {
                                CopyAttributeBadge(
                                    icon: "mappin.and.ellipse",
                                    label: storageLocation,
                                    color: .teal
                                )
                            }
                        }
                    }
                }

                if let notes = copy.normalizedNotes {
                    Text(notes)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                if let tagsLine = copy.tagsLine {
                    Text("Tags: \(tagsLine)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.tertiary)
                .padding(.top, 4)
        }
        .padding(12)
        .background(colorScheme == .dark ? Color(.tertiarySystemBackground) : Color(.secondarySystemBackground))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(Color.primary.opacity(colorScheme == .dark ? 0.10 : 0.06), lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(Rectangle())
    }

    private struct CopyAttributeBadge: View {
        let icon: String?
        let label: String
        let color: Color
        @Environment(\.colorScheme) private var colorScheme

        init(icon: String? = nil, label: String, color: Color) {
            self.icon = icon
            self.label = label
            self.color = color
        }

        var body: some View {
            HStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon)
                        .font(.caption2)
                }
                Text(label)
                    .lineLimit(1)
            }
            .font(.caption2)
            .fontWeight(.medium)
            .foregroundColor(color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(color.opacity(colorScheme == .dark ? 0.22 : 0.12))
            .clipShape(Capsule())
        }
    }
}

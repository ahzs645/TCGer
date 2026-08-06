import SwiftUI

struct CollectionCardRow: View {
    let card: CollectionCard
    let showPricing: Bool
    let showDeleteConfirmation: Bool
    let onConfirmDelete: (() -> Void)?
    let onCancelDelete: (() -> Void)?
    @Environment(\.colorScheme) private var colorScheme
    @State private var isCopiesExpanded = false

    init(
        card: CollectionCard,
        showPricing: Bool,
        showDeleteConfirmation: Bool = false,
        onConfirmDelete: (() -> Void)? = nil,
        onCancelDelete: (() -> Void)? = nil
    ) {
        self.card = card
        self.showPricing = showPricing
        self.showDeleteConfirmation = showDeleteConfirmation
        self.onConfirmDelete = onConfirmDelete
        self.onCancelDelete = onCancelDelete
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
        for copy in card.copies {
            if let company = copy.gradingCompany, !company.isEmpty,
               let score = copy.gradingScore, !score.isEmpty {
                return (company, score)
            }
        }
        return nil
    }

    private var storageLocationSummary: String? {
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

                    HStack(spacing: 8) {
                        Text("×\(card.quantity)")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.accentColor)

                        if let rarity = card.rarity {
                            Text("•")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text(rarity)
                                .font(.caption2)
                                .foregroundColor(.secondary)
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
                    // A refreshable ancestor would otherwise give this
                    // horizontal strip its own vertical pull-to-refresh gesture.
                    .environment(\.refresh, nil)

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
                Spacer()
            }

            if card.copies.count > 1, isCopiesExpanded {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(card.copies.enumerated()), id: \.element.id) { index, copy in
                        CopyDetailRow(copy: copy, index: index)
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
        }
        .padding()
        .background(cardBackgroundColor)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(cardBorderColor, lineWidth: 1)
        )
        .cornerRadius(8)
        .overlay(alignment: .bottomTrailing) {
            if card.copies.count > 1 && !showDeleteConfirmation {
                Button {
                    isCopiesExpanded.toggle()
                } label: {
                    Image(systemName: isCopiesExpanded ? "chevron.up" : "chevron.down")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(10)
                }
                .buttonStyle(.plain)
            }
        }
        .contentShape(Rectangle())
        .cardPreviewContextMenu(card: card.previewCard)
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
                // A refreshable ancestor would otherwise give this horizontal
                // strip its own vertical pull-to-refresh gesture.
                .environment(\.refresh, nil)
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

    private struct CopyDetailRow: View {
        let copy: CollectionCardCopy
        let index: Int
        @Environment(\.colorScheme) private var colorScheme

        private var attributeLabels: [String] {
            var labels = copy.collectibleVariant.labels
            if copy.isFoil == true && labels.isEmpty { labels.append("Foil") }
            if copy.isSigned == true { labels.append("Signed") }
            if copy.isAltered == true { labels.append("Altered") }
            return labels
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                Text(copy.displayTitle(index: index))
                    .font(.caption)
                    .fontWeight(.semibold)

                if let detailLine = copy.detailLine {
                    Text(detailLine)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                if !attributeLabels.isEmpty {
                    HStack(spacing: 6) {
                        ForEach(attributeLabels, id: \.self) { label in
                            Text(label)
                                .font(.caption2)
                                .fontWeight(.medium)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.accentColor.opacity(colorScheme == .dark ? 0.22 : 0.12))
                                .foregroundColor(.accentColor)
                                .cornerRadius(4)
                        }
                    }
                }

                if let notes = copy.normalizedNotes {
                    Text(notes)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                if let tagsLine = copy.tagsLine {
                    Text("Tags: \(tagsLine)")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                } else {
                    Text("No tags")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }
            .padding(8)
            .background(colorScheme == .dark ? Color(.tertiarySystemBackground) : Color(.secondarySystemBackground))
            .cornerRadius(8)
        }
    }
}

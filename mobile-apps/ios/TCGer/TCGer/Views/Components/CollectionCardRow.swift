import SwiftUI

struct CollectionCardRow: View {
    let card: CollectionCard
    let showPricing: Bool
    let showDeleteConfirmation: Bool
    let onConfirmDelete: (() -> Void)?
    let onCancelDelete: (() -> Void)?
    @Environment(\.colorScheme) private var colorScheme
    @State private var isCopiesExpanded = false

    private let conditionPriority = [
        "GEM MINT", "MINT", "NEAR MINT", "NM", "LIGHTLY PLAYED", "LP",
        "MODERATE PLAY", "MP", "HEAVY PLAY", "HP", "DAMAGED", "DMG", "POOR"
    ]

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
        let sorted = unique.sorted { lhs, rhs in
            let leftIndex = conditionPriority.firstIndex(of: lhs) ?? conditionPriority.count
            let rightIndex = conditionPriority.firstIndex(of: rhs) ?? conditionPriority.count
            if leftIndex == rightIndex {
                return lhs < rhs
            }
            return leftIndex < rightIndex
        }
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
        let normalizedLanguage = language.trimmingCharacters(in: .whitespacesAndNewlines)
        let mapping: [String: String] = [
            "english": "EN",
            "japanese": "JP",
            "german": "DE",
            "french": "FR",
            "italian": "IT",
            "spanish": "ES",
            "portuguese": "PT",
            "korean": "KO",
            "chinese": "ZH"
        ]

        if let mapped = mapping[normalizedLanguage.lowercased()] {
            return mapped
        }

        let compact = normalizedLanguage
            .components(separatedBy: CharacterSet.letters.inverted)
            .joined()
            .uppercased()

        if compact.count >= 2 {
            return String(compact.prefix(2))
        }
        return compact.isEmpty ? nil : compact
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
        card.copies.contains { $0.isFoil == true }
    }

    private var hasAnySigned: Bool {
        card.copies.contains { $0.isSigned == true }
    }

    private var hasAnyAltered: Bool {
        card.copies.contains { $0.isAltered == true }
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
                CachedAsyncImage(url: URL(string: card.imageUrlSmall ?? card.imageUrl ?? "")) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .empty, .failure:
                        Rectangle()
                            .fill(previewCardBackgroundColor)
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            )
                    @unknown default:
                        Rectangle()
                            .fill(previewCardBackgroundColor)
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            )
                    }
                }
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
                            if let conditionSummary = conditionSummary() {
                                MetaTagChip(
                                    title: "Condition",
                                    value: conditionSummary,
                                    icon: "line.3.horizontal.decrease",
                                    color: .orange
                                )
                            }

                            if hasAnyFoil {
                                AttributeBadge(icon: "sparkles", label: "Foil", color: .yellow)
                            }
                            if hasAnySigned {
                                AttributeBadge(icon: "pencil.line", label: "Signed", color: .purple)
                            }
                            if hasAnyAltered {
                                AttributeBadge(icon: "paintpalette", label: "Altered", color: .pink)
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
                        Text("$\(String(format: "%.2f", price * Double(card.quantity)))")
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
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
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
            .foregroundColor(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(color.opacity(colorScheme == .dark ? 0.22 : 0.12))
            .clipShape(Capsule())
        }
    }

    private struct CopyDetailRow: View {
        let copy: CollectionCardCopy
        let index: Int
        @Environment(\.colorScheme) private var colorScheme

        private func normalized(_ value: String?) -> String? {
            guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
                return nil
            }
            return trimmed
        }

        private var title: String {
            if let serial = normalized(copy.serialNumber) {
                return serial
            }
            return "Copy #\(index + 1)"
        }

        private var detailLine: String? {
            var parts: [String] = []
            if let condition = normalized(copy.condition) {
                parts.append(condition)
            }
            if let language = normalized(copy.language) {
                parts.append(language)
            }
            return parts.isEmpty ? nil : parts.joined(separator: " • ")
        }

        private var tagsLine: String? {
            let labels = copy.tags.map { $0.label }.filter { !$0.isEmpty }
            guard !labels.isEmpty else { return nil }
            return labels.joined(separator: ", ")
        }

        private var attributeLabels: [String] {
            var labels: [String] = []
            if copy.isFoil == true { labels.append("Foil") }
            if copy.isSigned == true { labels.append("Signed") }
            if copy.isAltered == true { labels.append("Altered") }
            return labels
        }

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.caption)
                    .fontWeight(.semibold)

                if let detailLine {
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

                if let notes = normalized(copy.notes) {
                    Text(notes)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                if let tagsLine {
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

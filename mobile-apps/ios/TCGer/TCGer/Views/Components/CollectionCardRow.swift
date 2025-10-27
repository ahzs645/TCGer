import SwiftUI

struct CollectionCardRow: View {
    let card: CollectionCard
    let showPricing: Bool
    let onTap: (() -> Void)?

    private let conditionPriority = [
        "GEM MINT", "MINT", "NEAR MINT", "NM", "LIGHTLY PLAYED", "LP",
        "MODERATE PLAY", "MP", "HEAVY PLAY", "HP", "DAMAGED", "DMG", "POOR"
    ]

    init(card: CollectionCard, showPricing: Bool, onTap: (() -> Void)? = nil) {
        self.card = card
        self.showPricing = showPricing
        self.onTap = onTap
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

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                AsyncImage(url: URL(string: card.imageUrlSmall ?? card.imageUrl ?? "")) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .empty, .failure:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            )
                    @unknown default:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            )
                    }
                }
                .frame(width: 50, height: 70)
                .cornerRadius(4)

                VStack(alignment: .leading, spacing: 6) {
                    Text(card.name)
                        .font(.subheadline)
                        .fontWeight(.medium)

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

                    if let conditionSummary = conditionSummary() {
                        SummaryRow(label: "Conditions", value: conditionSummary, icon: "line.3.horizontal.decrease")
                    }

                    if let languageSummary = languageSummary() {
                        SummaryRow(label: "Languages", value: languageSummary, icon: "globe")
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

            if card.copies.count > 1 {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(Array(card.copies.enumerated()), id: \.element.id) { index, copy in
                        CopyDetailRow(copy: copy, index: index)
                    }
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(8)
        .contentShape(Rectangle())
        .onTapGesture {
            onTap?()
        }
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

    private struct TagSummaryRow: View {
        let tags: [CollectionCardTag]

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
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

        var body: some View {
            Text(tag.label)
                .font(.caption2)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Color.fromHex(tag.colorHex).opacity(0.15))
                .foregroundColor(Color.fromHex(tag.colorHex))
                .cornerRadius(8)
        }
    }

    private struct CopyDetailRow: View {
        let copy: CollectionCardCopy
        let index: Int

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
            .background(Color(.secondarySystemBackground))
            .cornerRadius(8)
        }
    }
}

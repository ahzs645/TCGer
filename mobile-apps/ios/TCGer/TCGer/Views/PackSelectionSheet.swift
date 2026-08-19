import SwiftUI

struct PackSelectionSheet: View {
    @Environment(\.dismiss) private var dismiss

    let packSets: [PackOpeningInterfaceState.PackSet]
    let cardPools: [PackOpeningInterfaceState.CardPool]
    let selectedPackID: String
    @ObservedObject var downloadManager: PackOfflineDownloadManager
    let onSelect: (String) -> Void

    var body: some View {
        NavigationStack {
            List {
                ForEach(packSets) { set in
                    Section {
                        NavigationLink {
                            PackVariantSelectionView(
                                packSet: set,
                                selectedPackID: selectedPackID,
                                onSelect: select
                            )
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Choose a pack")
                                    .font(.body.weight(.semibold))
                                Text("\(set.options.count) \(set.options.count == 1 ? "variant" : "variants")")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        if let pool = cardPool(for: set) {
                            NavigationLink {
                                PackPossiblePullsView(pool: pool)
                            } label: {
                                Label {
                                    VStack(alignment: .leading, spacing: 3) {
                                        Text("Possible cards")
                                            .font(.body.weight(.semibold))
                                        Text("Browse all \(pool.cards.count) cards in this pack pool")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: "rectangle.grid.2x2.fill")
                                        .foregroundStyle(.blue)
                                }
                            }
                            .accessibilityHint("Shows every card that can be pulled from \(set.label)")
                        }
                    } header: {
                        HStack(spacing: 10) {
                            Text(set.label)
                            Spacer()
                            if let definition = PackOfflineSetDefinition.matching(set.id) {
                                PackSetDownloadControl(
                                    definition: definition,
                                    manager: downloadManager
                                )
                            }
                        }
                        .textCase(nil)
                    }
                }
            }
            .navigationTitle("Choose a Set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func select(_ optionID: String) {
        onSelect(optionID)
        dismiss()
    }

    private func cardPool(
        for set: PackOpeningInterfaceState.PackSet
    ) -> PackOpeningInterfaceState.CardPool? {
        let poolID = set.options.first?.packPoolID ?? set.id
        return cardPools.first { $0.id == poolID }
    }
}

struct PackPossiblePullsSheet: View {
    @Environment(\.dismiss) private var dismiss

    let poolID: String
    let cardPools: [PackOpeningInterfaceState.CardPool]

    private var pool: PackOpeningInterfaceState.CardPool? {
        cardPools.first { $0.id.caseInsensitiveCompare(poolID) == .orderedSame }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let pool {
                    PackPossiblePullsView(pool: pool)
                } else {
                    ContentUnavailableView(
                        "Cards Unavailable",
                        systemImage: "rectangle.grid.2x2",
                        description: Text("This pack's card pool could not be loaded.")
                    )
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}

struct PackPossiblePullsView: View {
    let pool: PackOpeningInterfaceState.CardPool
    @State private var searchText = ""

    private let columns = [
        GridItem(.adaptive(minimum: 132, maximum: 190), spacing: 14)
    ]

    private var filteredCards: [PackOpeningPull] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedLowercase
        return pool.cards
            .filter { card in
                query.isEmpty ||
                    card.name.localizedLowercase.contains(query) ||
                    card.rarity.localizedLowercase.contains(query) ||
                    card.collectorNumber.localizedLowercase.contains(query)
            }
            .sorted {
                let leftRank = tierRank($0.tier)
                let rightRank = tierRank($1.tier)
                return leftRank == rightRank
                    ? $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
                    : leftRank > rightRank
            }
    }

    var body: some View {
        ScrollView {
            if filteredCards.isEmpty {
                ContentUnavailableView.search(text: searchText)
                    .padding(.top, 80)
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    Label(
                        "These cards are eligible in the simulator; one pack does not guarantee any specific card.",
                        systemImage: "info.circle"
                    )
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 4)

                    LazyVGrid(columns: columns, spacing: 20) {
                        ForEach(filteredCards) { card in
                            PackPossiblePullCard(card: card)
                        }
                    }
                }
                .padding(16)
            }
        }
        .navigationTitle("Possible Cards")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Name, rarity, or number")
        .safeAreaInset(edge: .bottom) {
            Text("Showing \(filteredCards.count) of \(pool.cards.count) cards")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 14)
                .padding(.vertical, 9)
                .background(.regularMaterial, in: .capsule)
                .padding(.bottom, 8)
        }
        .accessibilityLabel("\(pool.label) possible cards")
    }

    private func tierRank(_ tier: String) -> Int {
        switch tier.lowercased() {
        case "chase": 5
        case "ultra": 4
        case "rare": 3
        case "uncommon": 2
        default: 1
        }
    }
}

private struct PackPossiblePullCard: View {
    let card: PackOpeningPull

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            CachedAsyncImage(card: card.card, thumbnail: true) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().scaledToFit()
                case .failure:
                    Image(systemName: "rectangle.portrait.slash")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                default:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .aspectRatio(2.5 / 3.5, contentMode: .fit)
            .clipShape(TradingCardShape())
            .shadow(color: .black.opacity(0.12), radius: 7, y: 4)

            Text(card.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
            Text("#\(card.collectorNumber) · \(card.rarity)")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            "\(card.name), number \(card.collectorNumber), \(card.rarity)"
        )
    }
}

private struct PackVariantSelectionView: View {
    let packSet: PackOpeningInterfaceState.PackSet
    let selectedPackID: String
    let onSelect: (String) -> Void

    var body: some View {
        List(packSet.options) { option in
            Button {
                onSelect(option.id)
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "rectangle.portrait.on.rectangle.portrait")
                        .foregroundStyle(.blue)
                    Text(option.resolvedVariationLabel)
                        .foregroundStyle(.primary)
                    Spacer()
                    if option.id == selectedPackID {
                        Image(systemName: "checkmark")
                            .fontWeight(.semibold)
                            .foregroundStyle(.blue)
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(option.resolvedVariationLabel) pack")
            .accessibilityAddTraits(option.id == selectedPackID ? .isSelected : [])
        }
        .navigationTitle(packSet.label)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PackSetDownloadControl: View {
    let definition: PackOfflineSetDefinition
    @ObservedObject var manager: PackOfflineDownloadManager

    var body: some View {
        switch manager.status(for: definition) {
        case .notDownloaded:
            downloadButton(systemImage: "arrow.down.circle", label: "Download \(definition.name)")
        case .downloading:
            ProgressView()
                .controlSize(.small)
                .accessibilityLabel("Downloading \(definition.name)")
        case .downloaded:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .accessibilityLabel("\(definition.name) downloaded")
        case .failed:
            downloadButton(systemImage: "arrow.clockwise.circle", label: "Retry \(definition.name) download")
        }
    }

    private func downloadButton(systemImage: String, label: String) -> some View {
        Button {
            manager.download(definition)
        } label: {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
        }
        .buttonStyle(.borderless)
        .disabled(!NetworkMonitor.shared.isConnected)
        .accessibilityLabel(label)
    }
}

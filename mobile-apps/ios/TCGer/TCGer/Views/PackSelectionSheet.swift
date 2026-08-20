import SwiftUI

private enum PackSetAvailabilityFilter: String, CaseIterable, Identifiable {
    case all = "All Sets"
    case downloaded = "Downloaded"
    case notDownloaded = "Not Downloaded"

    var id: String { rawValue }
}

struct PackSelectionSheet: View {
    @Environment(\.dismiss) private var dismiss

    let packSets: [PackOpeningInterfaceState.PackSet]
    let cardPools: [PackOpeningInterfaceState.CardPool]
    let selectedPackID: String
    @ObservedObject var downloadManager: PackOfflineDownloadManager
    let onSelect: (String) -> Void
    @State private var searchText = ""
    @State private var availabilityFilter = PackSetAvailabilityFilter.all

    private var filteredPackSets: [PackOpeningInterfaceState.PackSet] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return packSets.filter { set in
            let matchesSearch = query.isEmpty
                || set.label.localizedCaseInsensitiveContains(query)
                || set.options.contains { option in
                    option.resolvedVariationLabel.localizedCaseInsensitiveContains(query)
                }

            let matchesAvailability = switch availabilityFilter {
            case .all:
                true
            case .downloaded:
                isDownloaded(set)
            case .notDownloaded:
                !isDownloaded(set)
            }
            return matchesSearch && matchesAvailability
        }
    }

    var body: some View {
        NavigationStack {
            List {
                if filteredPackSets.isEmpty {
                    ContentUnavailableView {
                        Label("No Sets Found", systemImage: "magnifyingglass")
                    } description: {
                        Text("Try another search or download filter.")
                    } actions: {
                        Button("Show All Sets") {
                            searchText = ""
                            availabilityFilter = .all
                        }
                    }
                    .listRowBackground(Color.clear)
                }

                ForEach(filteredPackSets) { set in
                    Section {
                        NavigationLink {
                            PackSetBrowserView(
                                packSet: set,
                                cardPools: cardPools,
                                selectedPackID: selectedPackID,
                                onSelect: onSelect,
                                onDone: { dismiss() }
                            )
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Packs & possible cards")
                                        .font(.body.weight(.semibold))
                                    Text(setSummary(set))
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            } icon: {
                                Image(systemName: "rectangle.stack.fill")
                                    .foregroundStyle(.blue)
                            }
                        }
                        .accessibilityHint("Choose a pack variant and browse every possible card from \(set.label)")
                    } header: {
                        HStack(spacing: 10) {
                            Text(set.label)
                            Spacer()
                            if set.options.contains(where: { $0.id == selectedPackID }) {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(.blue)
                                    .accessibilityLabel("Selected set")
                            }
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
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search sets or packs"
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Download status", selection: $availabilityFilter) {
                            ForEach(PackSetAvailabilityFilter.allCases) { filter in
                                Text(filter.rawValue).tag(filter)
                            }
                        }
                    } label: {
                        Image(systemName: availabilityFilter == .all
                            ? "line.3.horizontal.decrease"
                            : "line.3.horizontal.decrease.circle.fill")
                    }
                    .accessibilityLabel("Filter sets by download status, \(availabilityFilter.rawValue)")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func setSummary(_ set: PackOpeningInterfaceState.PackSet) -> String {
        let variantCount = set.options.count
        let variantSummary = "\(variantCount) \(variantCount == 1 ? "variant" : "variants")"
        guard let pool = cardPool(for: set) else { return variantSummary }
        return "\(variantSummary) · \(pool.cards.count) cards"
    }

    private func cardPool(
        for set: PackOpeningInterfaceState.PackSet
    ) -> PackOpeningInterfaceState.CardPool? {
        let poolID = set.options.first?.packPoolID ?? set.id
        return cardPools.first { $0.id.caseInsensitiveCompare(poolID) == .orderedSame }
    }

    private func isDownloaded(_ set: PackOpeningInterfaceState.PackSet) -> Bool {
        guard let definition = PackOfflineSetDefinition.matching(set.id) else { return false }
        if case .downloaded = downloadManager.status(for: definition) { return true }
        return false
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

    var body: some View {
        PackCardBrowser(pool: pool) { EmptyView() }
            .navigationTitle("Possible Cards")
            .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PackSetBrowserView: View {
    let packSet: PackOpeningInterfaceState.PackSet
    let cardPools: [PackOpeningInterfaceState.CardPool]
    let onSelect: (String) -> Void
    let onDone: () -> Void
    @State private var selectedPackID: String

    init(
        packSet: PackOpeningInterfaceState.PackSet,
        cardPools: [PackOpeningInterfaceState.CardPool],
        selectedPackID: String,
        onSelect: @escaping (String) -> Void,
        onDone: @escaping () -> Void
    ) {
        self.packSet = packSet
        self.cardPools = cardPools
        self.onSelect = onSelect
        self.onDone = onDone
        _selectedPackID = State(initialValue:
            packSet.options.contains(where: { $0.id == selectedPackID })
                ? selectedPackID
                : ""
        )
    }

    private var selectedOption: PackOpeningInterfaceState.PackOption? {
        packSet.options.first { $0.id == selectedPackID } ?? packSet.options.first
    }

    private var selectedPool: PackOpeningInterfaceState.CardPool? {
        let poolID = selectedOption?.packPoolID ?? packSet.id
        return cardPools.first { $0.id.caseInsensitiveCompare(poolID) == .orderedSame }
    }

    var body: some View {
        Group {
            if let selectedPool {
                PackCardBrowser(pool: selectedPool) {
                    packVariantPicker
                }
            } else {
                VStack(spacing: 18) {
                    packVariantPicker
                    ContentUnavailableView(
                        "Cards Unavailable",
                        systemImage: "rectangle.grid.2x2",
                        description: Text("This pack's card pool could not be loaded.")
                    )
                }
                .padding()
            }
        }
        .navigationTitle(packSet.label)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done", action: onDone)
            }
        }
    }

    private var packVariantPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Choose a pack")
                    .font(.headline)
                Text("Select the pack artwork you want to open.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(packSet.options) { option in
                Button {
                    selectedPackID = option.id
                    onSelect(option.id)
                    HapticManager.selection()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "rectangle.portrait.on.rectangle.portrait")
                            .foregroundStyle(option.id == selectedPackID ? .blue : .secondary)
                        Text(option.resolvedVariationLabel)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.primary)
                        Spacer()
                        if option.id == selectedPackID {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.blue)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                    .background(
                        option.id == selectedPackID
                            ? Color.accentColor.opacity(0.12)
                            : Color(uiColor: .tertiarySystemGroupedBackground),
                        in: .rect(cornerRadius: 14)
                    )
                    .contentShape(.rect)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(option.resolvedVariationLabel) pack")
                .accessibilityAddTraits(option.id == selectedPackID ? .isSelected : [])
            }
        }
        .padding(16)
        .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 20))
    }
}

private struct PackCardBrowser<Header: View>: View {
    let pool: PackOpeningInterfaceState.CardPool
    let header: Header
    @State private var searchText = ""
    @State private var selectedRarity: String?

    private let columns = [
        GridItem(.adaptive(minimum: 132, maximum: 190), spacing: 14)
    ]

    init(
        pool: PackOpeningInterfaceState.CardPool,
        @ViewBuilder header: () -> Header
    ) {
        self.pool = pool
        self.header = header()
    }

    private var availableRarities: [String] {
        Array(Set(pool.cards.map(\.rarity))).sorted {
            $0.localizedCaseInsensitiveCompare($1) == .orderedAscending
        }
    }

    private var filteredCards: [PackOpeningPull] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedLowercase
        return pool.cards
            .filter { card in
                let matchesSearch = query.isEmpty ||
                    card.name.localizedLowercase.contains(query) ||
                    card.rarity.localizedLowercase.contains(query) ||
                    card.collectorNumber.localizedLowercase.contains(query)
                let matchesRarity = selectedRarity.map {
                    card.rarity.caseInsensitiveCompare($0) == .orderedSame
                } ?? true
                return matchesSearch && matchesRarity
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
                VStack(spacing: 24) {
                    header
                    ContentUnavailableView {
                        Label("No Cards Found", systemImage: "magnifyingglass")
                    } description: {
                        Text("Try another search or rarity filter.")
                    } actions: {
                        Button("Clear Filters") {
                            searchText = ""
                            selectedRarity = nil
                        }
                    }
                    .padding(.vertical, 48)
                }
                .padding(16)
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    header

                    HStack(alignment: .firstTextBaseline) {
                        Text("Possible cards")
                            .font(.headline)
                        Spacer()
                        Text("\(pool.cards.count) total")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }

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
        .background(Color(uiColor: .systemGroupedBackground))
        .searchable(
            text: $searchText,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Name, rarity, or number"
        )
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Picker("Rarity", selection: $selectedRarity) {
                        Text("All Rarities").tag(String?.none)
                        ForEach(availableRarities, id: \.self) { rarity in
                            Text(rarity).tag(String?.some(rarity))
                        }
                    }
                } label: {
                    Image(systemName: selectedRarity == nil
                        ? "line.3.horizontal.decrease"
                        : "line.3.horizontal.decrease.circle.fill")
                }
                .accessibilityLabel("Filter cards by rarity, \(selectedRarity ?? "All Rarities")")
            }
        }
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
        .onChange(of: pool.id) {
            selectedRarity = nil
        }
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

import SwiftUI

struct PricesView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var collections: [Collection] = []
    @State private var movers = PriceAnalyticsMovers(gainers: [], losers: [])
    @State private var livePrices: [String: APIService.TrackedPriceResult] = [:]
    @State private var lastPriceCheck: Date?
    @State private var nextPriceRefresh: Date?
    @State private var priceRefreshMessage: String?
    @State private var isRefreshingPrices = false
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var selectedGame: TCGGame = .all
    @State private var sort = PriceSort.value

    private let apiService = APIService()

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    fileprivate struct TrackedCard: Identifiable {
        let id: String
        let name: String
        let tcg: String
        let setName: String?
        let rarity: String?
        let price: Double
        let currency: String
        let source: String?
        var owned: Int
        let imageURL: String?
        var change: Double?
    }

    private enum PriceSort: String, CaseIterable, Identifiable {
        case value = "Value"
        case price = "Price"
        case owned = "Owned"
        case change = "30d"

        var id: String { rawValue }
    }

    private var trackedCards: [TrackedCard] {
        let changes = Dictionary(
            uniqueKeysWithValues: (movers.gainers + movers.losers).map {
                ("\($0.tcg):\($0.externalId)", $0.percentChange)
            }
        )
        var cards: [String: TrackedCard] = [:]
        for card in collections.flatMap(\.cards) {
            let key = "\(card.tcg):\(card.externalId ?? card.cardId)"
            let market = livePrices[key.lowercased()]
            if var existing = cards[key] {
                existing.owned += card.quantity
                cards[key] = existing
            } else {
                cards[key] = TrackedCard(
                    id: key,
                    name: card.name,
                    tcg: card.tcg,
                    setName: card.setName,
                    rarity: card.rarity,
                    price: market?.price ?? card.price ?? 0,
                    currency: market?.currency ?? "USD",
                    source: market?.source,
                    owned: card.quantity,
                    imageURL: card.imageUrlSmall ?? card.imageUrl,
                    change: changes[key]
                )
            }
        }
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return cards.values
            .filter { selectedGame == .all || $0.tcg.caseInsensitiveCompare(selectedGame.rawValue) == .orderedSame }
            .filter {
                query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) ||
                    ($0.setName?.localizedCaseInsensitiveContains(query) ?? false)
            }
            .sorted { lhs, rhs in
                switch sort {
                case .value: return lhs.price * Double(lhs.owned) > rhs.price * Double(rhs.owned)
                case .price: return lhs.price > rhs.price
                case .owned: return lhs.owned > rhs.owned
                case .change: return (lhs.change ?? -.infinity) > (rhs.change ?? -.infinity)
                }
            }
    }

    private var portfolioValueText: String {
        let totals = Dictionary(grouping: trackedCards, by: \.currency).mapValues { cards in
            cards.reduce(0) { $0 + $1.price * Double($1.owned) }
        }
        return totals.keys.sorted().map { currency in
            (totals[currency] ?? 0).priceText(currency: currency)
        }.joined(separator: " · ")
    }

    var body: some View {
        Group {
            if parentProvidesNavigation { content } else { NavigationStack { content } }
        }
    }

    private var content: some View {
        Group {
            if !environmentStore.showPricing {
                ContentUnavailableView(
                    "Pricing Is Hidden",
                    systemImage: "eye.slash",
                    description: Text("Enable pricing in Settings to use the price tracker.")
                )
            } else if isLoading {
                ProgressView("Loading prices…")
            } else if let errorMessage {
                ErrorView(title: "Couldn’t Load Prices", message: errorMessage) {
                    Task { await load() }
                }
            } else if collections.flatMap(\.cards).isEmpty {
                ContentUnavailableView(
                    "No Tracked Cards",
                    systemImage: "chart.line.uptrend.xyaxis",
                    description: Text("Add cards to a binder to start tracking their value.")
                )
            } else {
                List {
                    Section {
                        HStack {
                            PriceStat(title: "Portfolio", value: portfolioValueText)
                            Divider()
                            PriceStat(title: "Tracked", value: "\(trackedCards.count)")
                            Divider()
                            PriceStat(
                                title: "Movers",
                                value: "\(movers.gainers.count + movers.losers.count)"
                            )
                        }
                        .padding(.vertical, 6)
                    }

                    if let lastPriceCheck {
                        Section {
                            LabeledContent("Market prices") {
                                Text(lastPriceCheck, format: .dateTime.month().day().hour().minute())
                            }
                            if let priceRefreshMessage {
                                Text(priceRefreshMessage)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            } else if let nextPriceRefresh {
                                Text("Next automatic check after \(nextPriceRefresh.formatted(date: .abbreviated, time: .shortened)), while this screen is open.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    Section {
                        if environmentStore.shouldShowGamePicker {
                            GamePickerPills(
                                selection: $selectedGame,
                                games: environmentStore.gamePickerGames
                            )
                            .listRowInsets(EdgeInsets())
                        }
                        Picker("Sort", selection: $sort) {
                            ForEach(PriceSort.allCases) { Text($0.rawValue).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }

                    if trackedCards.isEmpty {
                        ContentUnavailableView.search(text: searchText)
                    } else {
                        Section("Cards") {
                            ForEach(trackedCards) { card in
                                TrackedCardRow(card: card)
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Prices")
        .searchable(text: $searchText, prompt: "Search tracked cards")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await refreshTrackedPrices(force: true) }
                } label: {
                    if isRefreshingPrices {
                        ProgressView()
                    } else {
                        Label("Refresh prices", systemImage: "arrow.clockwise")
                    }
                }
                .disabled(isRefreshingPrices || collections.flatMap(\.cards).isEmpty)
            }
        }
        .refreshable { await load(forcePrices: true) }
        .task {
            await load()
            while !Task.isCancelled {
                let delay = max(
                    60,
                    nextPriceRefresh?.timeIntervalSinceNow ?? 12 * 60 * 60
                )
                do {
                    try await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                } catch {
                    return
                }
                await refreshTrackedPrices(force: false)
            }
        }
    }

    @MainActor
    private func load(forcePrices: Bool = false) async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            errorMessage = "Sign in is required to view prices."
            return
        }
        isLoading = collections.isEmpty
        errorMessage = nil
        do {
            async let fetchedCollections = apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: environmentStore.offlineModeEnabled
            )
            async let fetchedMovers = apiService.getPriceMovers(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: selectedGame == .all ? nil : selectedGame.rawValue,
                period: 30
            )
            collections = try await fetchedCollections
            movers = (try? await fetchedMovers) ?? PriceAnalyticsMovers(gainers: [], losers: [])
            await refreshTrackedPrices(force: forcePrices)
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func refreshTrackedPrices(force: Bool) async {
        guard !isRefreshingPrices, let token = environmentStore.authToken else { return }
        let items = collections.flatMap(\.cards).map {
            APIService.TrackedPriceItem(
                tcg: $0.tcg,
                externalId: $0.externalId ?? $0.cardId
            )
        }
        guard !items.isEmpty else { return }
        isRefreshingPrices = true
        defer { isRefreshingPrices = false }
        do {
            let response = try await apiService.getTrackedPrices(
                config: environmentStore.serverConfiguration,
                token: token,
                items: items,
                force: force
            )
            livePrices = Dictionary(
                uniqueKeysWithValues: response.prices.compactMap { result in
                    guard result.price != nil else { return nil }
                    return ("\(result.tcg):\(result.externalId)".lowercased(), result)
                }
            )
            lastPriceCheck = ISO8601DateFormatter().date(from: response.refreshedAt) ?? Date()
            nextPriceRefresh = ISO8601DateFormatter().date(from: response.refreshAfter)
            let unavailable = response.prices.filter { $0.price == nil }.count
            priceRefreshMessage = unavailable > 0
                ? "Stored prices are shown for \(unavailable) card\(unavailable == 1 ? "" : "s") without a compatible live quote."
                : nil
        } catch is CancellationError {
            return
        } catch {
            priceRefreshMessage = "Live prices could not be refreshed. Stored collection prices are still shown."
        }
    }
}

private struct PriceStat: View {
    let title: String
    let value: String

    var body: some View {
        VStack(spacing: 4) {
            Text(value).font(.headline.monospacedDigit()).lineLimit(1).minimumScaleFactor(0.7)
            Text(title).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct TrackedCardRow: View {
    let card: PricesView.TrackedCard

    var body: some View {
        HStack(spacing: 12) {
            if let image = card.imageURL, let url = URL(string: image) {
                CachedAsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image.resizable().scaledToFit()
                    } else {
                        Color(.tertiarySystemFill)
                    }
                }
                .frame(width: 38, height: 52)
                .clipShape(.rect(cornerRadius: 4))
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(card.name).font(.subheadline.weight(.medium)).lineLimit(1)
                HStack(spacing: 6) {
                    GameBadge(tcg: card.tcg)
                    if let set = card.setName { Text(set).lineLimit(1) }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text((card.price * Double(card.owned)).priceText(currency: card.currency))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                Text("\(card.price.priceText(currency: card.currency)) × \(card.owned)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                if let source = card.source {
                    Text(source)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if let change = card.change {
                    Text("\(change >= 0 ? "+" : "")\(change, specifier: "%.1f")%")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(change >= 0 ? .green : .red)
                }
            }
        }
        .padding(.vertical, 3)
    }
}

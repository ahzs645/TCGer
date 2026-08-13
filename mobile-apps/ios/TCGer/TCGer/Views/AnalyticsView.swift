import Charts
import SwiftUI

struct AnalyticsView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var history: CollectionValueHistory?
    @State private var breakdown: CollectionValueBreakdown?
    @State private var distribution: CollectionDistribution?
    @State private var movers = PriceAnalyticsMovers(gainers: [], losers: [])
    @State private var period = AnalyticsPeriod.thirtyDays
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let apiService = APIService()

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    private enum AnalyticsPeriod: String, CaseIterable, Identifiable {
        case sevenDays = "7d"
        case thirtyDays = "30d"
        case ninetyDays = "90d"
        case oneYear = "1y"

        var id: String { rawValue }
        var title: String {
            switch self {
            case .sevenDays: "7D"
            case .thirtyDays: "30D"
            case .ninetyDays: "90D"
            case .oneYear: "1Y"
            }
        }
        var days: Int {
            switch self {
            case .sevenDays: 7
            case .thirtyDays: 30
            case .ninetyDays: 90
            case .oneYear: 365
            }
        }
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
                    "Analytics Are Hidden",
                    systemImage: "chart.xyaxis.line",
                    description: Text("Enable pricing in Settings to view collection analytics.")
                )
            } else if isLoading {
                ProgressView("Loading analytics…")
            } else if let errorMessage {
                ErrorView(title: "Couldn’t Load Analytics", message: errorMessage) {
                    Task { await load() }
                }
            } else if let history, let breakdown, let distribution {
                ScrollView {
                    LazyVStack(spacing: AppSpacing.large) {
                        summary(history)
                        valueHistory(history)
                        gameBreakdown(breakdown)
                        rarityDistribution(distribution)
                        moversSection
                        topCards(breakdown)
                    }
                    .padding()
                }
            } else {
                ContentUnavailableView("No Analytics", systemImage: "chart.bar")
            }
        }
        .navigationTitle("Analytics")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Period", selection: $period) {
                        ForEach(AnalyticsPeriod.allCases) { Text($0.title).tag($0) }
                    }
                } label: {
                    Image(systemName: "calendar.badge.clock")
                }
                .accessibilityLabel("Analytics period")
                .accessibilityValue(period.title)
            }
        }
        .refreshable { await load() }
        .task(id: period) { await load() }
    }

    private func summary(_ value: CollectionValueHistory) -> some View {
        HStack(spacing: 0) {
            StatBlock(title: "Value", value: value.currentValue.priceText)
                .frame(maxWidth: .infinity)
            Divider().frame(height: 42)
            StatBlock(
                title: period.title,
                value: String(format: "%@%.1f%%", value.changePercent >= 0 ? "+" : "", value.changePercent),
                color: value.changePercent >= 0 ? .green : .red
            )
            .frame(maxWidth: .infinity)
            Divider().frame(height: 42)
            StatBlock(
                title: "Cards",
                value: "\(breakdown?.byTcg.reduce(0) { $0 + $1.cardCount } ?? 0)",
                color: .primary
            )
            .frame(maxWidth: .infinity)
        }
        .padding(AppSpacing.large)
        .background(.regularMaterial, in: .rect(cornerRadius: AppRadius.card))
    }

    private func valueHistory(_ value: CollectionValueHistory) -> some View {
        AnalyticsCard(title: "Collection Value", subtitle: "Market value over \(period.title)") {
            if value.history.count < 2 {
                ContentUnavailableView(
                    "More History Needed",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("Value history will appear after additional price snapshots.")
                )
                .frame(height: 180)
            } else {
                CollectionValueChart(points: value.history)
                    .id(period)
            }
        }
    }

    private func gameBreakdown(_ value: CollectionValueBreakdown) -> some View {
        AnalyticsCard(title: "Value by Game", subtitle: "Portfolio allocation") {
            if value.byTcg.isEmpty {
                Text("No priced cards yet.").foregroundStyle(.secondary)
            } else {
                Chart(value.byTcg) { item in
                    BarMark(
                        x: .value("Value", item.value),
                        y: .value("Game", TCGGame(rawValue: item.tcg)?.shortName ?? item.tcg.capitalized)
                    )
                    .foregroundStyle(by: .value("Game", item.tcg))
                }
                .frame(height: max(150, CGFloat(value.byTcg.count) * 42))
                .chartLegend(.hidden)
            }
        }
    }

    private func rarityDistribution(_ value: CollectionDistribution) -> some View {
        AnalyticsCard(title: "Rarity Distribution", subtitle: "\(value.total) unique entries") {
            if value.entries.isEmpty {
                Text("No rarity information yet.").foregroundStyle(.secondary)
            } else {
                Chart(Array(value.entries.prefix(8))) { item in
                    BarMark(
                        x: .value("Cards", item.count),
                        y: .value("Rarity", item.label)
                    )
                    .foregroundStyle(.tint)
                }
                .frame(height: max(180, CGFloat(min(value.entries.count, 8)) * 36))
            }
        }
    }

    @ViewBuilder
    private var moversSection: some View {
        if !movers.gainers.isEmpty || !movers.losers.isEmpty {
            AnalyticsCard(title: "Market Movers", subtitle: period.title) {
                VStack(spacing: 12) {
                    ForEach(Array(movers.gainers.prefix(3))) { mover in
                        MoverRow(mover: mover)
                    }
                    ForEach(Array(movers.losers.prefix(3))) { mover in
                        MoverRow(mover: mover)
                    }
                }
            }
        }
    }

    private func topCards(_ value: CollectionValueBreakdown) -> some View {
        AnalyticsCard(title: "Top Cards", subtitle: "Highest collection value") {
            if value.topCards.isEmpty {
                Text("No priced cards yet.").foregroundStyle(.secondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(value.topCards.prefix(8))) { card in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(card.name).font(.subheadline.weight(.medium)).lineLimit(1)
                                GameBadge(tcg: card.tcg)
                            }
                            Spacer()
                            Text(card.value.priceText).font(.subheadline.monospacedDigit())
                        }
                        .padding(.vertical, 8)
                        if card.id != value.topCards.prefix(8).last?.id { Divider() }
                    }
                }
            }
        }
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            errorMessage = "Sign in is required to view analytics."
            return
        }
        isLoading = history == nil
        errorMessage = nil
        do {
            async let nextHistory = apiService.getCollectionValueHistory(
                config: environmentStore.serverConfiguration, token: token, period: period.rawValue
            )
            async let nextBreakdown = apiService.getCollectionValueBreakdown(
                config: environmentStore.serverConfiguration, token: token
            )
            async let nextDistribution = apiService.getCollectionDistribution(
                config: environmentStore.serverConfiguration, token: token, dimension: "rarity"
            )
            async let nextMovers = apiService.getPriceMovers(
                config: environmentStore.serverConfiguration, token: token, period: period.days
            )
            history = try await nextHistory
            breakdown = try await nextBreakdown
            distribution = try await nextDistribution
            movers = (try? await nextMovers) ?? PriceAnalyticsMovers(gainers: [], losers: [])
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

private struct AnalyticsCard<Content: View>: View {
    let title: String
    let subtitle: String
    @ViewBuilder let content: Content

    var body: some View {
        SurfaceCard(title: title, subtitle: subtitle) {
            content
        }
    }
}

private struct MoverRow: View {
    let mover: PriceMover

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 3) {
                Text(mover.name).font(.subheadline.weight(.medium)).lineLimit(1)
                GameBadge(tcg: mover.tcg)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(mover.currentPrice.priceText).font(.subheadline.monospacedDigit())
                Text("\(mover.percentChange >= 0 ? "+" : "")\(mover.percentChange, specifier: "%.1f")%")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(mover.percentChange >= 0 ? .green : .red)
            }
        }
    }
}

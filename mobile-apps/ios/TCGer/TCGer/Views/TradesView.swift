import SwiftUI

struct TradesView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var trades: [Trade] = []
    @State private var matches: [TradeMatch] = []
    @State private var isLoading = true
    @State private var isLoadingMatches = false
    @State private var errorMessage: String?
    @State private var filter = TradeFilter.all
    @State private var selectedMatch: TradeMatch?

    private let apiService = APIService()

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    private enum TradeFilter: String, CaseIterable, Identifiable {
        case all, pending, accepted, declined
        var id: String { rawValue }
        var title: String { rawValue.capitalized }
    }

    private var filteredTrades: [Trade] {
        filter == .all ? trades : trades.filter { $0.status.lowercased() == filter.rawValue }
    }

    var body: some View {
        Group {
            if parentProvidesNavigation { content } else { NavigationStack { content } }
        }
    }

    private var content: some View {
        Group {
            if environmentStore.serverConfiguration.isOnDevice {
                ContentUnavailableView(
                    "Connect a Server for Trades",
                    systemImage: "arrow.left.arrow.right",
                    description: Text("Collector-to-collector trades require user accounts on a TCGer server.")
                )
            } else if isLoading {
                ProgressView("Loading trades…")
            } else if let errorMessage, trades.isEmpty {
                ErrorView(title: "Couldn’t Load Trades", message: errorMessage) { Task { await load() } }
            } else {
                List {
                    Section {
                        TradeSummary(trades: trades, currentUserID: environmentStore.currentUser?.id)
                    }
                    Section {
                        Picker("Status", selection: $filter) {
                            ForEach(TradeFilter.allCases) { Text($0.title).tag($0) }
                        }
                        .pickerStyle(.segmented)
                    }

                    if filteredTrades.isEmpty {
                        Section {
                            ContentUnavailableView(
                                filter == .all ? "No Trades Yet" : "No \(filter.title) Trades",
                                systemImage: "arrow.left.arrow.right",
                                description: Text("Open suggested matches to propose a card-for-card trade.")
                            )
                        }
                    } else {
                        Section("Trades") {
                            ForEach(filteredTrades) { trade in
                                NavigationLink {
                                    TradeDetailView(trade: trade) { action in
                                        await perform(action, on: trade)
                                    }
                                    .environmentObject(environmentStore)
                                } label: {
                                    TradeRow(trade: trade, currentUserID: environmentStore.currentUser?.id)
                                }
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                    if trade.status == "pending", trade.receiverId == environmentStore.currentUser?.id {
                                        Button { Task { await perform("accept", on: trade) } } label: {
                                            Label("Accept", systemImage: "checkmark")
                                        }
                                        .tint(.green)
                                        Button { Task { await perform("decline", on: trade) } } label: {
                                            Label("Decline", systemImage: "xmark")
                                        }
                                        .tint(.orange)
                                    }
                                    if trade.senderId == environmentStore.currentUser?.id {
                                        Button(role: .destructive) { Task { await remove(trade) } } label: {
                                            Label("Delete", systemImage: "trash")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .navigationTitle("Trades")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { Task { await loadMatches() } } label: {
                    if isLoadingMatches { ProgressView() }
                    else { Image(systemName: "person.2.badge.plus") }
                }
                .disabled(environmentStore.serverConfiguration.isOnDevice || isLoadingMatches)
                .accessibilityLabel("Suggested trade matches")
            }
        }
        .refreshable { await load() }
        .task { await load() }
        .sheet(item: $selectedMatch) { match in
            ProposeTradeSheet(match: match) { message in
                await propose(match, message: message)
            }
        }
        .sheet(isPresented: Binding(
            get: { !matches.isEmpty && selectedMatch == nil },
            set: { if !$0 { matches = [] } }
        )) {
            TradeMatchesSheet(matches: matches) { match in
                matches = []
                selectedMatch = match
            }
        }
        .alert("Trades", isPresented: Binding(
            get: { errorMessage != nil && !trades.isEmpty },
            set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "") }
    }

    @MainActor
    private func load() async {
        guard !environmentStore.serverConfiguration.isOnDevice else { isLoading = false; return }
        guard let token = environmentStore.authToken else {
            isLoading = false
            errorMessage = "Sign in is required to view trades."
            return
        }
        isLoading = trades.isEmpty
        do {
            trades = try await apiService.getTrades(config: environmentStore.serverConfiguration, token: token)
        } catch { errorMessage = error.localizedDescription }
        isLoading = false
    }

    @MainActor
    private func loadMatches() async {
        guard let token = environmentStore.authToken else { return }
        isLoadingMatches = true
        do {
            matches = try await apiService.getTradeMatches(
                config: environmentStore.serverConfiguration, token: token
            )
            if matches.isEmpty {
                errorMessage = "No suggested matches are available yet. Add cards to wishlists and binders to improve matching."
            }
        } catch { errorMessage = error.localizedDescription }
        isLoadingMatches = false
    }

    @MainActor
    private func propose(_ match: TradeMatch, message: String?) async -> Bool {
        guard let token = environmentStore.authToken else { return false }
        do {
            let trade = try await apiService.createTrade(
                config: environmentStore.serverConfiguration, token: token, match: match, message: message
            )
            trades.insert(trade, at: 0)
            HapticManager.notification(.success)
            return true
        } catch { errorMessage = error.localizedDescription; return false }
    }

    @MainActor
    private func perform(_ action: String, on trade: Trade) async {
        guard let token = environmentStore.authToken else { return }
        do {
            let updated = try await apiService.updateTradeStatus(
                config: environmentStore.serverConfiguration,
                token: token,
                tradeId: trade.id,
                action: action
            )
            if let index = trades.firstIndex(where: { $0.id == trade.id }) { trades[index] = updated }
            HapticManager.notification(.success)
        } catch { errorMessage = error.localizedDescription }
    }

    @MainActor
    private func remove(_ trade: Trade) async {
        guard let token = environmentStore.authToken else { return }
        do {
            try await apiService.deleteTrade(
                config: environmentStore.serverConfiguration, token: token, tradeId: trade.id
            )
            trades.removeAll { $0.id == trade.id }
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct TradeSummary: View {
    let trades: [Trade]
    let currentUserID: String?

    private var accepted: [Trade] { trades.filter { $0.status == "accepted" } }
    private func sideValue(_ trade: Trade, side: String) -> Double {
        trade.cards.filter { $0.side == side }.reduce(0) {
            $0 + ($1.estimatedValue ?? 0) * Double($1.quantity)
        }
    }

    private var given: Double {
        accepted.reduce(0) { result, trade in
            result + sideValue(trade, side: trade.senderId == currentUserID ? "sender" : "receiver")
        }
    }

    private var received: Double {
        accepted.reduce(0) { result, trade in
            result + sideValue(trade, side: trade.senderId == currentUserID ? "receiver" : "sender")
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            TradeMetric(title: "Total", value: "\(trades.count)")
            Divider().frame(height: 38)
            TradeMetric(title: "Given", value: given.priceText)
            Divider().frame(height: 38)
            TradeMetric(title: "Received", value: received.priceText)
        }
        .padding(.vertical, 4)
    }
}

private struct TradeMetric: View {
    let title: String
    let value: String
    var body: some View {
        VStack(spacing: 3) {
            Text(value).font(.headline.monospacedDigit()).minimumScaleFactor(0.65)
            Text(title).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity)
    }
}

private struct TradeRow: View {
    let trade: Trade
    let currentUserID: String?

    private var giving: [TradeCard] {
        trade.cards.filter { $0.side == (trade.senderId == currentUserID ? "sender" : "receiver") }
    }
    private var receiving: [TradeCard] {
        trade.cards.filter { $0.side == (trade.senderId == currentUserID ? "receiver" : "sender") }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label(trade.status.capitalized, systemImage: statusIcon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(statusColor)
                Spacer()
                Text(relativeDate(trade.updatedAt)).font(.caption).foregroundStyle(.secondary)
            }
            HStack {
                Text("Give \(giving.reduce(0) { $0 + $1.quantity })")
                Image(systemName: "arrow.right")
                Text("Receive \(receiving.reduce(0) { $0 + $1.quantity })")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if let message = trade.message, !message.isEmpty { Text(message).font(.caption).lineLimit(1) }
        }
        .padding(.vertical, 4)
    }

    private var statusIcon: String {
        switch trade.status { case "accepted": "checkmark.circle.fill"; case "declined": "xmark.circle.fill"; default: "clock.fill" }
    }
    private var statusColor: Color {
        switch trade.status { case "accepted": .green; case "declined": .red; default: .orange }
    }
    private func relativeDate(_ raw: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: raw) else { return raw }
        return date.formatted(.relative(presentation: .named))
    }
}

private struct TradeDetailView: View {
    let trade: Trade
    let action: (String) async -> Void
    @EnvironmentObject private var environmentStore: EnvironmentStore

    var body: some View {
        List {
            Section {
                LabeledContent("Status", value: trade.status.capitalized)
                if let message = trade.message { Text(message) }
            }
            TradeSideSection(title: "Sender Gives", cards: trade.cards.filter { $0.side == "sender" })
            TradeSideSection(title: "Receiver Gives", cards: trade.cards.filter { $0.side == "receiver" })
            if trade.status == "pending", trade.receiverId == environmentStore.currentUser?.id {
                Section {
                    Button("Accept Trade") { Task { await action("accept") } }.foregroundStyle(.green)
                    Button("Decline Trade", role: .destructive) { Task { await action("decline") } }
                }
            }
        }
        .navigationTitle("Trade")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct TradeSideSection: View {
    let title: String
    let cards: [TradeCard]

    var body: some View {
        Section(title) {
            ForEach(cards) { card in
                HStack {
                    VStack(alignment: .leading) {
                        Text(card.name)
                        GameBadge(tcg: card.tcg)
                    }
                    Spacer()
                    Text("×\(card.quantity)")
                    if let value = card.estimatedValue { Text(value.priceText).foregroundStyle(.secondary) }
                }
            }
        }
    }
}

private struct TradeMatchesSheet: View {
    let matches: [TradeMatch]
    let onSelect: (TradeMatch) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List(matches) { match in
                Button { dismiss(); onSelect(match) } label: {
                    VStack(alignment: .leading, spacing: 7) {
                        HStack {
                            Text(match.username ?? "Collector").font(.headline).foregroundStyle(.primary)
                            Spacer()
                            Text("\(match.matchScore, specifier: "%.0f")% match")
                                .font(.caption.weight(.semibold)).foregroundStyle(.tint)
                        }
                        Text("You offer \(match.youHave.count) · They offer \(match.theyHave.count)")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Suggested Matches")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
        }
    }
}

private struct ProposeTradeSheet: View {
    let match: TradeMatch
    let onPropose: (String?) async -> Bool
    @Environment(\.dismiss) private var dismiss
    @State private var message = ""
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section("You Give") { ForEach(match.youHave) { Text($0.name) } }
                Section("You Receive") { ForEach(match.theyHave) { Text($0.name) } }
                Section("Message") { TextField("Optional note", text: $message, axis: .vertical) }
            }
            .navigationTitle("Propose Trade")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Sending…" : "Send") {
                        Task {
                            isSaving = true
                            let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
                            if await onPropose(trimmed.isEmpty ? nil : trimmed) { dismiss() } else { isSaving = false }
                        }
                    }
                    .disabled(isSaving || match.youHave.isEmpty)
                }
            }
        }
    }
}

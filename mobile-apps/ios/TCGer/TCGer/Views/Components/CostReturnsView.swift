import SwiftUI

struct PurchasePerformanceLot: Identifiable, Sendable {
    let id: String
    let cardName: String
    let tcg: String
    let setName: String?
    let imageURL: String?
    let paidAmount: Double
    let paidCurrency: String
    let purchasedAt: Date?
    let source: String?
    let currentValue: Double?
    let currentCurrency: String
}

struct CostBasisCoverage: Sendable {
    let totalCopies: Int
    let costedCopies: Int
    let cardsMissingCosts: Int
    let untrackedMarketValue: Double

    var fraction: Double {
        totalCopies > 0 ? Double(costedCopies) / Double(totalCopies) : 0
    }
}

struct CostReturnsView: View {
    let lots: [PurchasePerformanceLot]
    let displayCurrency: String
    let coverage: CostBasisCoverage

    @State private var rates: [String: Decimal] = [:]
    @State private var isLoadingRates = true
    @State private var rateMessage: String?

    private struct RateRequest: Hashable, Sendable {
        let key: String
        let source: String
        let date: Date?
    }

    fileprivate struct ConvertedLot: Identifiable {
        let lot: PurchasePerformanceLot
        let paid: Double
        let current: Double

        var id: String { lot.id }
        var gain: Double { current - paid }
        var percent: Double? { paid > 0 ? gain / paid * 100 : nil }
    }

    private var convertedLots: [ConvertedLot] {
        lots.compactMap { lot in
            guard let currentValue = lot.currentValue else { return nil }
            guard let paid = converted(
                lot.paidAmount,
                from: lot.paidCurrency,
                on: lot.purchasedAt
            ), let current = converted(
                currentValue,
                from: lot.currentCurrency,
                on: nil
            ) else { return nil }
            return ConvertedLot(lot: lot, paid: paid, current: current)
        }
        .sorted { $0.gain > $1.gain }
    }

    private var totalPaid: Double {
        convertedLots.reduce(0) { $0 + $1.paid }
    }

    private var totalValue: Double {
        convertedLots.reduce(0) { $0 + $1.current }
    }

    private var totalGain: Double { totalValue - totalPaid }

    private var totalPercent: Double? {
        totalPaid > 0 ? totalGain / totalPaid * 100 : nil
    }

    var body: some View {
        List {
            Section("Cost-basis completeness") {
                ProgressView(value: coverage.fraction) {
                    Text("\((coverage.fraction * 100).formatted(.number.precision(.fractionLength(0))))% complete")
                }
                LabeledContent("Copies costed", value: "\(coverage.costedCopies) of \(coverage.totalCopies)")
                LabeledContent("Card rows missing costs", value: "\(coverage.cardsMissingCosts)")
                LabeledContent(
                    "Value without cost basis",
                    value: Decimal(coverage.untrackedMarketValue).formatted(.currency(code: "USD"))
                )
            }

            Section {
                HStack {
                    CostReturnStat(
                        title: "Paid",
                        value: formatted(totalPaid)
                    )
                    Divider()
                    CostReturnStat(
                        title: "Value",
                        value: formatted(totalValue)
                    )
                    Divider()
                    CostReturnStat(
                        title: "Return",
                        value: signed(totalGain),
                        color: totalGain >= 0 ? .green : .red
                    )
                }
                .padding(.vertical, 6)

                if let totalPercent {
                    LabeledContent("Portfolio return") {
                        Text(totalPercent, format: .percent.precision(.fractionLength(1)).scale(1))
                            .foregroundStyle(totalPercent >= 0 ? Color.green : Color.red)
                    }
                }
            }

            if isLoadingRates {
                Section {
                    HStack {
                        Spacer()
                        ProgressView("Converting purchase costs…")
                        Spacer()
                    }
                }
            }

            if let rateMessage {
                Section {
                    Text(rateMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            if lots.isEmpty {
                ContentUnavailableView(
                    "No Purchase Costs",
                    systemImage: "cart",
                    description: Text("Add purchase details to a card to compare its cost with its current value.")
                )
            } else if !isLoadingRates && convertedLots.isEmpty {
                ContentUnavailableView(
                    "Returns Unavailable",
                    systemImage: "coloncurrencysign.arrow.trianglehead.2.clockwise.rotate.90",
                    description: Text("Current card prices or the required exchange rates could not be loaded.")
                )
            } else {
                Section("Cards") {
                    ForEach(convertedLots) { item in
                        CostReturnRow(item: item, displayCurrency: displayCurrency)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Cost & Returns")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: rateTaskID) {
            await loadRates()
        }
    }

    private var rateTaskID: String {
        let currencies = lots.flatMap { [$0.paidCurrency, $0.currentCurrency] }.sorted().joined()
        return "\(displayCurrency):\(lots.count):\(currencies)"
    }

    private func converted(_ amount: Double, from source: String, on date: Date?) -> Double? {
        let source = source.uppercased()
        guard source != displayCurrency.uppercased() else { return amount }
        let key = rateKey(source: source, date: date)
        guard let rate = rates[key] else { return nil }
        return NSDecimalNumber(decimal: Decimal(amount) * rate).doubleValue
    }

    private func rateKey(source: String, date: Date?) -> String {
        let day = date.map { Self.dayFormatter.string(from: $0) } ?? "latest"
        return "\(source.uppercased()):\(displayCurrency.uppercased()):\(day)"
    }

    @MainActor
    private func loadRates() async {
        let requests = Set(lots.flatMap { lot -> [RateRequest] in
            var result = [RateRequest(
                key: rateKey(source: lot.paidCurrency, date: lot.purchasedAt),
                source: lot.paidCurrency,
                date: lot.purchasedAt
            )]
            if lot.currentValue != nil {
                result.append(RateRequest(
                    key: rateKey(source: lot.currentCurrency, date: nil),
                    source: lot.currentCurrency,
                    date: nil
                ))
            }
            return result
        }.filter { $0.source.uppercased() != displayCurrency.uppercased() })

        guard !requests.isEmpty else {
            rates = [:]
            let missingPrices = lots.count - lots.filter { $0.currentValue != nil }.count
            rateMessage = missingPrices > 0
                ? "Missing \(missingPrices) current price\(missingPrices == 1 ? "" : "s"), so some cards are omitted."
                : nil
            isLoadingRates = false
            return
        }

        isLoadingRates = true
        var loaded: [String: Decimal] = [:]
        let queue = Array(requests)
        await withTaskGroup(of: (String, Decimal?).self) { group in
            var nextIndex = 0
            for _ in 0..<min(4, queue.count) {
                let request = queue[nextIndex]
                nextIndex += 1
                group.addTask { await Self.fetch(request, destination: displayCurrency) }
            }
            while let result = await group.next() {
                if let rate = result.1 { loaded[result.0] = rate }
                if nextIndex < queue.count {
                    let request = queue[nextIndex]
                    nextIndex += 1
                    group.addTask { await Self.fetch(request, destination: displayCurrency) }
                }
            }
        }
        rates = loaded
        let missing = requests.count - loaded.count
        let missingPrices = lots.count - lots.filter { $0.currentValue != nil }.count
        if missing > 0 || missingPrices > 0 {
            var omissions: [String] = []
            if missing > 0 {
                omissions.append("\(missing) exchange rate\(missing == 1 ? "" : "s")")
            }
            if missingPrices > 0 {
                omissions.append("\(missingPrices) current price\(missingPrices == 1 ? "" : "s")")
            }
            rateMessage = "Missing \(omissions.joined(separator: " and ")), so some cards are omitted."
        } else {
            rateMessage = nil
        }
        isLoadingRates = false
    }

    private static func fetch(
        _ request: RateRequest,
        destination: String
    ) async -> (String, Decimal?) {
        do {
            let result = try await CurrencyConverter.shared.rate(
                from: request.source,
                to: destination,
                on: request.date
            )
            return (request.key, result.exchangeRate.rate)
        } catch {
            return (request.key, nil)
        }
    }

    private func formatted(_ value: Double) -> String {
        Decimal(value).formatted(.currency(code: displayCurrency))
    }

    private func signed(_ value: Double) -> String {
        let amount = formatted(abs(value))
        return "\(value >= 0 ? "+" : "−")\(amount)"
    }

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
}

private struct CostReturnStat: View {
    let title: String
    let value: String
    var color: Color = .primary

    var body: some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.headline.monospacedDigit())
                .foregroundStyle(color)
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct CostReturnRow: View {
    let item: CostReturnsView.ConvertedLot
    let displayCurrency: String

    var body: some View {
        HStack(spacing: 12) {
            CachedAsyncImage(
                url: item.lot.imageURL.flatMap(URL.init(string:)),
                tcg: item.lot.tcg
            ) { phase in
                if case .success(let image) = phase {
                    image.resizable().scaledToFit()
                } else {
                    Color(.tertiarySystemFill)
                }
            }
            .frame(width: 38, height: 52)
            .clipShape(TradingCardShape())

            VStack(alignment: .leading, spacing: 4) {
                Text(item.lot.cardName)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(1)
                Text(purchaseSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if let source = item.lot.source, !source.isEmpty {
                    Text(source)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 3) {
                Text(Decimal(item.current).formatted(.currency(code: displayCurrency)))
                    .font(.subheadline.weight(.semibold).monospacedDigit())
                Text(signedGain)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(item.gain >= 0 ? Color.green : Color.red)
                if let percent = item.percent {
                    Text(percent, format: .percent.precision(.fractionLength(1)).scale(1))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 3)
    }

    private var purchaseSummary: String {
        let paid = Decimal(item.lot.paidAmount).formatted(.currency(code: item.lot.paidCurrency))
        guard let date = item.lot.purchasedAt else { return "Paid \(paid)" }
        return "Paid \(paid) · \(date.formatted(date: .abbreviated, time: .omitted))"
    }

    private var signedGain: String {
        let value = Decimal(abs(item.gain)).formatted(.currency(code: displayCurrency))
        return "\(item.gain >= 0 ? "+" : "−")\(value)"
    }
}

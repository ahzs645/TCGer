import Foundation

struct GradingHistoryPoint: Codable, Identifiable {
    var date: String
    var price: Double
    var id: String { date }
}
struct GradingOutcome: Codable, Identifiable {
    var key: String
    var label: String
    var grade: Double?
    var price: Double?
    var population: Int?
    var salesCount: Int?
    var confidence: String?
    var source: String
    var history: [GradingHistoryPoint]
    var id: String { key }
    static func blank(_ grader: String) -> [Self] {
        var grades = (1...10).map(Double.init)
        if ["BGS", "CGC"].contains(grader) { grades += (1...9).map { Double($0) + 0.5 } }
        let specialty = grader == "BGS" ? ["pristine", "perfect"] : grader == "CGC" ? ["pristine"] : []
        return specialty.map { Self(key: "\(grader.lowercased())\($0)", label: "\(grader) \($0)", source: "manual", history: []) } + grades.sorted(by: >).map {
            let label = $0.truncatingRemainder(dividingBy: 1) == 0 ? String(Int($0)) : String($0)
            return Self(key: "\(grader.lowercased())\(label)", label: "\(grader) \(label)", grade: $0, source: "manual", history: [])
        }
    }
}
struct GradingSnapshot: Codable {
    struct Grader: Codable { let grader: String; let gemRate: Double?; let outcomes: [GradingOutcome] }
    struct RawQuote: Codable { let printing: String; let condition: String; let price: Double }
    let tcgPlayerId: String
    let name: String
    let setName: String
    let collectorNumber: String
    let currency: String
    let source: String
    let sourceUrl: String
    let retrievedAt: String
    let priceAsOf: String?
    let warnings: [String]
    let graders: [Grader]
    let rawQuotes: [RawQuote]
}
struct GradingSnapshotRequest: Encodable { let tcgPlayerId: String; let language: String }
struct GradingScenario: Codable {
    var rawValue: Double
    var costs: [String: Double]
    var outcomes: [GradingOutcome]
    var interpolate: Bool
    static let costFields = [
        ("grading", "Grading fee"), ("shipping", "Round-trip shipping"), ("insurance", "Insurance"),
        ("upcharge", "Possible upcharge"), ("sellingFeePercent", "Graded selling fee (%)"),
        ("sellingFixed", "Graded fixed selling cost"), ("rawSellingFeePercent", "Raw selling fee (%)"),
        ("rawSellingFixed", "Raw fixed selling cost")
    ]
    struct Row: Identifiable {
        let outcome: GradingOutcome
        let price: Double?
        let estimated: Bool
        let gain: Double?
        let probability: Double?
        var id: String { outcome.key }
    }
    struct Result {
        let totalCost: Double
        let rawNet: Double
        let population: Int
        let pricedPopulation: Int
        let expectedValue: Double?
        let expectedGain: Double?
        let verdict: String
        let breakEven: String?
        let rows: [Row]
    }
    func calculate() -> Result? {
        guard rawValue.isFinite, rawValue >= 0, rawValue <= 100_000_000,
              Set(outcomes.map(\.key)).count == outcomes.count,
              costs.allSatisfy({ $0.value.isFinite && $0.value >= 0 && $0.value <= ($0.key.hasSuffix("Percent") ? 100 : 100_000_000) }),
              outcomes.allSatisfy({ ($0.price == nil || ($0.price!.isFinite && $0.price! >= 0 && $0.price! <= 100_000_000)) && (0...1_000_000_000).contains($0.population ?? 0) }) else { return nil }
        func cost(_ key: String) -> Double { costs[key] ?? 0 }
        let totalCost = cost("grading") + cost("shipping") + cost("insurance") + cost("upcharge")
        let rawNet = rawValue * (1 - cost("rawSellingFeePercent") / 100) - cost("rawSellingFixed")
        let population = outcomes.reduce(0) { $0 + ($1.population ?? 0) }
        let anchors = outcomes.filter { $0.grade != nil && ($0.price ?? 0) > 0 }.sorted { $0.grade! < $1.grade! }
        let rows = outcomes.map { outcome -> Row in
            var price = outcome.price
            var estimated = false
            if price == nil, interpolate, let grade = outcome.grade,
               let lower = anchors.last(where: { $0.grade! < grade }),
               let upper = anchors.first(where: { $0.grade! > grade }) {
                let position = (grade - lower.grade!) / (upper.grade! - lower.grade!)
                price = exp(log(lower.price!) + position * log(upper.price! / lower.price!))
                estimated = true
            }
            return Row(outcome: outcome, price: price, estimated: estimated,
                gain: price.map { $0 * (1 - cost("sellingFeePercent") / 100) - cost("sellingFixed") - totalCost - rawNet },
                probability: population > 0 ? Double(outcome.population ?? 0) / Double(population) : nil)
        }
        let pricedPopulation = rows.reduce(0) { $0 + ($1.price == nil ? 0 : $1.outcome.population ?? 0) }
        let complete = population > 0 && pricedPopulation == population
        let value: Double? = complete ? rows.reduce(0) { $0 + ($1.price ?? 0) * ($1.probability ?? 0) } : nil
        let gain: Double? = complete ? rows.reduce(0) { $0 + ($1.gain ?? 0) * ($1.probability ?? 0) } : nil
        let verdict = gain.map { abs($0) <= max(0.01, rawValue * 0.2) ? "borderline" : $0 > 0 ? "grade" : "keep" } ?? "insufficient"
        let breakEven = rows.filter { $0.outcome.grade != nil && ($0.gain ?? 0) > 0 }.sorted { $0.outcome.grade! < $1.outcome.grade! }.first?.outcome.label
        return Result(totalCost: totalCost, rawNet: rawNet, population: population, pricedPopulation: pricedPopulation, expectedValue: value, expectedGain: gain, verdict: verdict, breakEven: breakEven, rows: rows)
    }
}

struct GradingExpense: Codable, Identifiable {
    let id: String
    let cardName: String
    let grader: String
    let serviceTier: String
    let currency: String
    let paidAt: String
    let grading: Double
    let shipping: Double
    let insurance: Double
    let upcharge: Double
    var total: Double { grading + shipping + insurance + upcharge }
}

struct GradingSearchRequest: Encodable { let search: String; let language: String }
struct GradingSearchResult: Decodable {
    struct Card: Decodable, Identifiable {
        let tcgPlayerId: String; let name: String; let setName: String; let collectorNumber: String
        var id: String { tcgPlayerId }
    }
    let cards: [Card]
}

import SwiftUI

struct GradingWorkspaceView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @AppStorage("tcger.grading-workspace.v1") private var savedDraft = ""
    @AppStorage("tcger.grading-workspace.v1.expenses") private var savedExpenses = "[]"
    @State private var matches: [GradingSearchResult.Card] = []
    @State private var expenses: [GradingExpense] = []
    @State private var serviceTier = ""
    @State private var byGrader: [String: [GradingOutcome]] = [:]
    @State private var name = ""
    @State private var productId = ""
    @State private var language = "english"
    @State private var grader = "PSA"
    @State private var currency = "USD"
    @State private var raw = ""
    @State private var costs: [String: Double] = [:]
    @State private var outcomes = GradingOutcome.blank("PSA")
    @State private var interpolate = false
    @State private var snapshot: GradingSnapshot?
    @State private var section = "Decision"
    @State private var busy = false
    @State private var message: String?
    @State private var restored = false

    private struct Draft: Codable { let name: String; let grader: String; let currency: String; let scenario: GradingScenario; let serviceTier: String?; let snapshot: GradingSnapshot? }
    private var scenario: GradingScenario? {
        guard let value = Double(raw) else { return nil }
        return GradingScenario(rawValue: value, costs: costs, outcomes: outcomes, interpolate: interpolate)
    }
    private var result: GradingScenario.Result? { scenario?.calculate() }
    private var graders: [String] { Array(Set(["PSA", "BGS", "CGC", "SGC", "ACE", "TAG", "HGA", "ARS"] + (snapshot?.graders.map(\.grader) ?? []))).sorted() }
    private func money(_ value: Double?) -> String { value?.formatted(.currency(code: currency)) ?? "Unavailable" }
    private var headline: String {
        switch result?.verdict {
        case "grade": return "Worth grading under these assumptions"
        case "keep": return "Keep it raw under these assumptions"
        case "borderline": return "Borderline — close to break-even"
        case "insufficient": return "More data needed for an expected-value verdict"
        default: return "Enter a raw value and valid nonnegative amounts"
        }
    }
    var body: some View {
        Form {
            identitySection
            Section {
                Picker("View", selection: $section) { ForEach(["Decision", "Costs", "Population", "History", "Receipts"], id: \.self) { Text($0) } }
            }
            switch section {
            case "Costs": costsSection
            case "Population": populationSection
            case "History": historySection
            case "Receipts": receiptsSection
            default: decisionSection
            }
            Section {
                Button("Save scenario on this device") { save() }.disabled(result == nil)
                Button("Clear market data") { snapshot = nil; byGrader = [:]; outcomes = GradingOutcome.blank(grader); raw = ""; message = "Manual mode. Enter prices in your selected currency." }
                Text("Scenarios are saved on this device. They do not change collection cost basis.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Grading planner")
        .accessibilityIdentifier("feature.pricing.gradingWorkspace")
        .task { restore() }
    }
    private var identitySection: some View {
        Section("Card and market data") {
            TextField("Card / scenario", text: $name)
            Button("Find Pokémon card by name") { Task { await search() } }.disabled(busy || name.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
            ForEach(matches) { match in
                Button("\(match.name) · \(match.setName) · \(match.collectorNumber)") {
                    productId = match.tcgPlayerId; name = "\(match.name) · \(match.setName) · \(match.collectorNumber)"
                    matches = []; snapshot = nil; byGrader = [:]; outcomes = GradingOutcome.blank(grader); raw = ""
                    message = "Card selected. Load market data to see its grade prices."
                }
            }
            TextField("Pokémon TCGplayer product ID", text: $productId).keyboardType(.numberPad)
            Picker("Card language", selection: $language) { Text("English").tag("english"); Text("Japanese").tag("japanese") }
            Button(busy ? "Loading…" : "Load market data") { Task { await load() } }.disabled(busy || productId.isEmpty || !productId.allSatisfy(\.isNumber))
            if let message { Text(message).font(.caption) }
            if let snapshot {
                Text("\(snapshot.name) · \(snapshot.setName) · \(snapshot.collectorNumber)")
                if let url = URL(string: snapshot.sourceUrl) { Link(snapshot.source, destination: url) }
                Text("Retrieved \(snapshot.retrievedAt) · Source updated \(snapshot.priceAsOf ?? "date unavailable")").font(.caption)
                Text("Check the matched card and printing. Sale counts are lifetime counts, not recent volume.").font(.caption)
                ForEach(snapshot.warnings, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
            }
            Picker("Grader", selection: Binding(get: { grader }, set: { value in
                byGrader[grader] = outcomes
                grader = value
                outcomes = byGrader[value] ?? snapshot?.graders.first(where: { $0.grader == value })?.outcomes ?? GradingOutcome.blank(value)
            })) { ForEach(graders, id: \.self) { Text($0) } }

            Picker("Currency", selection: $currency) { ForEach(["USD", "CAD", "EUR", "GBP"], id: \.self) { Text($0) } }.disabled(snapshot != nil)
            TextField("Raw value (\(currency))", text: $raw).keyboardType(.decimalPad).accessibilityIdentifier("grading.raw")
            if let snapshot, !snapshot.rawQuotes.isEmpty {
                Menu("Use raw printing / condition price") {
                    ForEach(Array(snapshot.rawQuotes.enumerated()), id: \.offset) { _, quote in
                        Button("\(quote.printing) · \(quote.condition) · \(money(quote.price))") { raw = String(quote.price) }
                    }
                }
            }
        }
    }
    private var decisionSection: some View {
        Group {
            Section("Decision") {
                Text(headline).font(.headline).accessibilityIdentifier("grading.verdict")
                if let result {
                    LabeledContent("Expected gain over raw", value: money(result.expectedGain))
                    LabeledContent("Expected graded value", value: money(result.expectedValue))
                    LabeledContent("Submission cost", value: money(result.totalCost))
                    LabeledContent("Lowest priced grade beating raw", value: result.breakEven ?? "None")
                    Text("Priced population: \(result.pricedPopulation) / \(result.population)")
                }
                Text("These are scenarios, not a prediction of your copy’s grade. Submitted-card populations are selective. Inspect centering, corners, edges, and surfaces.").font(.caption)
                Toggle("Estimate between known numeric grades", isOn: $interpolate)
            }
            Section("Prices and scenario weights") {
                Text("Leave unknown values blank. Weight zero excludes an outcome from your scenario.").font(.caption)
                ForEach($outcomes) { $outcome in
                    GradingOutcomeEditor(outcome: $outcome, currency: currency, computed: result?.rows.first(where: { $0.id == outcome.id }))
                }
            }
        }
    }
    private var costsSection: some View {
        Section("Costs per card (\(currency))") {
            TextField("Service tier / quote reference", text: $serviceTier)
            Text("Enter your service quote; no current fee is assumed. Changing currency does not convert amounts.").font(.caption)
            ForEach(GradingScenario.costFields, id: \.0) { key, label in
                HStack {
                    Text(label)
                    TextField(label, value: Binding(get: { costs[key] ?? 0 }, set: { costs[key] = $0 }), format: .number)
                        .keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                }
            }
            Text("Compare service tiers by changing the quote. Use a unique card/copy label above. Record paid submission costs below to keep a separate receipt.").font(.caption)
            Button("Record these submission costs as paid") { recordExpense() }.disabled(name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || (result?.totalCost ?? 0) <= 0)
            Text("Receipts are local records; they do not automatically change collection acquisition cost or sale cost basis.").font(.caption)
        }
    }
    private var populationSection: some View {
        Section("Population and scenario weights") {
            Text("Weighted outcomes: \(result?.population ?? 0)")
            if let result, result.population < 50 { Text("Low data: fewer than 50 weighted outcomes.") }
            if let gem = snapshot?.graders.first(where: { $0.grader == grader })?.gemRate { LabeledContent("Provider gem rate", value: gem.formatted(.percent.precision(.fractionLength(1)))) }
            else { Text("Provider gem rate unavailable") }
            ForEach(result?.rows ?? []) { row in
                VStack(alignment: .leading) {
                    Text("\(row.outcome.label): \(row.outcome.population.map(String.init) ?? "unknown") · \(row.probability?.formatted(.percent.precision(.fractionLength(1))) ?? "unknown")")
                    ProgressView(value: row.probability ?? 0)
                }
            }
            Text("Edited weights are your scenario, not the provider’s population. All weighted outcomes need prices for an expected-value verdict.").font(.caption)
        }
    }
    private var historySection: some View {
        Section("Graded sales history (USD)") {
            Text("Dated eBay sales averages. Editing a current estimate does not alter historical data.").font(.caption)
            if !outcomes.contains(where: { !$0.history.isEmpty }) { Text("No graded history available. Load market data to check coverage.") }
            ForEach(outcomes.filter { !$0.history.isEmpty }) { row in
                DisclosureGroup("\(row.label) · \(row.history.count) observations") {
                    ForEach(row.history) { point in LabeledContent(point.date, value: point.price.formatted(.currency(code: "USD"))) }
                }
            }
        }
    }
    private var receiptsSection: some View {
        Section("Actual submission expenses") {
            Text("Local receipts by card/copy, separate from collection cost basis.").font(.caption)
            if expenses.isEmpty { Text("No recorded grading expenses.") }
            ForEach(expenses) { expense in
                VStack(alignment: .leading, spacing: 5) {
                    Text("\(expense.cardName) · \(expense.grader)").font(.headline)
                    Text("\(expense.serviceTier) · \(expense.paidAt.prefix(10))")
                    Text(expense.total.formatted(.currency(code: expense.currency)))
                    Text("Grading \(expense.grading) · Shipping \(expense.shipping) · Insurance \(expense.insurance) · Upcharge \(expense.upcharge) (\(expense.currency))").font(.caption)
                    Button("Delete receipt", role: .destructive) { expenses.removeAll { $0.id == expense.id }; persistExpenses() }
                }
            }
        }
    }
    private func persistExpenses() {
        if let data = try? JSONEncoder().encode(expenses), let value = String(data: data, encoding: .utf8) { savedExpenses = value; message = "Expense records saved on this device." }
    }
    private func recordExpense() {
        guard result != nil else { return }
        expenses.insert(GradingExpense(id: UUID().uuidString, cardName: name, grader: grader, serviceTier: serviceTier, currency: currency, paidAt: ISO8601DateFormatter().string(from: Date()), grading: costs["grading"] ?? 0, shipping: costs["shipping"] ?? 0, insurance: costs["insurance"] ?? 0, upcharge: costs["upcharge"] ?? 0), at: 0)
        persistExpenses()
    }
    @MainActor private func search() async {
        guard !environmentStore.serverConfiguration.isOnDevice, let token = environmentStore.authToken else { message = "Connect and sign in to search market data. Manual calculations work offline."; return }
        busy = true; matches = []; message = nil
        defer { busy = false }
        do {
            let result = try await APIService().searchGradingCards(config: environmentStore.serverConfiguration, token: token, request: .init(search: name, language: language))
            guard !Task.isCancelled else { return }
            matches = result.cards
            if matches.isEmpty { message = "No matching cards. Try a different name or enter manual estimates." }
        } catch is CancellationError { } catch { message = error.localizedDescription }
    }
    @MainActor private func load() async {
        guard !environmentStore.serverConfiguration.isOnDevice, let token = environmentStore.authToken else {
            message = "Connect and sign in to load market data. Manual calculations work offline."; return
        }
        busy = true; message = nil
        defer { busy = false }
        do {
            let loaded = try await APIService().getGradingSnapshot(config: environmentStore.serverConfiguration, token: token, request: .init(tcgPlayerId: productId, language: language))
            guard !Task.isCancelled else { return }
            snapshot = loaded; name = "\(loaded.name) · \(loaded.setName) · \(loaded.collectorNumber)"
            if currency != "USD" { costs = [:] }
            currency = "USD"; raw = ""; byGrader = [:]
            outcomes = loaded.graders.first(where: { $0.grader == grader })?.outcomes ?? GradingOutcome.blank(grader)
            message = "Loaded in USD. Select your raw printing and condition, and review your USD costs."
        } catch is CancellationError { } catch { message = error.localizedDescription }
    }
    private func save() {
        guard let scenario, scenario.calculate() != nil,
              let data = try? JSONEncoder().encode(Draft(name: name, grader: grader, currency: currency, scenario: scenario, serviceTier: serviceTier, snapshot: snapshot)),
              let value = String(data: data, encoding: .utf8) else { return }
        savedDraft = value; message = "Scenario saved on this device."
    }
    private func restore() {
        guard !restored else { return }; restored = true
        if let data = savedExpenses.data(using: .utf8) { expenses = (try? JSONDecoder().decode([GradingExpense].self, from: data)) ?? [] }
        guard let data = savedDraft.data(using: .utf8), let draft = try? JSONDecoder().decode(Draft.self, from: data), draft.scenario.calculate() != nil else { return }
        serviceTier = draft.serviceTier ?? ""; snapshot = draft.snapshot
        name = draft.name; grader = draft.grader; currency = draft.currency; raw = String(draft.scenario.rawValue)
        costs = draft.scenario.costs; interpolate = draft.scenario.interpolate; outcomes = draft.scenario.outcomes
    }
}

private struct GradingOutcomeEditor: View {
    @Binding var outcome: GradingOutcome
    let currency: String
    let computed: GradingScenario.Row?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(outcome.label).font(.headline)
            TextField("\(outcome.label) value", value: Binding(get: { outcome.price }, set: { outcome.price = $0; outcome.source = "manual"; outcome.confidence = nil }), format: .number).keyboardType(.decimalPad)
                .accessibilityIdentifier("grading.\(outcome.key).price")
            TextField("\(outcome.label) weight / population", value: $outcome.population, format: .number).keyboardType(.numberPad)
                .accessibilityIdentifier("grading.\(outcome.key).weight")
            if let computed {
                if computed.estimated { Text("Estimated \(computed.price?.formatted(.currency(code: currency)) ?? "Unavailable")").font(.caption) }
                Text("Gain vs raw: \(computed.gain?.formatted(.currency(code: currency)) ?? "Unavailable")")
            }
            Text(outcome.source == "manual" ? "Manual estimate" : "\(outcome.salesCount.map(String.init) ?? "Unknown") sales · \(outcome.confidence ?? "confidence unavailable")").font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 4)
    }
}

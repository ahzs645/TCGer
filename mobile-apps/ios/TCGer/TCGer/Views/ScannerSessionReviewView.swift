import SwiftUI
import UIKit

struct ScannerSessionReviewView: View {
    private struct ResultReference: Identifiable {
        let id: CardScanResult.ID
    }

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @ObservedObject var viewModel: CardScannerViewModel

    @State private var selectedResultIDs: Set<CardScanResult.ID>
    @State private var reviewedResult: ResultReference?
    @State private var collections: [Collection] = []
    @State private var selectedBinderID: String?
    @AppStorage("scanner.defaultLanguage") private var defaultLanguage = "English"
    @State private var languageOverrides: [CardScanResult.ID: String] = [:]
    @State private var finishOverrides: [CardScanResult.ID: String] = [:]
    @State private var isLoadingCollections = true
    @State private var isAdding = false
    @State private var isCreatingBinder = false
    @State private var errorMessage: String?

    let color: Color
    let showsPrices: Bool
    let priceQuotes: [CardScanResult.ID: ScannerPriceQuote]
    let totalPriceText: String?
    private let apiService = APIService()

    init(
        viewModel: CardScannerViewModel,
        color: Color,
        showsPrices: Bool,
        priceQuotes: [CardScanResult.ID: ScannerPriceQuote],
        totalPriceText: String?
    ) {
        self.viewModel = viewModel
        self.color = color
        self.showsPrices = showsPrices
        self.priceQuotes = priceQuotes
        self.totalPriceText = totalPriceText
        let resultIDs = Set(viewModel.sessionResults.map(\.id))
        _selectedResultIDs = State(
            initialValue: resultIDs.subtracting(viewModel.addedSessionResultIDs)
        )
    }

    var body: some View {
        NavigationStack {
            Group {
                if viewModel.sessionResults.isEmpty {
                    ContentUnavailableView(
                        "No Scanned Cards",
                        systemImage: "rectangle.stack.badge.minus",
                        description: Text("Return to the scanner to build a card list.")
                    )
                } else {
                    List {
                        Section {
                            summary
                        }

                        Section("Scanned Cards") {
                            ForEach(viewModel.sessionResults) { result in
                                sessionRow(result)
                                    .swipeActions(edge: .trailing) {
                                        Button(role: .destructive) {
                                            viewModel.removeSessionResult(id: result.id)
                                        } label: {
                                            Label("Remove", systemImage: "trash")
                                        }
                                        .disabled(isAdding)
                                    }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Review Scans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .disabled(isAdding || isCreatingBinder)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(selectionButtonTitle) {
                        toggleAllSelection()
                    }
                    .disabled(availableResultIDs.isEmpty || isAdding)
                }
            }
            .safeAreaBar(edge: .bottom) {
                if !viewModel.sessionResults.isEmpty {
                    binderActionBar
                }
            }
            .scrollEdgeEffectStyle(.soft, for: .bottom)
        }
        .interactiveDismissDisabled(isAdding || isCreatingBinder)
        .task { await loadCollections() }
        .onChange(of: viewModel.sessionResults.map(\.id), initial: false) { _, ids in
            selectedResultIDs.formIntersection(ids)
            selectedResultIDs.subtract(viewModel.addedSessionResultIDs)
        }
        .sheet(item: $reviewedResult) { reference in
            ScannerMatchPickerView(
                viewModel: viewModel,
                resultID: reference.id,
                color: color
            )
            .presentationDetents([.large])
        }
        .alert(
            "Scan Review Error",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "An unknown error occurred.")
        }
    }

    private var summary: some View {
        HStack(spacing: 0) {
            summaryMetric(value: "\(viewModel.sessionResults.count)", label: "Scanned")
            Divider().frame(height: 34)
            summaryMetric(value: "\(selectedResultIDs.count)", label: "Selected")
            Divider().frame(height: 34)
            summaryMetric(value: "\(viewModel.addedSessionResultIDs.count)", label: "Added")
            if showsPrices {
                Divider().frame(height: 34)
                summaryMetric(value: totalPriceText ?? "—", label: "Value")
            }
        }
        .padding(.vertical, 6)
    }

    private func summaryMetric(value: String, label: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.65)
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func sessionRow(_ result: CardScanResult) -> some View {
        let wasAdded = viewModel.addedSessionResultIDs.contains(result.id)
        let isSelected = selectedResultIDs.contains(result.id)

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
            Button {
                toggleSelection(for: result.id)
            } label: {
                Image(systemName: wasAdded ? "checkmark.seal.fill" : isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(wasAdded ? Color.green : isSelected ? color : Color.secondary)
                    .frame(width: 32, height: 44)
            }
            .buttonStyle(.plain)
            .disabled(wasAdded || isAdding)
            .accessibilityLabel(wasAdded ? "Already added" : isSelected ? "Deselect card" : "Select card")

            Button {
                reviewedResult = ResultReference(id: result.id)
            } label: {
                HStack(spacing: 12) {
                    Image(uiImage: UIImage(cgImage: result.capturedImage))
                        .resizable()
                        .scaledToFill()
                        .frame(width: 48, height: 68)
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    VStack(alignment: .leading, spacing: 4) {
                        Text(result.primary.details.identity.name)
                            .font(.headline)
                            .foregroundStyle(.primary)
                            .lineLimit(1)

                        Text(result.primary.details.identity.setName
                            ?? result.primary.details.identity.setCode
                            ?? result.mode.displayName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)

                        HStack(spacing: 5) {
                            Text(result.primary.confidence.score, format: .percent.precision(.fractionLength(0)))
                                .monospacedDigit()
                            Text("match")
                            if showsPrices {
                                Text("·")
                                Text(priceText(for: result))
                                    .monospacedDigit()
                            }
                            if wasAdded {
                                Text("· Added")
                                    .foregroundStyle(.green)
                            }
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(color)
                    }

                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Review match for \(result.primary.details.identity.name)")
            .accessibilityHint("Shows up to five best card matches")
            }

            HStack(spacing: 8) {
                Menu {
                    ForEach(CardLanguage.supportedNames, id: \.self) { optionLanguage in
                        Button {
                            languageOverrides[result.id] = optionLanguage
                        } label: {
                            if optionLanguage == language(for: result) {
                                Label(optionLanguage, systemImage: "checkmark")
                            } else {
                                Text(optionLanguage)
                            }
                        }
                    }
                } label: {
                    Label(language(for: result), systemImage: "character.book.closed")
                        .font(.caption.weight(.medium))
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(wasAdded || isAdding)

                if !finishOptions(for: result).isEmpty {
                    Menu {
                        Button {
                            finishOverrides[result.id] = ""
                        } label: {
                            if finishCode(for: result) == nil {
                                Label("Unspecified", systemImage: "checkmark")
                            } else {
                                Text("Unspecified")
                            }
                        }
                        ForEach(finishOptions(for: result), id: \.code) { option in
                            Button {
                                finishOverrides[result.id] = option.code
                            } label: {
                                if finishCode(for: result) == option.code {
                                    Label(option.label, systemImage: "checkmark")
                                } else {
                                    Text(option.label)
                                }
                            }
                        }
                    } label: {
                        Label(finishLabel(for: result), systemImage: "sparkles")
                            .font(.caption.weight(.medium))
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(wasAdded || isAdding)
                }
            }
            .padding(.leading, 44)
        }
    }

    private func priceText(for result: CardScanResult) -> String {
        guard let quote = priceQuotes[result.id] else { return "No price" }
        return quote.price.priceText(currency: quote.currency)
    }

    private var binderActionBar: some View {
        VStack(spacing: 10) {
            if isLoadingCollections {
                ProgressView("Loading binders…")
                    .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            } else {
                BinderPickerSheetButton(
                    binders: collections,
                    selectedBinderId: $selectedBinderID,
                    onCreate: { name, description, colorHex, defaultCondition in
                        await createBinder(
                            name: name,
                            description: description,
                            colorHex: colorHex,
                            defaultCondition: defaultCondition
                        )
                    }
                )
                .binderPickerFieldStyle()
                .disabled(isAdding || isCreatingBinder)
            }

            Button {
                Task { await addSelectedCards() }
            } label: {
                HStack {
                    if isAdding {
                        ProgressView().tint(.white)
                    }
                    Text(addButtonTitle)
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(color)
            .controlSize(.large)
            .disabled(selectedResultIDs.isEmpty || selectedBinderID == nil || isAdding || isCreatingBinder)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 8)
    }

    private var availableResultIDs: Set<CardScanResult.ID> {
        Set(viewModel.sessionResults.map(\.id)).subtracting(viewModel.addedSessionResultIDs)
    }

    private var selectionButtonTitle: String {
        !availableResultIDs.isEmpty && selectedResultIDs == availableResultIDs ? "Deselect All" : "Select All"
    }

    private var addButtonTitle: String {
        guard !isAdding else { return "Adding Cards…" }
        return "Add \(selectedResultIDs.count) Card\(selectedResultIDs.count == 1 ? "" : "s") to Binder"
    }

    private func toggleSelection(for resultID: CardScanResult.ID) {
        guard !viewModel.addedSessionResultIDs.contains(resultID) else { return }
        if selectedResultIDs.contains(resultID) {
            selectedResultIDs.remove(resultID)
        } else {
            selectedResultIDs.insert(resultID)
        }
    }

    private func toggleAllSelection() {
        if selectedResultIDs == availableResultIDs {
            selectedResultIDs.removeAll()
        } else {
            selectedResultIDs = availableResultIDs
        }
    }

    private func language(for result: CardScanResult) -> String {
        languageOverrides[result.id] ?? defaultLanguage
    }

    private func finishOptions(for result: CardScanResult) -> [PokemonFinishOption] {
        guard let card = makeCard(from: result.primary) else { return [] }
        return PokemonFinishOption.options(for: card)
    }

    private func finishCode(for result: CardScanResult) -> String? {
        guard let value = finishOverrides[result.id], !value.isEmpty else { return nil }
        return value
    }

    private func finishLabel(for result: CardScanResult) -> String {
        guard let code = finishCode(for: result) else { return "Finish" }
        return PokemonFinishOption.label(for: code)
    }

    @MainActor
    private func loadCollections() async {
        guard requestToken != nil else {
            errorMessage = "You need to be logged in before adding cards to a binder."
            isLoadingCollections = false
            return
        }

        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken
            ).sortedForDisplay()
            if let selectedBinderID,
               collections.contains(where: { $0.id == selectedBinderID }) {
                self.selectedBinderID = selectedBinderID
            } else {
                selectedBinderID = collections.first?.id
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoadingCollections = false
    }

    @MainActor
    private func createBinder(
        name: String,
        description: String?,
        colorHex: String?,
        defaultCondition: String?
    ) async {
        guard let token = requestToken else {
            errorMessage = "You need to be logged in before creating a binder."
            return
        }

        isCreatingBinder = true
        defer { isCreatingBinder = false }

        do {
            let collection = try await apiService.createCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name,
                description: description,
                colorHex: colorHex,
                defaultCondition: defaultCondition
            )
            collections.removeAll { $0.id == collection.id }
            collections.append(collection)
            collections = collections.sortedForDisplay()
            selectedBinderID = collection.id
            NotificationCenter.default.post(name: .collectionDidChange, object: collection)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func addSelectedCards() async {
        guard let binderID = selectedBinderID,
              let token = requestToken
        else { return }

        let selectedResults = viewModel.sessionResults.filter { selectedResultIDs.contains($0.id) }
        guard !selectedResults.isEmpty else { return }

        isAdding = true
        var addedIDs: Set<CardScanResult.ID> = []
        defer { isAdding = false }

        for result in selectedResults {
            guard let card = makeCard(from: result.primary) else { continue }
            do {
                try await apiService.addCardToBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: binderID,
                    card: card,
                    details: BinderCardAddDetails(
                        condition: selectedBinder?.defaultCondition ?? CardCondition.nearMint.rawValue,
                        language: language(for: result),
                        isFoil: PokemonFinishOption.isFoil(finishCode(for: result)),
                        variant: CardCopyVariant(
                            finishCode: finishCode(for: result),
                            finishLabel: finishCode(for: result).map(PokemonFinishOption.label(for:)),
                            edition: nil,
                            stamp: nil,
                            isSealedPromo: false,
                            isOversized: false,
                            isPeelOff: false
                        )
                    )
                )
                addedIDs.insert(result.id)
            } catch {
                viewModel.markSessionResultsAdded(addedIDs)
                selectedResultIDs.subtract(addedIDs)
                errorMessage = "Added \(addedIDs.count) of \(selectedResults.count) cards. \(error.localizedDescription)"
                return
            }
        }

        viewModel.markSessionResultsAdded(addedIDs)
        selectedResultIDs.subtract(addedIDs)
        if !addedIDs.isEmpty {
            HapticManager.notification(.success)
        }
    }

    private var selectedBinder: Collection? {
        guard let selectedBinderID else { return nil }
        return collections.first { $0.id == selectedBinderID }
    }

    private var requestToken: String? {
        environmentStore.serverConfiguration.isOnDevice ? (environmentStore.authToken ?? "") : environmentStore.authToken
    }

    private func makeCard(from candidate: CardScanCandidate) -> Card? {
        if let sourceCard = candidate.details.sourceCard {
            return sourceCard
        }

        let details = candidate.details
        guard details.identity.game != .all else { return nil }
        return Card(
            id: details.identity.id,
            name: details.identity.name,
            tcg: details.identity.game.rawValue,
            setCode: details.identity.setCode,
            setName: details.identity.setName,
            rarity: details.rarity,
            imageUrl: details.imageURL?.absoluteString,
            imageUrlSmall: details.imageURL?.absoluteString,
            price: details.price,
            collectorNumber: nil,
            releasedAt: nil
        )
    }
}

private struct ScannerMatchPickerView: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var viewModel: CardScannerViewModel
    let resultID: CardScanResult.ID
    let color: Color

    var body: some View {
        NavigationStack {
            ScrollView {
                if let result {
                    VStack(alignment: .leading, spacing: 20) {
                        capturedCard(result)

                        VStack(alignment: .leading, spacing: 4) {
                            Text("Top Matches")
                                .font(.headline)
                            Text("Choose the card that matches your scan. The first five results are shown.")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        ScrollView(.horizontal, showsIndicators: false) {
                            LazyHStack(alignment: .top, spacing: 12) {
                                ForEach(Array(topCandidates.enumerated()), id: \.element.id) { index, candidate in
                                    candidateButton(candidate, rank: index + 1, result: result)
                                }
                            }
                            .padding(.vertical, 3)
                        }

                    }
                    .padding()
                } else {
                    ContentUnavailableView(
                        "Scan Removed",
                        systemImage: "trash",
                        description: Text("This card is no longer in the scan session.")
                    )
                }
            }
            .navigationTitle("Choose Match")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private var result: CardScanResult? {
        viewModel.sessionResults.first { $0.id == resultID }
    }

    private var topCandidates: [CardScanCandidate] {
        guard let result else { return [] }
        let candidates = [result.primary] + result.alternatives.filter { $0.id != result.primary.id }
        return Array(candidates.sorted { $0.confidence.score > $1.confidence.score }.prefix(5))
    }

    private func capturedCard(_ result: CardScanResult) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(uiImage: UIImage(cgImage: result.capturedImage))
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 112, height: 156)
                .background(Color.black.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 6) {
                Text("Current Match")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(result.primary.details.identity.name)
                    .font(.title3.weight(.semibold))
                Text(result.primary.details.identity.setName
                    ?? result.primary.details.identity.setCode
                    ?? result.mode.displayName)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(result.primary.confidence.score, format: .percent.precision(.fractionLength(0)))
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(color)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func candidateButton(
        _ candidate: CardScanCandidate,
        rank: Int,
        result: CardScanResult
    ) -> some View {
        let isSelected = candidate.id == result.primary.id

        return Button {
            viewModel.selectCandidate(candidate, for: resultID)
            HapticManager.selection()
        } label: {
            VStack(alignment: .leading, spacing: 7) {
                ScanCandidateArtwork(
                    imageURL: candidate.details.imageURL,
                    contentMode: .fill
                )
                    .frame(width: 116, height: 162)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(isSelected ? color : Color.secondary.opacity(0.2), lineWidth: isSelected ? 3 : 1)
                    }
                    .overlay(alignment: .topLeading) {
                        Text("#\(rank)")
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 4)
                            .background(Color.black.opacity(0.65), in: Capsule())
                            .padding(6)
                    }
                    .overlay(alignment: .topTrailing) {
                        if isSelected {
                            Image(systemName: "checkmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, color)
                                .padding(6)
                        }
                    }

                ScanCandidateSummary(
                    candidate: candidate,
                    style: .compact,
                    tint: isSelected ? color : Color.secondary
                )
            }
            .frame(width: 116, alignment: .leading)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            "Match \(rank), \(candidate.details.identity.name), " +
                "\(Int(candidate.confidence.score * 100)) percent"
        )
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

}

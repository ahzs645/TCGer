import SwiftUI
import UIKit

struct BinderPageReviewView: View {
    private struct DetectionReference: Identifiable {
        let id: UUID
    }

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let result: BinderPageScanResult
    let sessionPagesScanned: Int
    let sessionCardsScanned: Int
    let sessionCardsAdded: Int
    let onCardsAdded: (Int) -> Void

    @State private var detections: [BinderCardDetection]
    @State private var selectedDetection: DetectionReference?
    @State private var collections: [Collection] = []
    @State private var selectedBinderID: String?
    @State private var isLoadingCollections = true
    @State private var isAdding = false
    @State private var addedDetectionIDs: Set<UUID> = []
    @State private var errorMessage: String?

    private let apiService = APIService()

    init(
        result: BinderPageScanResult,
        sessionPagesScanned: Int,
        sessionCardsScanned: Int,
        sessionCardsAdded: Int,
        onCardsAdded: @escaping (Int) -> Void
    ) {
        self.result = result
        self.sessionPagesScanned = sessionPagesScanned
        self.sessionCardsScanned = sessionCardsScanned
        self.sessionCardsAdded = sessionCardsAdded
        self.onCardsAdded = onCardsAdded
        _detections = State(initialValue: result.detections)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    sessionSummary
                    pagePreview
                    detectionSummary
                    binderControls
                    actionControls
                }
                .padding()
            }
            .navigationTitle("Binder Page Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .disabled(isAdding)
                }
            }
        }
        .task { await loadCollections() }
        .sheet(item: $selectedDetection) { selection in
            if let index = detections.firstIndex(where: { $0.id == selection.id }) {
                BinderCardDetectionDetailView(
                    detection: $detections[index],
                    game: result.mode.tcgGame
                )
                    .presentationDetents([.medium, .large])
            }
        }
        .alert(
            "Unable to Add Cards",
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

    private var sessionSummary: some View {
        HStack(spacing: 0) {
            summaryMetric(value: sessionPagesScanned, label: "Pages")
            Divider().frame(height: 34)
            summaryMetric(value: sessionCardsScanned, label: "Detected")
            Divider().frame(height: 34)
            summaryMetric(value: sessionCardsAdded, label: "Added")
        }
        .padding(.vertical, 12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func summaryMetric(value: Int, label: String) -> some View {
        VStack(spacing: 2) {
            Text("\(value)")
                .font(.title3.weight(.semibold))
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var pagePreview: some View {
        GeometryReader { geometry in
            let imageSize = CGSize(width: result.capturedImage.width, height: result.capturedImage.height)
            let fittedRect = aspectFitRect(imageSize: imageSize, containerSize: geometry.size)

            ZStack {
                Image(uiImage: UIImage(cgImage: result.capturedImage))
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                ForEach(Array(detections.enumerated()), id: \.element.id) { index, detection in
                    let path = quadPath(for: detection.quad, in: fittedRect)
                    path
                        .fill(statusColor(detection.status).opacity(0.08))
                        .overlay {
                            path.stroke(
                                statusColor(detection.status),
                                style: StrokeStyle(lineWidth: 3, lineJoin: .round)
                            )
                        }
                        .contentShape(path)
                        .opacity(detection.isIncluded ? 1 : 0.42)
                        .onTapGesture {
                            selectedDetection = DetectionReference(id: detection.id)
                        }

                    let points = detection.quad.points(in: fittedRect)
                    if let anchor = points.first {
                        Text("\(index + 1)")
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(statusColor(detection.status), in: Circle())
                            .position(x: anchor.x + 11, y: anchor.y + 11)
                            .allowsHitTesting(false)
                    }
                }
            }
        }
        .aspectRatio(
            CGFloat(result.capturedImage.width) / CGFloat(result.capturedImage.height),
            contentMode: .fit
        )
        .frame(maxWidth: .infinity)
        .background(Color.black.opacity(0.92), in: RoundedRectangle(cornerRadius: 16))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.secondary.opacity(0.2), lineWidth: 1)
        )
    }

    private var detectionSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Detected Cards")
                    .font(.headline)
                Spacer()
                Text("\(includedDetections.count) included")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if detections.isEmpty {
                ContentUnavailableView(
                    "No Cards Detected",
                    systemImage: "rectangle.dashed",
                    description: Text("Retake the page with even lighting and the full pocket grid visible.")
                )
            } else {
                ForEach(Array(detections.enumerated()), id: \.element.id) { index, detection in
                    Button {
                        selectedDetection = DetectionReference(id: detection.id)
                    } label: {
                        HStack(spacing: 12) {
                            Image(uiImage: UIImage(cgImage: detection.crop))
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                                .frame(width: 44, height: 62)
                                .clipShape(RoundedRectangle(cornerRadius: 6))

                            VStack(alignment: .leading, spacing: 3) {
                                Text(detection.selectedCandidate?.details.identity.name ?? "Unmatched card")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(.primary)
                                    .lineLimit(1)
                                Text(detectionSubtitle(index: index, detection: detection))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                            }

                            Spacer()
                            Image(systemName: detection.isIncluded ? "checkmark.circle.fill" : "minus.circle")
                                .foregroundStyle(detection.isIncluded ? statusColor(detection.status) : Color.secondary)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private var binderControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Target Binder")
                .font(.headline)

            if isLoadingCollections {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Loading binders…")
                        .foregroundStyle(.secondary)
                }
            } else if collections.isEmpty {
                Text("Create a binder first, then return to add this page.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                Picker("Binder", selection: $selectedBinderID) {
                    ForEach(collections) { collection in
                        Text(collection.name).tag(Optional(collection.id))
                    }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private var actionControls: some View {
        VStack(spacing: 12) {
            Button {
                Task { await addIncludedCards() }
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
            .controlSize(.large)
            .disabled(isAdding || selectedBinderID == nil || remainingIncludedDetections.isEmpty)

            Button {
                dismiss()
            } label: {
                Label("Next Page", systemImage: "camera.fill")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(isAdding)
        }
    }

    private var includedDetections: [BinderCardDetection] {
        detections.filter { $0.isIncluded && $0.selectedCandidate != nil }
    }

    private var remainingIncludedDetections: [BinderCardDetection] {
        includedDetections.filter { !addedDetectionIDs.contains($0.id) }
    }

    private var addButtonTitle: String {
        if remainingIncludedDetections.isEmpty, !addedDetectionIDs.isEmpty {
            return "Cards Added"
        }
        return "Add \(remainingIncludedDetections.count) Cards to Binder"
    }

    private func detectionSubtitle(index: Int, detection: BinderCardDetection) -> String {
        let status = detection.status.rawValue.capitalized
        guard let candidate = detection.selectedCandidate else {
            return "Card \(index + 1) · \(status)"
        }
        let set = candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "Unknown set"
        return "Card \(index + 1) · \(set) · \(status)"
    }

    private func statusColor(_ status: BinderCardDetectionStatus) -> Color {
        switch status {
        case .matched: return .green
        case .uncertain: return .orange
        case .unmatched: return .red
        }
    }

    private func quadPath(for quad: BinderNormalizedQuad, in rect: CGRect) -> Path {
        Path { path in
            let points = quad.points(in: rect)
            guard let first = points.first else { return }
            path.move(to: first)
            points.dropFirst().forEach { path.addLine(to: $0) }
            path.closeSubpath()
        }
    }

    private func aspectFitRect(imageSize: CGSize, containerSize: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else {
            return CGRect(origin: .zero, size: containerSize)
        }
        let scale = min(containerSize.width / imageSize.width, containerSize.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: (containerSize.width - size.width) / 2,
            y: (containerSize.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }

    @MainActor
    private func loadCollections() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoadingCollections = false
            return
        }

        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token
            )
            collections.sort { lhs, rhs in
                if lhs.id == Collection.unsortedBinderId { return true }
                if rhs.id == Collection.unsortedBinderId { return false }
                return lhs.updatedAt > rhs.updatedAt
            }
            selectedBinderID = selectedBinderID ?? collections.first?.id
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoadingCollections = false
    }

    @MainActor
    private func addIncludedCards() async {
        guard let binderID = selectedBinderID else { return }
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        let pending = remainingIncludedDetections
        guard !pending.isEmpty else { return }

        isAdding = true
        var addedThisAttempt = 0
        defer {
            isAdding = false
            if addedThisAttempt > 0 {
                onCardsAdded(addedThisAttempt)
            }
        }

        for detection in pending {
            guard let candidate = detection.selectedCandidate,
                  let card = makeCard(from: candidate)
            else { continue }

            do {
                try await apiService.addCardToBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: binderID,
                    cardId: card.id,
                    quantity: 1,
                    condition: "Near Mint",
                    language: "English",
                    notes: nil,
                    price: card.price,
                    acquisitionPrice: nil,
                    isFoil: false,
                    variant: .empty,
                    isSigned: false,
                    isAltered: false,
                    card: card
                )
                addedDetectionIDs.insert(detection.id)
                addedThisAttempt += 1
            } catch {
                errorMessage = "Added \(addedThisAttempt) of \(pending.count) cards. \(error.localizedDescription)"
                return
            }
        }

        if addedThisAttempt > 0 {
            HapticManager.notification(.success)
        }
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

private struct BinderCardDetectionDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var detection: BinderCardDetection
    let game: TCGGame
    @State private var showingCardSearch = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    imageComparison

                    if let candidate = detection.selectedCandidate {
                        VStack(alignment: .leading, spacing: 5) {
                            Text(candidate.details.identity.name)
                                .font(.title3.weight(.semibold))
                            Text(candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "Unknown set")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            Text(String(format: "%.0f%% match", candidate.confidence.score * 100))
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(statusColor)
                        }
                    } else {
                        ContentUnavailableView(
                            "No Match",
                            systemImage: "questionmark.app.dashed",
                            description: Text("Exclude this detection and rescan the card individually if needed.")
                        )
                    }

                    if detection.candidateOptions.count > 1 {
                        alternatives
                    }

                    Button {
                        showingCardSearch = true
                    } label: {
                        Label("Find Another Match", systemImage: "magnifyingglass")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Toggle("Include in bulk add", isOn: $detection.isIncluded)
                        .disabled(detection.selectedCandidate == nil)
                }
                .padding()
            }
            .navigationTitle("Card Match")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(isPresented: $showingCardSearch) {
            BinderCardMatchSearchView(game: game) { card in
                let candidate = CardScanCandidate(
                    details: CardDetails(card: card),
                    confidence: CardScanConfidence(score: 1, reason: "Selected manually"),
                    originatingStrategy: .manual
                )
                detection.selectedCandidate = candidate
                detection.candidateOptions.append(candidate)
                detection.status = .matched
                detection.isIncluded = true
                showingCardSearch = false
            }
        }
    }

    private var imageComparison: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 6) {
                Image(uiImage: UIImage(cgImage: detection.crop))
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                Text("Captured")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 6) {
                if let url = detection.selectedCandidate?.details.imageURL {
                    CachedAsyncImage(url: url) { phase in
                        switch phase {
                        case .success(let image):
                            image.resizable().aspectRatio(contentMode: .fit)
                        case .failure:
                            candidatePlaceholder
                        default:
                            candidatePlaceholder.overlay(ProgressView())
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                } else {
                    candidatePlaceholder
                }
                Text("Matched")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxHeight: 250)
    }

    private var candidatePlaceholder: some View {
        RoundedRectangle(cornerRadius: 10)
            .fill(Color.secondary.opacity(0.12))
            .aspectRatio(0.72, contentMode: .fit)
            .overlay(Image(systemName: "rectangle.portrait").foregroundStyle(.secondary))
    }

    private var alternatives: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Possible Matches")
                .font(.headline)

            ForEach(detection.candidateOptions) { candidate in
                Button {
                    detection.selectedCandidate = candidate
                    detection.status = candidate.confidence.score >= 0.82 ? .matched : .uncertain
                    detection.isIncluded = true
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(candidate.details.identity.name)
                                .foregroundStyle(.primary)
                            Text(candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "Unknown set")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(String(format: "%.0f%%", candidate.confidence.score * 100))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Image(systemName: candidate.id == detection.selectedCandidate?.id
                            ? "checkmark.circle.fill"
                            : "circle")
                            .foregroundStyle(candidate.id == detection.selectedCandidate?.id ? statusColor : Color.secondary)
                    }
                    .padding(10)
                    .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var statusColor: Color {
        switch detection.status {
        case .matched: return .green
        case .uncertain: return .orange
        case .unmatched: return .red
        }
    }
}

private struct BinderCardMatchSearchView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let game: TCGGame
    let onSelect: (Card) -> Void

    @State private var searchText = ""
    @State private var results: [Card] = []
    @State private var isSearching = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Group {
                if isSearching, results.isEmpty {
                    ProgressView("Searching…")
                } else if results.isEmpty {
                    ContentUnavailableView(
                        "Find a Card",
                        systemImage: "magnifyingglass",
                        description: Text("Search by card name or collector number.")
                    )
                } else {
                    List(results) { card in
                        Button {
                            onSelect(card)
                        } label: {
                            HStack(spacing: 12) {
                                CachedAsyncImage(url: card.imageUrlSmall.flatMap(URL.init(string:))) { phase in
                                    switch phase {
                                    case .success(let image):
                                        image.resizable().aspectRatio(contentMode: .fill)
                                    default:
                                        Color.secondary.opacity(0.12)
                                            .overlay(Image(systemName: "rectangle.portrait"))
                                    }
                                }
                                .frame(width: 40, height: 56)
                                .clipShape(RoundedRectangle(cornerRadius: 5))

                                VStack(alignment: .leading, spacing: 3) {
                                    Text(card.name)
                                        .foregroundStyle(.primary)
                                    Text(card.setName ?? card.setCode ?? "Unknown set")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Correct Match")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Card name or number")
            .onSubmit(of: .search) {
                Task { await search() }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .alert(
            "Search Failed",
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

    @MainActor
    private func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        isSearching = true
        defer { isSearching = false }
        do {
            results = try await apiService.searchCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: query,
                game: game
            ).cards
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

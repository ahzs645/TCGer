import SwiftUI
import UIKit

struct BinderPageReviewView: View {
    private struct DetectionReference: Identifiable {
        let pageID: UUID
        let detectionID: UUID

        var id: String { "\(pageID.uuidString)-\(detectionID.uuidString)" }
    }

    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    @ObservedObject var viewModel: CardScannerViewModel

    @State private var currentPageIndex: Int
    @State private var selectedDetection: DetectionReference?
    @State private var collections: [Collection] = []
    @State private var isLoadingCollections = true
    @State private var isAdding = false
    @State private var isCreatingBinder = false
    @State private var showingCreateBinderAlert = false
    @State private var newBinderName = ""
    @State private var errorMessage: String?
    @State private var showsAllCards = false
    @State private var statusFilter: BinderCardDetectionStatus?

    private let apiService = APIService()

    init(
        viewModel: CardScannerViewModel,
        initialPageIndex: Int
    ) {
        self.viewModel = viewModel
        _currentPageIndex = State(initialValue: initialPageIndex)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 18) {
                    sessionSummary
                    if let record = currentRecord {
                        pageNavigation
                        pagePreview(record: record)
                        allPagesStrip
                        detectionSummary(record: record)
                        binderControls
                        actionControls(record: record)
                    } else {
                        ContentUnavailableView(
                            "No Pages to Review",
                            systemImage: "rectangle.stack.badge.minus",
                            description: Text("Scan a binder page to begin a review session.")
                        )
                    }
                }
                .padding()
            }
            .navigationTitle("Binder Page Review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .disabled(isAdding || isCreatingBinder)
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        dismiss()
                    } label: {
                        Image(systemName: "camera.fill")
                    }
                    .disabled(isAdding || isCreatingBinder)
                    .accessibilityLabel("Scan next page")
                }
            }
        }
        .task { await loadCollections() }
        .onChange(of: viewModel.binderPages.count, initial: false) { _, count in
            guard count > 0 else {
                dismiss()
                return
            }
            currentPageIndex = min(currentPageIndex, count - 1)
        }
        .sheet(item: $selectedDetection) { selection in
            if let detection = detectionBinding(for: selection),
               let record = viewModel.binderPages.first(where: { $0.id == selection.pageID }) {
                BinderCardDetectionDetailView(
                    detection: detection,
                    game: record.result.mode.tcgGame
                )
                    .presentationDetents([.medium, .large])
            }
        }
        .alert(
            "Binder Review Error",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "An unknown error occurred.")
        }
        .alert("New Binder", isPresented: $showingCreateBinderAlert) {
            TextField("Binder name", text: $newBinderName)
            Button("Cancel", role: .cancel) { newBinderName = "" }
            Button("Create") {
                Task { await createBinder() }
            }
            .disabled(
                isCreatingBinder ||
                    newBinderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            )
        } message: {
            Text("Create a binder and use it as the target for every page in this scan session.")
        }
    }

    private var sessionSummary: some View {
        HStack(spacing: 0) {
            summaryMetric(value: viewModel.binderPagesScanned, label: "Pages")
            Divider().frame(height: 34)
            summaryMetric(value: viewModel.binderCardsScanned, label: "Detected")
            Divider().frame(height: 34)
            summaryMetric(value: viewModel.binderCardsAdded, label: "Added")
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

    private var pageNavigation: some View {
        HStack {
            Button {
                showPage(at: currentPageIndex - 1)
            } label: {
                Image(systemName: "chevron.left")
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.bordered)
            .disabled(currentPageIndex <= 0 || isAdding)
            .accessibilityLabel("Previous page")

            Spacer()
            Text("Page \(currentPageIndex + 1) of \(viewModel.binderPages.count)")
                .font(.headline)
            Spacer()

            Button {
                showPage(at: currentPageIndex + 1)
            } label: {
                Image(systemName: "chevron.right")
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.bordered)
            .disabled(currentPageIndex >= viewModel.binderPages.count - 1 || isAdding)
            .accessibilityLabel("Next reviewed page")
        }
    }

    private func pagePreview(record: BinderPageRecord) -> some View {
        GeometryReader { geometry in
            let image = record.result.capturedImage
            let imageSize = CGSize(width: image.width, height: image.height)
            let fittedRect = aspectFitRect(imageSize: imageSize, containerSize: geometry.size)

            ZStack {
                Image(uiImage: UIImage(cgImage: image))
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                ForEach(Array(record.detections.enumerated()), id: \.element.id) { index, detection in
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
                            selectedDetection = DetectionReference(
                                pageID: record.id,
                                detectionID: detection.id
                            )
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
            CGFloat(record.result.capturedImage.width) / CGFloat(record.result.capturedImage.height),
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

    private var allPagesStrip: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("All Pages")
                .font(.headline)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(Array(viewModel.binderPages.enumerated()), id: \.element.id) { index, record in
                        pageThumbnail(record: record, index: index)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func pageThumbnail(record: BinderPageRecord, index: Int) -> some View {
        let includedCount = includedDetections(in: record).count
        let allAdded = includedCount > 0 && includedDetections(in: record).allSatisfy {
            record.addedDetectionIDs.contains($0.id)
        }

        return Button {
            showPage(at: index)
        } label: {
            VStack(spacing: 5) {
                Image(uiImage: UIImage(cgImage: record.result.capturedImage))
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 64, height: 78)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(alignment: .topTrailing) {
                        if allAdded {
                            Image(systemName: "checkmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .green)
                                .padding(4)
                        }
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(index == currentPageIndex ? Color.accentColor : Color.clear, lineWidth: 3)
                    }

                Text(allAdded ? "All added" : "\(includedCount)/\(record.detections.count) included")
                    .font(.caption2.weight(index == currentPageIndex ? .semibold : .regular))
                    .foregroundStyle(index == currentPageIndex ? Color.accentColor : Color.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.65)
            }
            .frame(width: 88)
        }
        .buttonStyle(.plain)
        .disabled(isAdding)
        .accessibilityLabel(
            "Page \(index + 1), \(includedCount) of \(record.detections.count) included" +
                (allAdded ? ", all added" : "")
        )
    }

    private func detectionSummary(record: BinderPageRecord) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Detected Cards")
                    .font(.headline)
                Spacer()
                Text(detectionCountSummary(for: record))
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                Picker("Card scope", selection: $showsAllCards) {
                    Text("This Page").tag(false)
                    Text("All Cards").tag(true)
                }
                .pickerStyle(.segmented)
                .labelsHidden()

                statusFilterMenu
            }

            if scopedDetectionCount(for: record) == 0 {
                ContentUnavailableView(
                    "No Cards Detected",
                    systemImage: "rectangle.dashed",
                    description: Text("Retake the page with even lighting and the full pocket grid visible.")
                )
            } else if visibleDetectionCount(for: record) == 0 {
                ContentUnavailableView(
                    "No \(statusFilterName) Cards",
                    systemImage: "line.3.horizontal.decrease.circle",
                    description: Text("Choose a different status filter to see more detections.")
                )
            } else if showsAllCards {
                ForEach(Array(viewModel.binderPages.enumerated()), id: \.element.id) { pageIndex, page in
                    detectionRows(record: page, pageIndex: pageIndex, includesPage: true)
                }
            } else {
                detectionRows(record: record, pageIndex: currentPageIndex, includesPage: false)
            }
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    @ViewBuilder
    private func detectionRows(
        record: BinderPageRecord,
        pageIndex: Int,
        includesPage: Bool
    ) -> some View {
        ForEach(
            Array(record.detections.enumerated()).filter { matchesStatusFilter($0.element) },
            id: \.element.id
        ) { cardIndex, detection in
            HStack(spacing: 12) {
                Button {
                    selectedDetection = DetectionReference(
                        pageID: record.id,
                        detectionID: detection.id
                    )
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
                            Text(
                                detectionSubtitle(
                                    pageIndex: includesPage ? pageIndex : nil,
                                    cardIndex: cardIndex,
                                    detection: detection
                                )
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        }

                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    toggleInclusion(
                        for: DetectionReference(
                            pageID: record.id,
                            detectionID: detection.id
                        )
                    )
                } label: {
                    Image(systemName: detection.isIncluded ? "checkmark.circle.fill" : "minus.circle")
                        .font(.title3)
                        .foregroundStyle(detection.isIncluded ? statusColor(detection.status) : Color.secondary)
                        .frame(width: 32, height: 44)
                }
                .buttonStyle(.plain)
                .disabled(detection.selectedCandidate == nil || isAdding)
                .accessibilityLabel(detection.isIncluded ? "Exclude card" : "Include card")
            }
        }
    }

    private var statusFilterMenu: some View {
        Menu {
            statusFilterButton(title: "All", status: nil)
            statusFilterButton(title: "Matched", status: .matched)
            statusFilterButton(title: "Uncertain", status: .uncertain)
            statusFilterButton(title: "Unmatched", status: .unmatched)
        } label: {
            Label(statusFilterName, systemImage: "line.3.horizontal.decrease.circle")
                .font(.subheadline)
                .lineLimit(1)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .fixedSize()
        .accessibilityLabel("Status filter: \(statusFilterName)")
    }

    private func statusFilterButton(
        title: String,
        status: BinderCardDetectionStatus?
    ) -> some View {
        Button {
            statusFilter = status
        } label: {
            if statusFilter == status {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }

    private var binderControls: some View {
        HStack(spacing: 8) {
            Text("Target Binder")
                .font(.headline)
                .fixedSize()

            Spacer(minLength: 4)

            if isLoadingCollections {
                ProgressView()
                    .controlSize(.small)
            } else {
                if collections.isEmpty {
                    Text("No binders yet")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                } else {
                    Menu {
                        ForEach(collections) { collection in
                            Button {
                                viewModel.selectedBinderID = collection.id
                            } label: {
                                if collection.id == viewModel.selectedBinderID {
                                    Label(collection.name, systemImage: "checkmark")
                                } else {
                                    Text(collection.name)
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(selectedBinderName)
                                .lineLimit(1)
                                .truncationMode(.tail)
                            Image(systemName: "chevron.down")
                                .font(.caption2.weight(.semibold))
                        }
                        .frame(maxWidth: 170, alignment: .trailing)
                    }
                    .layoutPriority(-1)
                }
            }

            Button {
                newBinderName = ""
                showingCreateBinderAlert = true
            } label: {
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.14))
                    if isCreatingBinder {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "plus")
                            .font(.subheadline.weight(.semibold))
                    }
                }
                .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
            .disabled(isLoadingCollections || isCreatingBinder)
            .accessibilityLabel("New Binder")
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    private func actionControls(record: BinderPageRecord) -> some View {
        VStack(spacing: 12) {
            Button {
                Task { await addIncludedCards(from: scopedRecords(for: record)) }
            } label: {
                HStack {
                    if isAdding {
                        ProgressView().tint(.white)
                    }
                    Text(addButtonTitle(for: record))
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(
                isAdding ||
                    isCreatingBinder ||
                    viewModel.selectedBinderID == nil ||
                    remainingIncludedDetectionCount(for: record) == 0
            )
        }
    }

    private var currentRecord: BinderPageRecord? {
        guard viewModel.binderPages.indices.contains(currentPageIndex) else { return nil }
        return viewModel.binderPages[currentPageIndex]
    }

    private func includedDetections(in record: BinderPageRecord) -> [BinderCardDetection] {
        record.detections.filter { $0.isIncluded && $0.selectedCandidate != nil }
    }

    private func remainingIncludedDetections(in record: BinderPageRecord) -> [BinderCardDetection] {
        includedDetections(in: record).filter { !record.addedDetectionIDs.contains($0.id) }
    }

    private func scopedRecords(for record: BinderPageRecord) -> [BinderPageRecord] {
        showsAllCards ? viewModel.binderPages : [record]
    }

    private func scopedDetectionCount(for record: BinderPageRecord) -> Int {
        scopedRecords(for: record).reduce(0) { $0 + $1.detections.count }
    }

    private func visibleDetectionCount(for record: BinderPageRecord) -> Int {
        scopedRecords(for: record).reduce(0) { count, page in
            count + page.detections.filter(matchesStatusFilter).count
        }
    }

    private func scopedIncludedDetectionCount(for record: BinderPageRecord) -> Int {
        scopedRecords(for: record).reduce(0) { $0 + includedDetections(in: $1).count }
    }

    private func remainingIncludedDetectionCount(for record: BinderPageRecord) -> Int {
        scopedRecords(for: record).reduce(0) { $0 + remainingIncludedDetections(in: $1).count }
    }

    private func detectionCountSummary(for record: BinderPageRecord) -> String {
        let included = scopedIncludedDetectionCount(for: record)
        let isFiltered = visibleDetectionCount(for: record) < scopedDetectionCount(for: record)
        return "\(included) included" + (isFiltered ? " · filtered" : "")
    }

    private var statusFilterName: String {
        statusFilter?.rawValue.capitalized ?? "All"
    }

    private func matchesStatusFilter(_ detection: BinderCardDetection) -> Bool {
        guard let statusFilter else { return true }
        return detection.status == statusFilter
    }

    private func addButtonTitle(for record: BinderPageRecord) -> String {
        let records = scopedRecords(for: record)
        let remainingCount = records.reduce(0) { $0 + remainingIncludedDetections(in: $1).count }
        if remainingCount == 0, records.contains(where: { !$0.addedDetectionIDs.isEmpty }) {
            return "Cards Added"
        }
        return "Add \(remainingCount) Cards to Binder"
    }

    private func showPage(at index: Int) {
        guard viewModel.binderPages.indices.contains(index) else { return }
        selectedDetection = nil
        withAnimation(.snappy) {
            currentPageIndex = index
        }
    }

    private func detectionBinding(for selection: DetectionReference) -> Binding<BinderCardDetection>? {
        guard let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == selection.pageID }),
              let detectionIndex = viewModel.binderPages[pageIndex].detections.firstIndex(
                where: { $0.id == selection.detectionID }
              )
        else { return nil }

        return Binding(
            get: { viewModel.binderPages[pageIndex].detections[detectionIndex] },
            set: { viewModel.binderPages[pageIndex].detections[detectionIndex] = $0 }
        )
    }

    private func toggleInclusion(for selection: DetectionReference) {
        guard let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == selection.pageID }),
              let detectionIndex = viewModel.binderPages[pageIndex].detections.firstIndex(
                where: { $0.id == selection.detectionID }
              ),
              viewModel.binderPages[pageIndex].detections[detectionIndex].selectedCandidate != nil
        else { return }

        viewModel.binderPages[pageIndex].detections[detectionIndex].isIncluded.toggle()
    }

    private func detectionSubtitle(
        pageIndex: Int?,
        cardIndex: Int,
        detection: BinderCardDetection
    ) -> String {
        let status = detection.status.rawValue.capitalized
        let page = pageIndex.map { "Page \($0 + 1) · " } ?? ""
        guard let candidate = detection.selectedCandidate else {
            return "\(page)Card \(cardIndex + 1) · \(status)"
        }
        let set = candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "Unknown set"
        return "\(page)Card \(cardIndex + 1) · \(set) · \(status)"
    }

    private var selectedBinderName: String {
        guard let selectedBinderID = viewModel.selectedBinderID else { return "Select Binder" }
        return collections.first(where: { $0.id == selectedBinderID })?.name ?? "Select Binder"
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
        guard environmentStore.serverConfiguration.isOnDevice || environmentStore.authToken != nil else {
            errorMessage = "Not authenticated"
            isLoadingCollections = false
            return
        }

        do {
            collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken
            )
            sortCollections()
            if let selectedBinderID = viewModel.selectedBinderID,
               collections.contains(where: { $0.id == selectedBinderID }) {
                viewModel.selectedBinderID = selectedBinderID
            } else {
                viewModel.selectedBinderID = collections.first?.id
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoadingCollections = false
    }

    @MainActor
    private func createBinder() async {
        let name = newBinderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, !isCreatingBinder else { return }
        guard let token = requestToken else {
            errorMessage = "Not authenticated"
            return
        }

        isCreatingBinder = true
        defer { isCreatingBinder = false }

        do {
            let collection = try await apiService.createCollection(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name,
                description: nil,
                colorHex: nil
            )
            collections.removeAll { $0.id == collection.id }
            collections.append(collection)
            sortCollections()
            viewModel.selectedBinderID = collection.id
            newBinderName = ""
            NotificationCenter.default.post(name: .collectionDidChange, object: collection)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func addIncludedCards(from records: [BinderPageRecord]) async {
        guard let binderID = viewModel.selectedBinderID else { return }
        guard let token = requestToken else {
            errorMessage = "Not authenticated"
            return
        }

        let pendingCount = records.reduce(0) { $0 + remainingIncludedDetections(in: $1).count }
        guard pendingCount > 0 else { return }

        isAdding = true
        var addedThisAttempt = 0
        defer { isAdding = false }

        for record in records {
            for detection in remainingIncludedDetections(in: record) {
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
                    if let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == record.id }) {
                        viewModel.binderPages[pageIndex].addedDetectionIDs.insert(detection.id)
                    }
                    addedThisAttempt += 1
                } catch {
                    errorMessage = "Added \(addedThisAttempt) of \(pendingCount) cards. \(error.localizedDescription)"
                    return
                }
            }
        }

        if addedThisAttempt > 0 {
            HapticManager.notification(.success)
        }
    }

    private var requestToken: String? {
        if environmentStore.serverConfiguration.isOnDevice {
            return environmentStore.authToken ?? ""
        }
        return environmentStore.authToken
    }

    private func sortCollections() {
        collections.sort { lhs, rhs in
            if lhs.id == Collection.unsortedBinderId { return true }
            if rhs.id == Collection.unsortedBinderId { return false }
            return lhs.updatedAt > rhs.updatedAt
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

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
    @State private var errorMessage: String?
    @State private var showsAllCards = false
    @State private var statusFilter: BinderCardDetectionStatus?
    @State private var storedPages: [SavedBinderPage] = []
    @State private var isSavingPage = false
    @AppStorage("binderScanner.savePageImages") private var savesPageImages = true
    @AppStorage("binderScanner.replacePageImages") private var replacesPageImages = true
    @AppStorage("binderScanner.hidesUnmatchedCards") private var hidesUnmatchedCards = false

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
                        pageSelectionControls(record: record)
                        allPagesStrip
                        detectionSummary(record: record)
                        binderControls(record: record)
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
            .safeAreaInset(edge: .bottom) {
                if let record = currentRecord {
                    stickyActionBar(record: record)
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                        .disabled(isAdding || isCreatingBinder)
                }
                ToolbarItem(placement: .primaryAction) {
                    if let currentRecord {
                        Button("Retake") {
                            viewModel.prepareToRescanBinderPage(currentRecord.pageNumber)
                            dismiss()
                        }
                        .disabled(isAdding || isCreatingBinder || isSavingPage)
                        .accessibilityHint("Retakes binder page \(currentRecord.pageNumber)")
                    }
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
        .onChange(of: viewModel.selectedBinderID, initial: false) { _, _ in
            guard viewModel.binderDestinationMode == .oneBinder else { return }
            Task { await loadStoredPages() }
        }
        .onChange(of: currentPageIndex, initial: false) { _, _ in
            Task { await loadStoredPages(for: currentRecord.flatMap(destinationBinderID)) }
        }
        .onChange(of: viewModel.binderDestinationMode, initial: false) { _, _ in
            Task { await loadStoredPages(for: currentRecord.flatMap(destinationBinderID)) }
        }
        .sheet(item: $selectedDetection) { selection in
            if let detection = detectionBinding(for: selection),
               let record = viewModel.binderPages.first(where: { $0.id == selection.pageID }) {
                BinderCardDetectionDetailView(
                    detection: detection,
                    mode: record.result.mode,
                    onInclude: { includeDetection(for: selection) },
                    onExcludeGeneral: { excludeDetectionWithoutReason(for: selection) },
                    onExclude: { reason in
                        excludeDetection(for: selection, reason: reason)
                    }
                )
                    .presentationDetents([.large])
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
    }

    private var sessionSummary: some View {
        HStack(spacing: 0) {
            summaryMetric(value: viewModel.binderPagesScanned, label: "Pages")
            Divider().frame(height: 34)
            summaryMetric(value: viewModel.binderCardsSelected, label: "Selected")
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
            Text(currentRecord.map { "Binder page \($0.pageNumber)" } ?? "Binder page")
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
                    Button {
                        handleDetectionTap(
                            DetectionReference(pageID: record.id, detectionID: detection.id)
                        )
                    } label: {
                        path
                            .fill(
                                detection.isIncluded
                                    ? statusColor(detection.status).opacity(0.08)
                                    : Color.black.opacity(0.38)
                            )
                            .overlay {
                                path.stroke(
                                    detection.isIncluded ? statusColor(detection.status) : Color.secondary,
                                    style: StrokeStyle(
                                        lineWidth: 3,
                                        lineJoin: .round,
                                        dash: detection.isIncluded ? [] : [7, 5]
                                    )
                                )
                            }
                            .contentShape(path)
                    }
                    .buttonStyle(.plain)
                    .modifier(
                        BinderExclusionContextMenu(
                            isEnabled: ScannerDevModeStore.isEnabled,
                            previewCrop: detection.crop
                        ) { reason in
                            excludeDetection(
                                for: DetectionReference(pageID: record.id, detectionID: detection.id),
                                reason: reason
                            )
                        }
                    )
                    .disabled(isAdding)
                    .accessibilityLabel(detectionAccessibilityLabel(index: index, detection: detection))
                    .accessibilityValue(detectionAccessibilityValue(detection))
                    .accessibilityHint(
                        detection.isIncluded
                            ? "Double tap to exclude this detection."
                            : detection.selectedCandidate == nil
                                ? "This unmatched detection is excluded."
                                : "Double tap to include this card in the binder."
                    )

                    // Selection state on the page reads through the quad's
                    // color, dash, and dimming; the ✕/✓ toggles live only in
                    // the row list so small cards keep clean tap targets.
                    let points = detection.quad.points(in: fittedRect)
                    if let numberAnchor = points.first {
                        Text("\(index + 1)")
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .frame(width: 22, height: 22)
                            .background(statusColor(detection.status), in: Circle())
                            .position(x: numberAnchor.x + 11, y: numberAnchor.y + 11)
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

    private func pageSelectionControls(record: BinderPageRecord) -> some View {
        let selectableCount = selectableDetections(in: record).count
        let selectedCount = includedDetections(in: record).count

        return HStack(spacing: 12) {
            Image(systemName: "hand.tap")
                .foregroundStyle(.secondary)

            VStack(alignment: .leading, spacing: 2) {
                Text("\(selectedCount) of \(record.detections.count) detections selected")
                    .font(.subheadline.weight(.semibold))
                Text(
                    ScannerDevModeStore.isEnabled
                        ? "Tap to select or exclude. Hold to label why."
                        : "Tap a detection to select or exclude it."
                )
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 4)

            Menu {
                Button("Select All", systemImage: "checkmark.circle") {
                    setInclusion(true, for: record.id)
                }
                .disabled(selectedCount == selectableCount)

                Button("Deselect All", systemImage: "xmark.circle") {
                    setInclusion(false, for: record.id)
                }
                .disabled(selectedCount == 0)

                if ScannerDevModeStore.isEnabled {
                    Menu("Label All Excluded As", systemImage: "tag") {
                        ForEach(BinderCardExclusionReason.allCases) { reason in
                            Button(reason.displayName, systemImage: reason.systemImage) {
                                excludeAllDetections(in: record.id, reason: reason)
                            }
                        }
                    }
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.title3)
                    .frame(width: 32, height: 32)
            }
            .disabled(record.detections.isEmpty || isAdding)
            .accessibilityLabel("Card selection options")
        }
        .padding(.horizontal, 4)
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

                Text("Page \(record.pageNumber) · " + (allAdded ? "All added" : "\(includedCount)/\(record.detections.count) selected"))
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
            "Binder page \(record.pageNumber), \(includedCount) of \(record.detections.count) selected" +
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
                        .opacity(detection.isIncluded ? 1 : 0.58)

                        Spacer(minLength: 0)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button {
                    handleDetectionTap(
                        DetectionReference(pageID: record.id, detectionID: detection.id)
                    )
                } label: {
                    Image(systemName: selectionSymbol(for: detection))
                        .font(.title3)
                        .foregroundStyle(detection.isIncluded ? Color.accentColor : Color.secondary)
                        .frame(width: 32, height: 44)
                }
                .buttonStyle(.plain)
                .modifier(
                    BinderExclusionContextMenu(
                        isEnabled: ScannerDevModeStore.isEnabled,
                        previewCrop: detection.crop
                    ) { reason in
                        excludeDetection(
                            for: DetectionReference(pageID: record.id, detectionID: detection.id),
                            reason: reason
                        )
                    }
                )
                .disabled(isAdding)
                .accessibilityLabel(
                    detection.isIncluded
                        ? "Exclude detection"
                        : detection.selectedCandidate == nil ? "Label detection" : "Include card"
                )
            }
        }
    }

    private var statusFilterMenu: some View {
        Menu {
            statusFilterButton(title: "All", status: nil)
            statusFilterButton(title: "Matched", status: .matched)
            statusFilterButton(title: "Uncertain", status: .uncertain)
            statusFilterButton(title: "Unmatched", status: .unmatched)

            Divider()

            Toggle("Hide Unmatched Cards", isOn: $hidesUnmatchedCards)
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

    private func binderControls(record: BinderPageRecord) -> some View {
        let binderSelection = Binding<String?>(
            get: { destinationBinderID(for: record) },
            set: { binderID in
                if let binderID {
                    selectBinder(binderID, for: record)
                }
            }
        )

        return VStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Save Destination")
                    .font(.headline)

                Picker("Save Destination", selection: $viewModel.binderDestinationMode) {
                    ForEach(CardScannerViewModel.BinderDestinationMode.allCases) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                Text(viewModel.binderDestinationMode == .oneBinder
                    ? "All pages and cards in this scan session are saved to one binder."
                    : "Choose a binder for each page, then save that page before moving to the next one.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Text(viewModel.binderDestinationMode == .oneBinder
                    ? "Session Binder"
                    : "Page \(record.pageNumber) Binder")
                    .font(.headline)

                if isLoadingCollections {
                    ProgressView("Loading binders…")
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                } else {
                    BinderPickerSheetButton(
                        binders: collections,
                        selectedBinderId: binderSelection,
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
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding()
        .frame(maxWidth: .infinity)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }

    /// Pinned below the scroll view so Save/Add stay reachable while the
    /// detection list scrolls. Save collapses to a short label; the full
    /// intent stays on its accessibility label.
    private func stickyActionBar(record: BinderPageRecord) -> some View {
        let records = destinationRecords(for: record)
        let binderID = destinationBinderID(for: record)

        return HStack(spacing: 10) {
            Button {
                guard let binderID else { return }
                Task { await persistRecords(records, to: binderID) }
            } label: {
                HStack(spacing: 6) {
                    if isSavingPage {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "square.and.arrow.down")
                    }
                    Text(compactSaveButtonTitle(for: record))
                        .fontWeight(.semibold)
                }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .disabled(isSavingPage || isAdding || binderID == nil)
            .accessibilityLabel(saveButtonTitle(for: record))

            Button {
                guard let binderID else { return }
                Task { await addIncludedCards(from: records, to: binderID) }
            } label: {
                HStack {
                    if isAdding {
                        ProgressView().tint(.white)
                    }
                    Text(addButtonTitle(for: record))
                        .fontWeight(.semibold)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(
                isAdding ||
                    isCreatingBinder || isSavingPage ||
                    binderID == nil ||
                    remainingIncludedDetectionCount(in: records) == 0
            )
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private func compactSaveButtonTitle(for record: BinderPageRecord) -> String {
        let records = destinationRecords(for: record)
        if records.count > 1 { return "Save \(records.count)" }
        return storedPage(for: record.pageNumber) == nil ? "Save" : "Update"
    }

    private var currentRecord: BinderPageRecord? {
        guard viewModel.binderPages.indices.contains(currentPageIndex) else { return nil }
        return viewModel.binderPages[currentPageIndex]
    }

    private func includedDetections(in record: BinderPageRecord) -> [BinderCardDetection] {
        record.detections.filter { $0.isIncluded && $0.selectedCandidate != nil }
    }

    private func selectableDetections(in record: BinderPageRecord) -> [BinderCardDetection] {
        record.detections.filter { $0.selectedCandidate != nil }
    }

    private func remainingIncludedDetections(in record: BinderPageRecord) -> [BinderCardDetection] {
        includedDetections(in: record).filter { !record.addedDetectionIDs.contains($0.id) }
    }

    private func scopedRecords(for record: BinderPageRecord) -> [BinderPageRecord] {
        showsAllCards ? viewModel.binderPages : [record]
    }

    private func destinationRecords(for record: BinderPageRecord) -> [BinderPageRecord] {
        viewModel.binderDestinationMode == .oneBinder ? viewModel.binderPages : [record]
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

    private func remainingIncludedDetectionCount(in records: [BinderPageRecord]) -> Int {
        records.reduce(0) { $0 + remainingIncludedDetections(in: $1).count }
    }

    private func detectionCountSummary(for record: BinderPageRecord) -> String {
        let included = scopedIncludedDetectionCount(for: record)
        let detected = scopedDetectionCount(for: record)
        let isFiltered = visibleDetectionCount(for: record) < scopedDetectionCount(for: record)
        return "\(included) selected · \(detected) detected" + (isFiltered ? " · filtered" : "")
    }

    private var statusFilterName: String {
        statusFilter?.rawValue.capitalized ?? "All"
    }

    private func matchesStatusFilter(_ detection: BinderCardDetection) -> Bool {
        // Explicitly filtering to Unmatched overrides the hide preference —
        // that filter exists to inspect exactly these detections.
        if hidesUnmatchedCards, detection.status == .unmatched, statusFilter != .unmatched {
            return false
        }
        guard let statusFilter else { return true }
        return detection.status == statusFilter
    }

    private func addButtonTitle(for record: BinderPageRecord) -> String {
        let records = destinationRecords(for: record)
        let remainingCount = records.reduce(0) { $0 + remainingIncludedDetections(in: $1).count }
        if remainingCount == 0, records.contains(where: { !$0.addedDetectionIDs.isEmpty }) {
            return "Cards Added"
        }
        return "Add \(remainingCount) Cards to Binder"
    }

    private func saveButtonTitle(for record: BinderPageRecord) -> String {
        let records = destinationRecords(for: record)
        if records.count > 1 { return "Save \(records.count) Page Layouts" }
        return storedPage(for: record.pageNumber) == nil
            ? "Save Binder Page \(record.pageNumber)"
            : "Update Binder Page \(record.pageNumber)"
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

    private func handleDetectionTap(_ selection: DetectionReference) {
        guard let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == selection.pageID }),
              let detectionIndex = viewModel.binderPages[pageIndex].detections.firstIndex(
                  where: { $0.id == selection.detectionID }
              )
        else { return }

        let detection = viewModel.binderPages[pageIndex].detections[detectionIndex]
        if detection.isIncluded {
            excludeDetectionWithoutReason(for: selection)
        } else if detection.selectedCandidate != nil {
            includeDetection(for: selection)
        }
    }

    private func excludeDetectionWithoutReason(for selection: DetectionReference) {
        guard let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == selection.pageID }),
              let detectionIndex = viewModel.binderPages[pageIndex].detections.firstIndex(
                  where: { $0.id == selection.detectionID }
              )
        else { return }

        viewModel.binderPages[pageIndex].detections[detectionIndex].isIncluded = false
        viewModel.binderPages[pageIndex].detections[detectionIndex].exclusionReason = nil
        HapticManager.selection()
    }

    private func includeDetection(for selection: DetectionReference) {
        guard let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == selection.pageID }),
              let detectionIndex = viewModel.binderPages[pageIndex].detections.firstIndex(
                  where: { $0.id == selection.detectionID }
              ),
              viewModel.binderPages[pageIndex].detections[detectionIndex].selectedCandidate != nil
        else { return }

        viewModel.binderPages[pageIndex].detections[detectionIndex].isIncluded = true
        viewModel.binderPages[pageIndex].detections[detectionIndex].exclusionReason = nil
        HapticManager.selection()
    }

    private func excludeDetection(
        for selection: DetectionReference,
        reason: BinderCardExclusionReason
    ) {
        guard let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == selection.pageID }),
              let detectionIndex = viewModel.binderPages[pageIndex].detections.firstIndex(
                  where: { $0.id == selection.detectionID }
              )
        else { return }

        viewModel.binderPages[pageIndex].detections[detectionIndex].isIncluded = false
        viewModel.binderPages[pageIndex].detections[detectionIndex].exclusionReason = reason
        recordExclusion(pageIndex: pageIndex, detectionIndex: detectionIndex, reason: reason)
        HapticManager.selection()
    }

    private func setInclusion(_ isIncluded: Bool, for pageID: UUID) {
        guard let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == pageID }) else { return }

        for detectionIndex in viewModel.binderPages[pageIndex].detections.indices
        where viewModel.binderPages[pageIndex].detections[detectionIndex].selectedCandidate != nil {
            viewModel.binderPages[pageIndex].detections[detectionIndex].isIncluded = isIncluded
            viewModel.binderPages[pageIndex].detections[detectionIndex].exclusionReason = nil
        }
        HapticManager.selection()
    }

    private func excludeAllDetections(
        in pageID: UUID,
        reason: BinderCardExclusionReason
    ) {
        guard let pageIndex = viewModel.binderPages.firstIndex(where: { $0.id == pageID }) else { return }

        for detectionIndex in viewModel.binderPages[pageIndex].detections.indices {
            viewModel.binderPages[pageIndex].detections[detectionIndex].isIncluded = false
            viewModel.binderPages[pageIndex].detections[detectionIndex].exclusionReason = reason
            recordExclusion(pageIndex: pageIndex, detectionIndex: detectionIndex, reason: reason)
        }
        HapticManager.selection()
    }

    private func recordExclusion(
        pageIndex: Int,
        detectionIndex: Int,
        reason: BinderCardExclusionReason
    ) {
        guard ScannerDevModeStore.isEnabled,
              viewModel.binderPages.indices.contains(pageIndex),
              viewModel.binderPages[pageIndex].detections.indices.contains(detectionIndex)
        else { return }

        let record = viewModel.binderPages[pageIndex]
        let detection = record.detections[detectionIndex]
        let candidate = detection.selectedCandidate
        let exclusion = ScannerBinderDetectionExclusion(
            reason: reason,
            pageNumber: record.pageNumber,
            detectionIndex: detectionIndex,
            predictedCardId: candidate?.details.identity.id,
            predictedCardName: candidate?.details.identity.name,
            predictedSetCode: candidate?.details.identity.setCode,
            predictedSetName: candidate?.details.identity.setName,
            predictedConfidence: candidate?.confidence.score,
            predictedStrategy: candidate?.originatingStrategy.displayName
        )
        let crop = detection.crop
        let mode = record.result.mode
        Task {
            await ScannerDevModeStore.shared.recordBinderDetectionExclusion(
                image: crop,
                mode: mode,
                exclusion: exclusion
            )
        }
    }

    private func selectionSymbol(for detection: BinderCardDetection) -> String {
        if detection.isIncluded { return "checkmark.circle.fill" }
        return detection.exclusionReason?.systemImage ?? "xmark.circle.fill"
    }

    private func detectionAccessibilityValue(_ detection: BinderCardDetection) -> String {
        if detection.isIncluded { return "Selected" }
        if let reason = detection.exclusionReason { return "Excluded: \(reason.displayName)" }
        return ScannerDevModeStore.isEnabled ? "Excluded, no reason" : "Excluded"
    }

    private func detectionAccessibilityLabel(
        index: Int,
        detection: BinderCardDetection
    ) -> String {
        let name = detection.selectedCandidate?.details.identity.name ?? "Unmatched card"
        return "Card \(index + 1), \(name)"
    }

    private func detectionSubtitle(
        pageIndex: Int?,
        cardIndex: Int,
        detection: BinderCardDetection
    ) -> String {
        let status = detection.status.rawValue.capitalized
        let page = pageIndex.map { "Page \($0 + 1) · " } ?? ""
        guard let candidate = detection.selectedCandidate else {
            let reason = detection.exclusionReason.map { " · \($0.displayName)" }
                ?? (ScannerDevModeStore.isEnabled ? " · Hold to label" : "")
            return "\(page)Detection \(cardIndex + 1) · \(status)\(reason)"
        }
        let set = candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "Unknown set"
        let inclusion = detection.isIncluded
            ? "Selected"
            : detection.exclusionReason.map { "Excluded: \($0.displayName)" } ?? "Excluded"
        return "\(page)Card \(cardIndex + 1) · \(set) · \(status) · \(inclusion)"
    }

    private func destinationBinderID(for record: BinderPageRecord) -> String? {
        viewModel.binderDestinationID(forPageNumber: record.pageNumber)
    }

    private func selectBinder(_ binderID: String, for record: BinderPageRecord) {
        switch viewModel.binderDestinationMode {
        case .oneBinder:
            viewModel.selectedBinderID = binderID
        case .pageByPage:
            viewModel.setBinderDestinationID(binderID, forPageNumber: record.pageNumber)
            Task { await loadStoredPages(for: binderID) }
        }
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
            await loadStoredPages(for: currentRecord.flatMap(destinationBinderID))
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
        defaultCondition: String? = nil
    ) async {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
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
                description: description,
                colorHex: colorHex,
                defaultCondition: defaultCondition
            )
            collections.removeAll { $0.id == collection.id }
            collections.append(collection)
            sortCollections()
            if viewModel.binderDestinationMode == .pageByPage, let currentRecord {
                viewModel.setBinderDestinationID(collection.id, forPageNumber: currentRecord.pageNumber)
            } else {
                viewModel.selectedBinderID = collection.id
            }
            storedPages = []
            NotificationCenter.default.post(name: .collectionDidChange, object: collection)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func addIncludedCards(from records: [BinderPageRecord], to binderID: String) async {
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
                        card: card,
                        details: BinderCardAddDetails(
                            condition: CardCondition.nearMint.rawValue,
                            language: "English"
                        )
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
            await persistRecords(records, to: binderID, reportsSuccess: false)
            HapticManager.notification(.success)
        }
    }

    @MainActor
    private func loadStoredPages(for requestedBinderID: String? = nil) async {
        guard let binderID = requestedBinderID ?? viewModel.selectedBinderID else {
            storedPages = []
            return
        }
        do {
            storedPages = try await apiService.getBinderPages(
                config: environmentStore.serverConfiguration,
                token: requestToken,
                binderId: binderID
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func storedPage(for pageNumber: Int) -> SavedBinderPage? {
        storedPages.first { $0.pageNumber == pageNumber }
    }

    @MainActor
    private func persistRecords(
        _ records: [BinderPageRecord],
        to binderID: String,
        reportsSuccess: Bool = true
    ) async {
        guard !isSavingPage else { return }
        isSavingPage = true
        defer { isSavingPage = false }

        do {
            for record in records {
                let existing = storedPage(for: record.pageNumber)
                var saved = try await apiService.upsertBinderPage(
                    config: environmentStore.serverConfiguration,
                    token: requestToken,
                    binderId: binderID,
                    pageNumber: record.pageNumber,
                    capturedAt: record.scannedAt,
                    placements: record.persistentPlacements
                )
                let shouldUploadImage = savesPageImages && (existing?.imageUrl == nil || replacesPageImages)
                if shouldUploadImage,
                   let imageData = UIImage(cgImage: record.result.capturedImage)
                    .jpegData(compressionQuality: 0.82) {
                    saved = try await apiService.replaceBinderPageImage(
                        config: environmentStore.serverConfiguration,
                        token: requestToken,
                        binderId: binderID,
                        pageNumber: record.pageNumber,
                        imageData: imageData
                    )
                }
                storedPages.removeAll { $0.pageNumber == saved.pageNumber }
                storedPages.append(saved)
            }
            storedPages.sort { $0.pageNumber < $1.pageNumber }
            if reportsSuccess { HapticManager.notification(.success) }
        } catch {
            errorMessage = error.localizedDescription
            HapticManager.notification(.error)
        }
    }

    private var requestToken: String? {
        if environmentStore.serverConfiguration.isOnDevice {
            return environmentStore.authToken ?? ""
        }
        return environmentStore.authToken
    }

    private func sortCollections() {
        collections = collections.sortedForDisplay()
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

private struct BinderExclusionContextMenu: ViewModifier {
    let isEnabled: Bool
    // Without an explicit preview, the system lifts the modified view itself.
    // On the page overlay that view is a full-frame quad path, so the lift
    // dragged the highlight box away from the card; previewing the crop keeps
    // the overlay in place.
    var previewCrop: CGImage?
    let onExclude: (BinderCardExclusionReason) -> Void

    @ViewBuilder
    func body(content: Content) -> some View {
        if isEnabled {
            if let previewCrop {
                content.contextMenu {
                    menuItems
                } preview: {
                    Image(uiImage: UIImage(cgImage: previewCrop))
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 240, maxHeight: 336)
                }
            } else {
                content.contextMenu { menuItems }
            }
        } else {
            content
        }
    }

    private var menuItems: some View {
        ForEach(BinderCardExclusionReason.allCases) { reason in
            Button("Exclude: \(reason.displayName)", systemImage: reason.systemImage) {
                onExclude(reason)
            }
        }
    }
}

private struct BinderCardDetectionDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var detection: BinderCardDetection
    let mode: ScanMode
    let onInclude: () -> Void
    let onExcludeGeneral: () -> Void
    let onExclude: (BinderCardExclusionReason) -> Void
    @State private var showingCardSearch = false
    @State private var correctionFeedback: String?
    @State private var correctionFeedbackIsError = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    imageComparison

                    if let candidate = detection.selectedCandidate {
                        VStack(alignment: .leading, spacing: 5) {
                            HStack(spacing: 7) {
                                Text(candidate.details.identity.name)
                                    .font(.title3.weight(.semibold))
                                if candidate.originatingStrategy == .manual {
                                    Label("Manual match", systemImage: "hand.tap.fill")
                                        .font(.caption.weight(.semibold))
                                        .foregroundStyle(.blue)
                                }
                            }
                            Text(candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "Unknown set")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            if candidate.originatingStrategy == .manual {
                                Text("Selected by you")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                            } else {
                                Text(String(format: "%.0f%% match", candidate.confidence.score * 100))
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(statusColor)
                            }
                        }
                    } else {
                        ContentUnavailableView(
                            "No Match",
                            systemImage: "questionmark.app.dashed",
                            description: Text("Choose a card below, or leave this detection excluded from the bulk add.")
                        )
                    }

                    if let correctionFeedback {
                        Label(
                            correctionFeedback,
                            systemImage: correctionFeedbackIsError
                                ? "exclamationmark.triangle.fill"
                                : "checkmark.circle.fill"
                        )
                        .font(.caption.weight(.medium))
                        .foregroundStyle(correctionFeedbackIsError ? Color.orange : Color.green)
                    }

                    if detection.candidateOptions.count > 1 {
                        alternatives
                    }

                    HStack(spacing: 10) {
                        Button {
                            showingCardSearch = true
                        } label: {
                            Label(
                                detection.selectedCandidate == nil ? "Find Match" : "Change Match",
                                systemImage: "magnifyingglass"
                            )
                            .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)

                        if detection.selectedCandidate != nil {
                            Button(role: .destructive) {
                                clearMatch()
                            } label: {
                                Label("Clear", systemImage: "xmark.circle")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.bordered)
                        }
                    }

                    binderSelectionControl
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
            BinderCardMatchSearchView(mode: mode, capturedCard: detection.crop) { card in
                applyManualMatch(details: CardDetails(card: card))
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

    private var binderSelectionControl: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(
                "Include in binder",
                isOn: Binding(
                    get: { detection.isIncluded },
                    set: { isIncluded in
                        if isIncluded {
                            onInclude()
                        } else {
                            onExcludeGeneral()
                        }
                    }
                )
            )
            .disabled(detection.selectedCandidate == nil)

            if ScannerDevModeStore.isEnabled {
                Divider()

                HStack(spacing: 10) {
                    Label(
                        detection.exclusionReason?.displayName ?? "No exclusion reason",
                        systemImage: detection.exclusionReason?.systemImage ?? "tag"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                    Spacer()

                    Menu(detection.exclusionReason == nil ? "Add Reason" : "Change Reason") {
                        ForEach(BinderCardExclusionReason.allCases) { reason in
                            Button(reason.displayName, systemImage: reason.systemImage) {
                                onExclude(reason)
                            }
                        }
                    }
                    .buttonStyle(.bordered)
                }

                Text("The reason is saved with this crop in the dev-mode recording.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
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
                    applyManualMatch(details: candidate.details)
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
                        Image(systemName: candidate.details.identity.id == detection.selectedCandidate?.details.identity.id
                            ? "checkmark.circle.fill"
                            : "circle")
                            .foregroundStyle(
                                candidate.details.identity.id == detection.selectedCandidate?.details.identity.id
                                    ? statusColor
                                    : Color.secondary
                            )
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

    private func applyManualMatch(details: CardDetails) {
        let previousCandidate = detection.selectedCandidate
        let manualCandidate = CardScanCandidate(
            details: details,
            confidence: CardScanConfidence(score: 1, reason: "Selected manually"),
            originatingStrategy: .manual
        )
        if let existingIndex = detection.candidateOptions.firstIndex(where: {
            $0.details.identity.id == details.identity.id
        }) {
            detection.candidateOptions[existingIndex] = manualCandidate
        } else {
            detection.candidateOptions.append(manualCandidate)
        }
        detection.selectedCandidate = manualCandidate
        detection.status = .matched
        detection.isIncluded = true
        detection.exclusionReason = nil
        saveCorrection(previousCandidate: previousCandidate, correctedCardId: details.identity.id)
    }

    private func clearMatch() {
        let previousCandidate = detection.selectedCandidate
        detection.selectedCandidate = nil
        detection.status = .unmatched
        detection.isIncluded = false
        detection.exclusionReason = nil
        saveCorrection(previousCandidate: previousCandidate, correctedCardId: nil)
    }

    private func saveCorrection(
        previousCandidate: CardScanCandidate?,
        correctedCardId: String?
    ) {
        correctionFeedback = nil
        guard ScannerDevModeStore.isEnabled else { return }
        let crop = detection.crop
        let correction = ScannerManualCorrection(
            previousCardId: previousCandidate?.details.identity.id,
            previousCardName: previousCandidate?.details.identity.name,
            previousSetCode: previousCandidate?.details.identity.setCode,
            previousSetName: previousCandidate?.details.identity.setName,
            previousConfidence: previousCandidate?.confidence.score,
            previousStrategy: previousCandidate?.originatingStrategy.displayName,
            correctedCardId: correctedCardId
        )
        Task {
            let didSave = await ScannerDevModeStore.shared.recordManualCorrection(
                image: crop,
                mode: mode,
                correction: correction
            )
            correctionFeedbackIsError = !didSave
            correctionFeedback = didSave
                ? (correctedCardId == nil
                    ? "Saved “No Match” to the dev-mode recording"
                    : "Saved manual match to the dev-mode recording")
                : "Couldn’t save this correction to the dev-mode recording"
        }
    }
}

private struct BinderCardMatchSearchView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let mode: ScanMode
    let capturedCard: CGImage
    let onSelect: (Card) -> Void

    @State private var searchText = ""
    @State private var results: [Card] = []
    @State private var isSearching = false
    @State private var hasSearched = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    private var game: TCGGame { mode.tcgGame }

    var body: some View {
        NavigationStack {
            Group {
                if isSearching, results.isEmpty {
                    ProgressView("Searching…")
                } else if results.isEmpty {
                    ContentUnavailableView(
                        hasSearched ? "No Cards Found" : "Find a Card",
                        systemImage: hasSearched ? "rectangle.stack.badge.questionmark" : "magnifyingglass",
                        description: Text(
                            hasSearched
                                ? "Try another card name or collector number."
                                : "Search by card name or collector number."
                        )
                    )
                } else {
                    CardSearchResultsList(
                        cards: results,
                        selectedGame: game,
                        enabledGames: environmentStore.enabledGames,
                        showPricing: environmentStore.showPricing,
                        showCardNumbers: environmentStore.showCardNumbers,
                        showsGameSectionHeader: false,
                        primaryActionTitle: "Use This Card",
                        accessibilityHint: "Selects this card as the manual match",
                        onCardTap: onSelect
                    )
                }
            }
            .navigationTitle("Choose Match")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(
                text: $searchText,
                placement: .navigationBarDrawer(displayMode: .always),
                prompt: "Search \(mode.displayName) cards"
            )
            .safeAreaBar(edge: .top, spacing: 0) {
                capturedCardReference
            }
            .scrollEdgeEffectStyle(.soft, for: .top)
            .onSubmit(of: .search) {
                Task { await search() }
            }
            .onChange(of: searchText) { _, newValue in
                if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    results = []
                    hasSearched = false
                }
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

    @ViewBuilder
    private var capturedCardReference: some View {
        let content = HStack(spacing: 12) {
            Image(uiImage: UIImage(cgImage: capturedCard))
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 58, height: 78)
                .clipShape(RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 3) {
                Text("Captured card")
                    .font(.subheadline.weight(.semibold))
                Text("Compare this crop with the search results.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(10)

        if #available(iOS 26.0, *) {
            content
                .glassEffect(.regular, in: .rect(cornerRadius: 18))
                .padding(.horizontal)
                .padding(.bottom, 8)
        } else {
            content
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 18))
                .padding(.horizontal)
                .padding(.bottom, 8)
        }
    }

    @MainActor
    private func search() async {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return }
        let token: String
        if environmentStore.serverConfiguration.isOnDevice {
            token = environmentStore.authToken ?? ""
        } else if let authToken = environmentStore.authToken {
            token = authToken
        } else {
            errorMessage = "Not authenticated"
            return
        }

        isSearching = true
        hasSearched = true
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

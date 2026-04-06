import SwiftUI
import UIKit

struct CardScannerView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @AppStorage("cardScannerShowTestingTools") private var showTestingTools = false
    @StateObject private var viewModel = CardScannerViewModel()
    @State private var selectedCardForBinder: Card?
    @State private var showingRecentDebugCaptures = false

    var body: some View {
        ZStack {
            CardScannerCameraPreview(controller: viewModel.cameraController)
                .ignoresSafeArea()

            VStack {
                topStatusOverlay
                Spacer()
                framingOverlay
                bottomControls
            }
            .padding()
        }
        .onAppear {
            viewModel.updateEnvironment(environmentStore)
            syncSelectedModeWithModules()
        }
        .onChange(of: environmentStore.authToken, initial: false) { _, _ in
            viewModel.updateEnvironment(environmentStore)
        }
        .onChange(of: environmentStore.enabledYugioh, initial: false) { _, _ in
            syncSelectedModeWithModules()
        }
        .onChange(of: environmentStore.enabledMagic, initial: false) { _, _ in
            syncSelectedModeWithModules()
        }
        .onChange(of: environmentStore.enabledPokemon, initial: false) { _, _ in
            syncSelectedModeWithModules()
        }
        .sheet(item: $viewModel.latestResult, onDismiss: {
            viewModel.clearResult()
        }) { result in
            ScanResultSheet(
                result: result,
                color: accentColor(for: viewModel.selectedMode),
                onAddToBinder: { candidate in
                    guard let card = candidate.details.sourceCard ?? makeCard(from: candidate) else {
                        return
                    }
                    selectedCardForBinder = card
                }
            )
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $selectedCardForBinder) { card in
            AddCardToBinderSheet(card: card) { binderId, quantity, condition, language, notes, isFoil, isSigned, isAltered in
                await addCardToBinder(
                    card: card,
                    binderId: binderId,
                    quantity: quantity,
                    condition: condition,
                    language: language,
                    notes: notes,
                    isFoil: isFoil,
                    isSigned: isSigned,
                    isAltered: isAltered
                )
            }
        }
        .sheet(isPresented: $showingRecentDebugCaptures) {
            RecentDebugCapturesSheet(
                color: accentColor(for: viewModel.selectedMode)
            )
            .environmentObject(environmentStore)
        }
        .alert(isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Alert(
                title: Text("Scan Failed"),
                message: Text(viewModel.errorMessage ?? "An unknown error occurred."),
                dismissButton: .default(Text("OK"), action: {
                    viewModel.clearResult()
                })
            )
        }
    }

    @ViewBuilder
    private var topStatusOverlay: some View {
        switch viewModel.state {
        case .unauthorized:
            Text("Camera access is required. Enable it in Settings to scan cards.")
                .font(.subheadline)
                .foregroundColor(.white)
                .padding(12)
                .background(Color.black.opacity(0.6))
                .cornerRadius(12)
        case .processing:
            HStack(spacing: 8) {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                Text("Identifying card...")
                    .font(.callout)
                    .foregroundColor(.white)
            }
            .padding(12)
            .background(Color.black.opacity(0.6))
            .cornerRadius(12)
        case .error(let message):
            Text(message)
                .font(.subheadline)
                .foregroundColor(.white)
                .padding(12)
                .background(Color.red.opacity(0.7))
                .cornerRadius(12)
        default:
            if !hasEnabledScanModes {
                Text("Enable at least one TCG module in Settings to scan cards.")
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .padding(12)
                    .background(Color.black.opacity(0.6))
                    .cornerRadius(12)
            } else if !isModeSupported {
                Text("\(viewModel.selectedMode.displayName) scanning is coming soon.")
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .padding(12)
                    .background(Color.black.opacity(0.6))
                    .cornerRadius(12)
            } else if !viewModel.supportsLivePreview(viewModel.selectedMode) {
                Text("Tap the shutter to scan \(viewModel.selectedMode.displayName) cards.")
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .padding(12)
                    .background(Color.black.opacity(0.6))
                    .cornerRadius(12)
            } else if viewModel.isAnalyzingFrame {
                HStack(spacing: 8) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    Text("Scanning...")
                        .font(.callout)
                        .foregroundColor(.white)
                }
                .padding(12)
                .background(Color.black.opacity(0.6))
                .cornerRadius(12)
            } else {
                EmptyView()
            }
        }
    }

    private var framingOverlay: some View {
        GeometryReader { geometry in
            let width = min(geometry.size.width - 32, geometry.size.height * 0.7)
            let height = width * 1.4
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(accentColor(for: viewModel.selectedMode).opacity(0.9), lineWidth: 3)
                .frame(width: width, height: height)
                .overlay(
                    Text(viewModel.selectedMode.description)
                        .font(.footnote)
                        .foregroundColor(.white)
                        .padding(8)
                        .background(Color.black.opacity(0.55))
                        .cornerRadius(10)
                        .padding(.top, height / 2 + 24),
                    alignment: .bottom
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var bottomControls: some View {
        VStack(spacing: 16) {
            if hasEnabledScanModes {
                Picker("Mode", selection: $viewModel.selectedMode) {
                    ForEach(availableScanModes) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
            } else {
                Text("Turn on at least one game module in Settings to access scanning.")
                    .font(.footnote)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            if hasEnabledScanModes && isModeSupported {
                debugCaptureControls
            }

            Button(action: {
                viewModel.capturePhoto()
            }) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.15))
                        .frame(width: 84, height: 84)
                    Circle()
                        .fill(accentColor(for: viewModel.selectedMode))
                        .frame(width: 68, height: 68)
                    if isProcessingPhoto {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Image(systemName: "camera.aperture")
                            .font(.title)
                            .foregroundColor(.white)
                    }
                }
            }
            .disabled(
                isProcessingPhoto ||
                isUnauthorized ||
                viewModel.latestResult != nil ||
                !isModeSupported ||
                !hasEnabledScanModes
            )
            .buttonStyle(.plain)
            .padding(.bottom, 12)

            if hasEnabledScanModes && isModeSupported {
                Text("Live preview uses on-device strategies. The shutter runs the full backend scan for the selected game.")
                    .font(.footnote)
                    .foregroundColor(.white.opacity(0.88))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
        }
    }

    private var debugCaptureControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle(isOn: $viewModel.saveDebugCapture) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Save Debug Capture")
                        .font(.subheadline.weight(.semibold))
                        .foregroundColor(.white)
                    Text("Store the upload, derived crops, guess, timings, and pipeline metadata on the server.")
                        .font(.caption)
                        .foregroundColor(.white.opacity(0.82))
                }
            }
            .tint(accentColor(for: viewModel.selectedMode))

            if viewModel.saveDebugCapture {
                TextField("Optional notes: lighting, timestamp, failure mode", text: $viewModel.captureNotes, axis: .vertical)
                    .textInputAutocapitalization(.sentences)
                    .disableAutocorrection(false)
                    .padding(10)
                    .background(Color.white.opacity(0.14))
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .foregroundColor(.white)
            }

            HStack(spacing: 12) {
                Button(showTestingTools ? "Hide Testing Tools" : "Show Testing Tools") {
                    showTestingTools.toggle()
                }
                .font(.footnote.weight(.semibold))
                .foregroundColor(.white)

                if showTestingTools {
                    Button("Recent Debug Captures") {
                        showingRecentDebugCaptures = true
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(accentColor(for: viewModel.selectedMode))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.white)
                    .clipShape(Capsule())
                }

                Spacer()
            }

            if showTestingTools {
                Text("Testing tools stay hidden by default. Turn them off here once you’re done collecting samples.")
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.78))
            }
        }
        .padding(14)
        .background(Color.black.opacity(0.42))
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .padding(.horizontal)
    }

    private func accentColor(for mode: ScanMode) -> Color {
        switch mode {
        case .pokemon: return Color.red
        case .yugioh: return Color.purple
        case .mtg: return Color.green
        }
    }

    private func makeCard(from candidate: CardScanCandidate) -> Card? {
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

    @MainActor
    private func addCardToBinder(
        card: Card,
        binderId: String,
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?,
        isFoil: Bool = false,
        isSigned: Bool = false,
        isAltered: Bool = false
    ) async {
        guard let token = environmentStore.authToken else {
            viewModel.errorMessage = "Not authenticated."
            return
        }

        let apiService = APIService()
        do {
            try await apiService.addCardToBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: binderId,
                cardId: card.id,
                quantity: quantity,
                condition: condition,
                language: language,
                notes: notes,
                price: card.price,
                acquisitionPrice: nil,
                isFoil: isFoil,
                isSigned: isSigned,
                isAltered: isAltered,
                card: card
            )
        } catch {
            viewModel.errorMessage = error.localizedDescription
        }
    }
}

private extension CardScannerView {
    var availableScanModes: [ScanMode] {
        ScanMode.allCases.filter { environmentStore.isGameEnabled($0.tcgGame) }
    }

    var hasEnabledScanModes: Bool {
        !availableScanModes.isEmpty
    }

    func syncSelectedModeWithModules() {
        let modes = availableScanModes
        guard !modes.isEmpty else { return }
        if !modes.contains(viewModel.selectedMode) {
            viewModel.selectedMode = modes[0]
        }
    }

    var isModeSupported: Bool {
        viewModel.isModeSupported(viewModel.selectedMode)
    }

    var isProcessingPhoto: Bool {
        if case .processing = viewModel.state {
            return true
        }
        return false
    }

    var isUnauthorized: Bool {
        if case .unauthorized = viewModel.state {
            return true
        }
        return false
    }

    var isErrorState: Bool {
        if case .error = viewModel.state {
            return true
        }
        return false
    }
}

private struct ScanResultSheet: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var selectedCandidate: CardScanCandidate
    @State private var debugCapture: APIService.ScanDebugCaptureResponse?
    @State private var debugCaptureError: String?
    @State private var isUpdatingDebugCapture = false

    let result: CardScanResult
    let color: Color
    let onAddToBinder: (CardScanCandidate) -> Void

    init(
        result: CardScanResult,
        color: Color,
        onAddToBinder: @escaping (CardScanCandidate) -> Void
    ) {
        self.result = result
        self.color = color
        self.onAddToBinder = onAddToBinder
        _selectedCandidate = State(initialValue: result.primary)
        _debugCapture = State(initialValue: result.debugCapture)
        _debugCaptureError = State(initialValue: result.debugCaptureError)
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    headerSection
                    confidenceSection
                    matcherSection
                    if debugCapture != nil || debugCaptureError != nil {
                        debugCaptureSection
                    }
                    if !result.alternatives.isEmpty {
                        alternativesSection
                    }
                }
                .padding()
            }
            .navigationTitle("Scan Result")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add to Binder") {
                        onAddToBinder(selectedCandidate)
                    }
                    .disabled(candidateCard == nil)
                }
            }
        }
    }

    private var candidateCard: Card? {
        if let existing = selectedCandidate.details.sourceCard {
            return existing
        }
        let details = selectedCandidate.details
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

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let preview = capturedImage {
                preview
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(color.opacity(0.25), lineWidth: 2)
                    )
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(color.opacity(0.15))
                    .frame(height: 200)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(selectedCandidate.details.identity.name)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.leading)
                if let setName = selectedCandidate.details.identity.setName {
                    Text(setName)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Text(selectedCandidate.details.identity.game.displayName)
                    .font(.caption)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(color.opacity(0.18))
                    .clipShape(Capsule())
            }

            if let rarity = selectedCandidate.details.rarity {
                Label(rarity, systemImage: "star.fill")
                    .foregroundColor(color)
                    .font(.subheadline)
            }

            if environmentStore.showPricing, let price = selectedCandidate.details.price {
                Label(String(format: "$%.2f", price), systemImage: "dollarsign.circle")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var confidenceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Match Score")
                .font(.headline)
            Text(String(format: "%.0f%%", selectedCandidate.confidence.score * 100))
                .font(.title2)
                .fontWeight(.semibold)
            if let reason = selectedCandidate.confidence.reason {
                Text(reason)
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var matcherSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Matcher")
                .font(.headline)

            ScanMetricRow(label: "Strategy", value: selectedCandidate.originatingStrategy.rawValue)
            ScanMetricRow(label: "Elapsed", value: String(format: "%.2fs", result.elapsed))

            ForEach(selectedCandidate.debugInfo.keys.sorted(), id: \.self) { key in
                if let value = selectedCandidate.debugInfo[key] {
                    ScanMetricRow(label: key, value: value)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var debugCaptureSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Debug Capture")
                    .font(.headline)
                Spacer()
                if isUpdatingDebugCapture {
                    ProgressView()
                        .progressViewStyle(.circular)
                }
            }

            if let debugCaptureError, !debugCaptureError.isEmpty {
                Text(debugCaptureError)
                    .font(.footnote)
                    .foregroundColor(.red)
            }

            if let capture = debugCapture {
                HStack(spacing: 8) {
                    statusBadge(for: capture.feedbackStatus)
                    if let createdAt = formattedTimestamp(capture.createdAt) {
                        Text(createdAt)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                ScanMetricRow(label: "Capture ID", value: shortIdentifier(capture.id))
                if let captureSource = capture.captureSource, !captureSource.isEmpty {
                    ScanMetricRow(label: "Source", value: captureSource)
                }
                if let notes = capture.notes, !notes.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Notes")
                            .font(.footnote)
                            .foregroundColor(.secondary)
                        Text(notes)
                            .font(.subheadline)
                            .foregroundColor(.primary)
                    }
                }

                reviewStatusSection(capture: capture)
                reviewTagsSection(capture: capture)

                if hasArtifactImages(for: capture) {
                    DisclosureGroup("Artifact Crops") {
                        artifactImagesSection(capture: capture)
                            .padding(.top, 8)
                    }
                }

                if let timings = capture.diagnostics?.timings {
                    DisclosureGroup("Timings") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(timingRows(for: timings), id: \.label) { row in
                                ScanMetricRow(label: row.label, value: row.value)
                            }
                        }
                        .padding(.top, 8)
                    }
                }

                if let geometry = capture.diagnostics?.geometry {
                    DisclosureGroup("Geometry") {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(geometryRows(for: geometry), id: \.label) { row in
                                ScanMetricRow(label: row.label, value: row.value)
                            }
                        }
                        .padding(.top, 8)
                    }
                }

                if let pipeline = capture.pipeline {
                    DisclosureGroup("Pipeline") {
                        VStack(alignment: .leading, spacing: 6) {
                            ScanMetricRow(label: "Git SHA", value: shortIdentifier(pipeline.build.gitSha))
                            if let imageTag = pipeline.build.imageTag, !imageTag.isEmpty {
                                ScanMetricRow(label: "Image", value: imageTag)
                            }
                            if let backendMode = pipeline.build.backendMode, !backendMode.isEmpty {
                                ScanMetricRow(label: "Backend", value: backendMode)
                            }
                            ScanMetricRow(label: "Hash DB", value: formatRevision(pipeline.hashDatabase.dataset))
                            ScanMetricRow(label: "Artwork DB", value: formatRevision(pipeline.artworkDatabase.dataset))
                            ScanMetricRow(label: "pHash", value: pipeline.matcher.phashVersion)
                            ScanMetricRow(label: "Artwork", value: pipeline.matcher.artworkVersion)
                            if let detectorModelVersion = pipeline.matcher.detectorModelVersion, !detectorModelVersion.isEmpty {
                                ScanMetricRow(label: "Detector", value: detectorModelVersion)
                            }
                            if let ocrModelVersion = pipeline.matcher.ocrModelVersion, !ocrModelVersion.isEmpty {
                                ScanMetricRow(label: "OCR", value: ocrModelVersion)
                            }
                        }
                        .padding(.top, 8)
                    }
                }

                if let artwork = capture.diagnostics?.artwork,
                   !artwork.prefilterTopMatches.isEmpty || !artwork.rerankTopMatches.isEmpty {
                    DisclosureGroup("Artwork Diagnostics") {
                        VStack(alignment: .leading, spacing: 10) {
                            if !artwork.prefilterTopMatches.isEmpty {
                                diagnosticCandidateList(
                                    title: artwork.prefilterApplied ? "Prefilter Top Matches" : "Artwork Top Matches",
                                    rows: artwork.prefilterTopMatches.map {
                                        DiagnosticRow(
                                            title: $0.name,
                                            subtitle: $0.setCode,
                                            trailing: String(format: "%.3f", $0.similarity)
                                        )
                                    }
                                )
                            }
                            if !artwork.rerankTopMatches.isEmpty {
                                diagnosticCandidateList(
                                    title: "Rerank Top Matches",
                                    rows: artwork.rerankTopMatches.map {
                                        DiagnosticRow(
                                            title: $0.name,
                                            subtitle: $0.setCode,
                                            trailing: String(format: "%.3f", $0.similarity)
                                        )
                                    }
                                )
                            }
                        }
                        .padding(.top, 8)
                    }
                }

                if let ocr = capture.diagnostics?.ocr, ocr.attempted || !ocr.candidates.isEmpty {
                    DisclosureGroup("OCR Diagnostics") {
                        VStack(alignment: .leading, spacing: 6) {
                            ScanMetricRow(label: "Attempted", value: ocr.attempted ? "Yes" : "No")
                            if let duration = formatDuration(ocr.durationMs) {
                                ScanMetricRow(label: "OCR Time", value: duration)
                            }
                            ForEach(Array(ocr.candidates.prefix(5).enumerated()), id: \.offset) { entry in
                                let candidate = entry.element
                                ScanMetricRow(
                                    label: candidate.text,
                                    value: String(format: "%.2f", candidate.confidence)
                                )
                            }
                        }
                        .padding(.top, 8)
                    }
                }

                if let attempts = capture.diagnostics?.attempts, !attempts.isEmpty {
                    DisclosureGroup("Variant Attempts") {
                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(Array(attempts.prefix(4).enumerated()), id: \.offset) { entry in
                                let attempt = entry.element
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("\(attempt.variant) · threshold \(attempt.threshold)")
                                        .font(.subheadline.weight(.medium))
                                    HStack(spacing: 12) {
                                        if let hashMs = formatDuration(attempt.hashMs) {
                                            Text("hash \(hashMs)")
                                        }
                                        if let rankingMs = formatDuration(attempt.rankingMs) {
                                            Text("rank \(rankingMs)")
                                        }
                                        Text("shortlist \(attempt.shortlistSize)")
                                    }
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                }
                                .padding(10)
                                .background(Color(.tertiarySystemBackground))
                                .cornerRadius(10)
                            }
                        }
                        .padding(.top, 8)
                    }
                }

                if let nearMisses = capture.diagnostics?.rejectedNearMisses, !nearMisses.isEmpty {
                    DisclosureGroup("Rejected Near Misses") {
                        diagnosticCandidateList(
                            title: nil,
                            rows: nearMisses.prefix(6).map {
                                DiagnosticRow(
                                    title: $0.name,
                                    subtitle: $0.setCode,
                                    trailing: "d \($0.distance)"
                                )
                            }
                        )
                        .padding(.top, 8)
                    }
                }
            } else {
                Text("Enable Save Debug Capture before scanning to persist crops and diagnostics from the phone.")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var alternativesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Alternatives")
                .font(.headline)
            ForEach(result.alternatives, id: \.id) { candidate in
                Button {
                    selectedCandidate = candidate
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(candidate.details.identity.name)
                                .font(.subheadline)
                                .foregroundColor(.primary)
                            if let setName = candidate.details.identity.setName {
                                Text(setName)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        Spacer()
                        Text(String(format: "%.0f%%", candidate.confidence.score * 100))
                            .font(.footnote)
                            .foregroundColor(.secondary)
                        if candidate.id == selectedCandidate.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(color)
                        }
                    }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(candidate.id == selectedCandidate.id ? color : Color.gray.opacity(0.3), lineWidth: candidate.id == selectedCandidate.id ? 2 : 1)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private func reviewStatusSection(capture: APIService.ScanDebugCaptureResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Review Status")
                .font(.subheadline.weight(.medium))
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(reviewStatuses, id: \.rawValue) { status in
                    Button {
                        Task { await updateDebugCapture(feedbackStatus: status, reviewTags: nil) }
                    } label: {
                        Text(status.displayLabel)
                            .font(.footnote.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(capture.feedbackStatus == status ? feedbackColor(for: status).opacity(0.18) : Color(.tertiarySystemBackground))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(capture.feedbackStatus == status ? feedbackColor(for: status) : Color.gray.opacity(0.2), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(isUpdatingDebugCapture)
                }
            }
        }
    }

    private func reviewTagsSection(capture: APIService.ScanDebugCaptureResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Failure Tags")
                .font(.subheadline.weight(.medium))
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                ForEach(CardScanReviewTag.allCases) { tag in
                    let isSelected = capture.reviewTags.contains(tag)
                    Button {
                        var nextTags = capture.reviewTags
                        if isSelected {
                            nextTags.removeAll { $0 == tag }
                        } else {
                            nextTags.append(tag)
                        }
                        Task { await updateDebugCapture(feedbackStatus: nil, reviewTags: nextTags) }
                    } label: {
                        Text(tag.displayLabel)
                            .font(.caption.weight(.medium))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 9)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(isSelected ? color.opacity(0.16) : Color(.tertiarySystemBackground))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(isSelected ? color : Color.gray.opacity(0.2), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(isUpdatingDebugCapture)
                }
            }
        }
    }

    private func artifactImagesSection(capture: APIService.ScanDebugCaptureResponse) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(artifactImageItems(for: capture), id: \.title) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(item.title)
                            .font(.caption.weight(.medium))
                        CachedAsyncImage(url: item.url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                            case .failure:
                                Color.red.opacity(0.1)
                                    .overlay(Image(systemName: "exclamationmark.triangle").foregroundColor(.red))
                            default:
                                Color.gray.opacity(0.12)
                                    .overlay(ProgressView())
                            }
                        }
                        .frame(width: 140, height: 196)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.gray.opacity(0.2), lineWidth: 1)
                        )
                    }
                    .frame(width: 140, alignment: .leading)
                }
            }
        }
    }

    private func diagnosticCandidateList(
        title: String?,
        rows: [DiagnosticRow]
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                Text(title)
                    .font(.subheadline.weight(.medium))
            }
            ForEach(Array(rows.enumerated()), id: \.offset) { entry in
                let row = entry.element
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(row.title)
                            .font(.subheadline)
                        Spacer()
                        Text(row.trailing)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundColor(.secondary)
                    }
                    if let subtitle = row.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding(10)
                .background(Color(.tertiarySystemBackground))
                .cornerRadius(10)
            }
        }
    }

    private func updateDebugCapture(
        feedbackStatus: CardScanDebugFeedbackStatus?,
        reviewTags: [CardScanReviewTag]?
    ) async {
        guard let capture = debugCapture else { return }
        guard let token = environmentStore.authToken else {
            debugCaptureError = "You need to be logged in to update debug captures."
            return
        }

        isUpdatingDebugCapture = true
        defer { isUpdatingDebugCapture = false }

        do {
            let updatedCapture = try await APIService().updateScanDebugCapture(
                config: environmentStore.serverConfiguration,
                token: token,
                captureId: capture.id,
                feedbackStatus: feedbackStatus,
                reviewTags: reviewTags
            )
            debugCapture = updatedCapture
            debugCaptureError = nil
        } catch {
            debugCaptureError = error.localizedDescription
        }
    }

    private var reviewStatuses: [CardScanDebugFeedbackStatus] {
        [.correct, .incorrect, .needsReview, .unreviewed]
    }

    private func statusBadge(for status: CardScanDebugFeedbackStatus) -> some View {
        Text(status.displayLabel)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(feedbackColor(for: status).opacity(0.14))
            .foregroundColor(feedbackColor(for: status))
            .clipShape(Capsule())
    }

    private func feedbackColor(for status: CardScanDebugFeedbackStatus) -> Color {
        switch status {
        case .correct:
            return .green
        case .incorrect:
            return .red
        case .needsReview:
            return .orange
        case .unreviewed:
            return .secondary
        }
    }

    private func hasArtifactImages(for capture: APIService.ScanDebugCaptureResponse) -> Bool {
        !artifactImageItems(for: capture).isEmpty
    }

    private func artifactImageItems(
        for capture: APIService.ScanDebugCaptureResponse
    ) -> [ArtifactImageItem] {
        [
            ArtifactImageItem(title: "Original", url: URL(string: capture.sourceImageUrl)),
            ArtifactImageItem(title: "Corrected", url: URL(string: capture.artifactImages.correctedImageUrl ?? "")),
            ArtifactImageItem(title: "Artwork", url: URL(string: capture.artifactImages.artworkImageUrl ?? "")),
            ArtifactImageItem(title: "Title", url: URL(string: capture.artifactImages.titleImageUrl ?? "")),
            ArtifactImageItem(title: "Footer", url: URL(string: capture.artifactImages.footerImageUrl ?? ""))
        ]
        .filter { $0.url != nil }
    }

    private func timingRows(
        for timings: APIService.ScanTimingMetricsResponse
    ) -> [MetricRowValue] {
        let entries: [(String, Double?)] = [
            ("Preprocess", timings.preprocessMs),
            ("Perspective", timings.perspectiveCorrectionMs),
            ("Quality", timings.qualityMs),
            ("Hash", timings.hashMs),
            ("Feature Hash", timings.featureHashMs),
            ("Ranking", timings.rankingMs),
            ("Artwork Prefilter", timings.artworkPrefilterMs),
            ("Artwork Rerank", timings.artworkRerankMs),
            ("OCR", timings.ocrMs),
            ("Total", timings.totalMs)
        ]

        return entries.compactMap { entry in
            guard let value = formatDuration(entry.1) else { return nil }
            return MetricRowValue(label: entry.0, value: value)
        }
    }

    private func geometryRows(
        for geometry: APIService.ScanGeometryResponse
    ) -> [MetricRowValue] {
        var rows: [MetricRowValue] = []
        if let corrected = geometry.perspectiveCorrected {
            rows.append(MetricRowValue(label: "Perspective", value: corrected ? "Corrected" : "Raw"))
        }
        if let contourAreaRatio = geometry.contourAreaRatio {
            rows.append(MetricRowValue(label: "Contour Area", value: String(format: "%.3f", contourAreaRatio)))
        }
        if let contourConfidence = geometry.contourConfidence {
            rows.append(MetricRowValue(label: "Contour Confidence", value: String(format: "%.3f", contourConfidence)))
        }
        if let rotationAngle = geometry.rotationAngle {
            rows.append(MetricRowValue(label: "Rotation", value: String(format: "%.1f°", rotationAngle)))
        }
        if let cropAspectRatio = geometry.cropAspectRatio {
            rows.append(MetricRowValue(label: "Crop Aspect", value: String(format: "%.3f", cropAspectRatio)))
        }
        if let cropWidth = geometry.cropWidth, let cropHeight = geometry.cropHeight {
            rows.append(MetricRowValue(label: "Crop Size", value: "\(Int(cropWidth))×\(Int(cropHeight))"))
        }
        if let cropCandidateScore = geometry.cropCandidateScore {
            rows.append(MetricRowValue(label: "Crop Score", value: String(format: "%.3f", cropCandidateScore)))
        }
        if let maskVariant = geometry.maskVariant, !maskVariant.isEmpty {
            rows.append(MetricRowValue(label: "Mask", value: maskVariant))
        }
        return rows
    }

    private func formattedTimestamp(_ value: String?) -> String? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        let date = formatter.date(from: value)
        if let date {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return value
    }

    private func shortIdentifier(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "unknown" }
        if value.count <= 12 {
            return value
        }
        return String(value.prefix(7))
    }

    private func formatRevision(_ revision: APIService.ScanDatasetRevisionResponse?) -> String {
        guard let revision else { return "unknown" }
        if let total = revision.total {
            return "\(revision.revision) · \(total) entries"
        }
        return revision.revision
    }

    private func formatDuration(_ milliseconds: Double?) -> String? {
        guard let milliseconds, milliseconds.isFinite else { return nil }
        if milliseconds >= 1000 {
            return String(format: "%.2fs", milliseconds / 1000)
        }
        return String(format: "%.0fms", milliseconds)
    }
}

private extension ScanResultSheet {
    var capturedImage: Image? {
        Image(
            uiImage: UIImage(cgImage: result.capturedImage)
        )
    }
}

private struct ArtifactImageItem {
    let title: String
    let url: URL?
}

private struct DiagnosticRow {
    let title: String
    let subtitle: String?
    let trailing: String
}

private struct MetricRowValue {
    let label: String
    let value: String
}

private struct ScanMetricRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.footnote)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.system(.footnote, design: .monospaced))
                .foregroundColor(.primary)
                .multilineTextAlignment(.trailing)
        }
    }
}

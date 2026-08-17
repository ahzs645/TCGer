import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import Combine

struct PackOpeningView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = "Loading"
    @State private var errorMessage: String?
    @State private var reloadID = UUID()
    @State private var presentedSheet: SheetDestination?
    @State private var interfaceState = PackOpeningInterfaceState.loading
    @State private var command: PackOpeningCommand?
    @State private var selectedArtwork: PhotosPickerItem?
    @State private var summaryInspectedPullIndex: Int?
    @State private var rendererReady = false
    @State private var prefetchedSessionID: String?
    @StateObject private var webSession: PackOpeningWebSession
    @StateObject private var offlinePackDownloads = PackOfflineDownloadManager.shared

    @MainActor
    init(webSession: PackOpeningWebSession? = nil) {
        let resolvedSession = webSession ?? PackOpeningWebSession()
        _webSession = StateObject(wrappedValue: resolvedSession)
        _interfaceState = State(initialValue: resolvedSession.latestInterfaceState ?? .loading)
        _rendererReady = State(initialValue: resolvedSession.isReady)
    }

    var body: some View {
        ZStack {
            packScenePlaceholder

            PackOpeningWebView(session: webSession, command: command) { event in
                handle(event)
            }
            .id(reloadID)
            .opacity(interfaceState.showsNativeResults ? 0 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: interfaceState.showsNativeResults)
            .ignoresSafeArea()

            if interfaceState.showsNativeResults, let session = interfaceState.session {
                PackOpeningNativeResultsView(
                    session: session,
                    inspectedPullIndex: $summaryInspectedPullIndex
                )
                    .transition(.opacity)
            }

            VStack(spacing: 0) {
                topOverlay
                Spacer(minLength: 24)
                if let errorMessage {
                    errorOverlay(errorMessage)
                } else if rendererReady && closeUpPull == nil {
                    bottomOverlay
                }
            }
            .padding(.horizontal, 16)
            .safeAreaPadding(.top, 8)
            .safeAreaPadding(.bottom, 12)

            if let inspectedPull = closeUpPull {
                PackOpeningCardCloseUp(
                    pull: inspectedPull,
                    identity: closeUpIdentity,
                    onClose: {
                        closeCardInspection()
                    },
                    onSwipe: { direction in
                        swipeInspectedCard(direction: direction)
                    }
                )
                .transition(.scale(scale: 0.78).combined(with: .opacity))
                .zIndex(10)
            }
        }
        .sheet(item: $presentedSheet) { destination in
            switch destination {
            case .packSelection:
                PackSelectionSheet(
                    packSets: interfaceState.packSets,
                    selectedPackID: interfaceState.selectedPackID,
                    downloadManager: offlinePackDownloads
                ) { optionID in
                    send(.selectPack(optionID))
                }
            case .review(let session):
                PackOpeningReviewSheet(session: session) {
                    phase = "Saved to collection"
                }
            }
        }
        .onChange(of: selectedArtwork) { _, item in
            guard let item else { return }
            Task {
                defer { selectedArtwork = nil }
                guard let data = try? await item.loadTransferable(type: Data.self) else { return }
                let mimeType = item.supportedContentTypes.first?.preferredMIMEType ?? "image/jpeg"
                send(.uploadArtwork(
                    dataURL: "data:\(mimeType);base64,\(data.base64EncodedString())",
                    label: "Custom Artwork"
                ))
            }
        }
        .onReceive(NetworkMonitor.shared.$isConnected.removeDuplicates()) { isConnected in
            webSession.setPrefersBundledResources(!isConnected)
            guard !isConnected, !webSession.isReady else { return }

            // A warm-up request may have started while NWPathMonitor still
            // held its optimistic initial value. Restart it against the
            // bundled manifest and mesh instead of leaving a blank web view
            // waiting for an HTTP timeout.
            errorMessage = nil
            interfaceState = .loading
            rendererReady = false
            webSession.reload()
            reloadID = UUID()
        }
        .onDisappear {
            webSession.send(.backToPacks)
        }
    }

    private var inspectedSummaryPull: PackOpeningPull? {
        guard
            let summaryInspectedPullIndex,
            let pulls = interfaceState.session?.pulls,
            pulls.indices.contains(summaryInspectedPullIndex)
        else { return nil }
        return pulls[summaryInspectedPullIndex]
    }

    private var closeUpPull: PackOpeningPull? {
        inspectedSummaryPull
    }

    private var closeUpIdentity: String {
        return "summary-\(summaryInspectedPullIndex ?? -1)"
    }

    private func closeCardInspection() {
        withAnimation(.snappy) {
            summaryInspectedPullIndex = nil
        }
    }

    private func swipeInspectedCard(direction: Int) {
        guard
            let summaryInspectedPullIndex,
            let pulls = interfaceState.session?.pulls
        else { return }
        let nextIndex = summaryInspectedPullIndex + direction
        guard pulls.indices.contains(nextIndex) else {
            closeCardInspection()
            return
        }
        withAnimation(.snappy) { self.summaryInspectedPullIndex = nextIndex }
    }

    private var packScenePlaceholder: some View {
        Color(uiColor: .systemBackground)
            .overlay {
                LinearGradient(
                    colors: [
                        Color(uiColor: .secondarySystemBackground).opacity(0.4),
                        .clear,
                        Color.primary.opacity(0.05),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .ignoresSafeArea()
    }

    private var topOverlay: some View {
        GlassEffectContainer(spacing: 12) {
            HStack(alignment: .center, spacing: 12) {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Done")

                if interfaceState.showsNativeResults, let session = interfaceState.session {
                    PackOpeningResultSummary(session: session)
                } else {
                    Spacer(minLength: 0)
                }

                if interfaceState.phase == .select {
                    Menu {
                        PhotosPicker(selection: $selectedArtwork, matching: .images) {
                            Label("Choose Pack Photo", systemImage: "photo.badge.plus")
                        }
                    } label: {
                        Image(systemName: "ellipsis")
                            .font(.headline)
                            .frame(width: 28, height: 28)
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel("More pack options")
                }
            }
        }
    }

    private var bottomOverlay: some View {
        GlassEffectContainer(spacing: 12) {
            VStack(spacing: 10) {
                if let warning = interfaceState.warning {
                    Label(warning, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .glassEffect(.regular, in: .capsule)
                }
                phaseControls
            }
            .frame(maxWidth: .infinity)
        }
    }

    @ViewBuilder
    private var phaseControls: some View {
        switch interfaceState.phase {
        case .loading:
            HStack(spacing: 10) {
                ProgressView()
                Text("Preparing packs…")
                    .font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .glassEffect(.regular, in: .capsule)

        case .select:
            VStack(spacing: 10) {
                if interfaceState.packCount == 1 {
                    Picker("Opening style", selection: Binding(
                        get: { interfaceState.openingMode },
                        set: { send(.setOpeningMode($0)) }
                    )) {
                        Label("Open Normally", systemImage: "sparkles").tag(PackOpeningInterfaceState.OpeningMode.normal)
                        Label("Quick Open", systemImage: "bolt.fill").tag(PackOpeningInterfaceState.OpeningMode.quick)
                    }
                    .pickerStyle(.segmented)
                    .accessibilityHint("Normal opens and reveals the pack card by card. Quick Open skips all opening animations and goes directly to its results.")
                } else {
                    Label(
                        "\(interfaceState.packCount)-Pack Summary",
                        systemImage: "rectangle.grid.2x2.fill"
                    )
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .frame(maxWidth: .infinity)
                    .glassEffect(.regular, in: .capsule)
                    .accessibilityHint("Multi-pack openings show the stacked cutting animation, then go directly to grouped results.")
                }

                Button {
                    presentedSheet = .packSelection
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "square.stack.3d.up.fill")
                        Text(interfaceState.selectedPackDisplayLabel)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .lineLimit(1)
                        Image(systemName: "chevron.up.chevron.down")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Choose set and pack, currently \(interfaceState.selectedPackDisplayLabel)")

                HStack(spacing: 8) {
                    ForEach([1, 5, 10], id: \.self) { count in
                        packCountButton(count)
                    }

                    Button {
                        send(.openPack)
                    } label: {
                        Text(interfaceState.packCount == 1 ? "Open Pack" : "Open \(interfaceState.packCount) Packs")
                            .fontWeight(.semibold)
                    }
                    .buttonStyle(.glassProminent)
                }
            }

        case .tear:
            VStack(spacing: 10) {
                instruction(
                    interfaceState.packBackwards
                        ? "Back facing · swipe across the seal, or open it now"
                        : "Swipe across the seal, or open it now",
                    icon: "hand.draw.fill"
                )
                HStack(spacing: 10) {
                    backButton
                    Button {
                        send(.togglePackOrientation)
                    } label: {
                        Label(interfaceState.packBackwards ? "Face Front" : "Flip Pack", systemImage: "arrow.triangle.2.circlepath")
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    .buttonStyle(.glass)
                    .layoutPriority(1)
                    Button("Open Pack") { send(.advance) }
                        .buttonStyle(.glassProminent)
                }
                if interfaceState.totalPacks > 1 {
                    Button("Skip Animations · Keep Grouped Results") { send(.showAll) }
                        .font(.caption.weight(.semibold))
                        .buttonStyle(.glass)
                }
            }

        case .opening:
            VStack(spacing: 10) {
                instruction(
                    interfaceState.totalPacks == 1 ? "Opening your pack…" : "Opening \(interfaceState.totalPacks) packs…",
                    icon: "sparkles"
                )
                HStack(spacing: 10) {
                    backButton
                    if interfaceState.totalPacks > 1 {
                        Button("Skip to Results") { send(.showAll) }
                            .buttonStyle(.glass)
                    }
                }
            }

        case .reveal:
            VStack(spacing: 10) {
                instruction(
                    revealInstruction,
                    icon: interfaceState.packBackwards ? "rectangle.portrait.on.rectangle.portrait.angled" : "rectangle.stack.fill"
                )
                HStack(spacing: 10) {
                    if !interfaceState.packBackwards {
                        backButton
                    }
                    Button(revealActionLabel) {
                        send(.advance)
                    }
                    .buttonStyle(.glassProminent)
                    Button(interfaceState.totalPacks > 1 ? "Skip to Results" : "Show All") { send(.showAll) }
                        .buttonStyle(.glass)
                }
            }

        case .summary, .final:
            HStack(spacing: 10) {
                if interfaceState.canSave {
                    Button("Save Pulls") { send(.savePulls) }
                        .buttonStyle(.glassProminent)
                    Button("Open More") { send(.backToPacks) }
                        .buttonStyle(.glass)
                } else {
                    Button("Open More") { send(.backToPacks) }
                        .buttonStyle(.glassProminent)
                }
            }
        }
    }

    private var revealInstruction: String {
        guard interfaceState.packBackwards else {
            return "\(interfaceState.revealedCount) of \(interfaceState.totalCards) cards revealed"
        }
        return interfaceState.currentCardFaceUp
            ? "Swipe card away"
            : "Tap to flip"
    }

    private var revealActionLabel: String {
        if interfaceState.revealedCount >= interfaceState.totalCards,
           interfaceState.currentCardFaceUp {
            return "Finish"
        }
        guard interfaceState.packBackwards else { return "Reveal Next" }
        return interfaceState.currentCardFaceUp ? "Slide Card" : "Flip Card"
    }

    @ViewBuilder
    private func packCountButton(_ count: Int) -> some View {
        if interfaceState.packCount == count {
            Button("×\(count)") { send(.setPackCount(count)) }
                .buttonStyle(.glassProminent)
                .accessibilityLabel("Open \(count) \(count == 1 ? "pack" : "packs")")
        } else {
            Button("×\(count)") { send(.setPackCount(count)) }
                .buttonStyle(.glass)
                .accessibilityLabel("Open \(count) \(count == 1 ? "pack" : "packs")")
        }
    }

    private var backButton: some View {
        Button {
            send(.backToPacks)
        } label: {
            Label("Packs", systemImage: "chevron.backward")
        }
        .buttonStyle(.glass)
    }

    private func instruction(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(.subheadline.weight(.semibold))
            .padding(.horizontal, 16)
            .padding(.vertical, 11)
            .glassEffect(.regular, in: .capsule)
    }

    private func errorOverlay(_ message: String) -> some View {
        ContentUnavailableView {
            Label("Pack Opening Unavailable", systemImage: "shippingbox")
        } description: {
            Text(message)
        } actions: {
            Button("Try Again") {
                errorMessage = nil
                interfaceState = .loading
                command = nil
                rendererReady = false
                prefetchedSessionID = nil
                webSession.reload()
                reloadID = UUID()
            }
            .buttonStyle(.glassProminent)
        }
        .padding(20)
        .glassEffect(.regular, in: .rect(cornerRadius: 32))
    }

    private func send(_ command: PackOpeningCommand) {
        self.command = command
    }

    private func handle(_ event: PackOpeningBridgeEvent) {
        switch event {
        case .ready:
            phase = "Choose a pack"
            errorMessage = nil
            rendererReady = true
        case .phaseChanged(let value):
            phase = value.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
                .capitalized
        case .interfaceState(let state):
            if state.phase != .summary && state.phase != .final {
                summaryInspectedPullIndex = nil
            }
            if let session = state.session, prefetchedSessionID != session.id {
                prefetchedSessionID = session.id
                ImageCache.shared.prefetch(urls: session.resultArtworkURLs)
            }
            interfaceState = state
        case .inspectRequested:
            // Reveal cards stay inside the shared pack scene. Older cached
            // renderers may still emit this event, so deliberately ignore it.
            break
        case .haptic(let style):
            switch style {
            case "selection": HapticManager.selection()
            case "success": HapticManager.notification(.success)
            default: HapticManager.impact(.medium)
            }
        case .saveRequested(let session):
            presentedSheet = .review(session)
        case .error(let message):
            errorMessage = message
        }
    }
}
private extension PackOpeningView {
    enum SheetDestination: Identifiable {
        case packSelection
        case review(PackOpeningPullSession)

        var id: String {
            switch self {
            case .packSelection:
                "pack-selection"
            case .review(let session):
                "review-\(session.id)"
            }
        }
    }
}

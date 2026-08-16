import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import Combine
@preconcurrency import WebKit

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
    @State private var revealInspectedCardIndex: Int?
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
            case .review(let session):
                PackOpeningReviewSheet(session: session) {
                    phase = "Saved to collection"
                }
            case .oddsReference(let reference):
                PackOddsSourceSheet(reference: reference)
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

    private var inspectedRevealPull: PackOpeningPull? {
        guard
            let revealInspectedCardIndex,
            interfaceState.phase == .reveal,
            let session = interfaceState.session,
            interfaceState.currentPackNumber > 0,
            session.packs.indices.contains(interfaceState.currentPackNumber - 1)
        else { return nil }

        let pack = session.packs[interfaceState.currentPackNumber - 1]
        guard
            pack.indices.contains(revealInspectedCardIndex),
            revealInspectedCardIndex < interfaceState.revealedCount
        else { return nil }
        return pack[revealInspectedCardIndex]
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
        inspectedRevealPull ?? inspectedSummaryPull
    }

    private var closeUpIdentity: String {
        if let revealInspectedCardIndex {
            return "reveal-\(interfaceState.currentPackNumber)-\(revealInspectedCardIndex)"
        }
        return "summary-\(summaryInspectedPullIndex ?? -1)"
    }

    private func closeCardInspection() {
        withAnimation(.snappy) {
            revealInspectedCardIndex = nil
            summaryInspectedPullIndex = nil
        }
    }

    private func swipeInspectedCard(direction: Int) {
        if let revealInspectedCardIndex {
            let nextIndex = revealInspectedCardIndex + direction
            if nextIndex >= 0, nextIndex < interfaceState.revealedCount {
                withAnimation(.snappy) { self.revealInspectedCardIndex = nextIndex }
            } else if direction > 0,
                      revealInspectedCardIndex == interfaceState.revealedCount - 1 {
                send(.advance)
            } else {
                closeCardInspection()
            }
            return
        }

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
                if interfaceState.showsNativeResults, let session = interfaceState.session {
                    PackOpeningResultSummary(session: session)
                } else {
                    Spacer(minLength: 0)
                }

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Done")
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
                    .accessibilityHint("Normal reveals the pack card by card. Quick Open goes directly to its results.")
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
                    .accessibilityHint("Multi-pack openings go directly to grouped results.")
                }

                HStack(spacing: 10) {
                    Menu {
                        ForEach(interfaceState.packSets) { set in
                            Button(set.label) {
                                guard let firstOption = set.options.first else { return }
                                send(.selectPack(firstOption.id))
                            }
                        }
                    } label: {
                        Label(interfaceState.selectedSetLabel, systemImage: "square.stack.3d.up.fill")
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .lineLimit(1)
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel("Pokémon set, \(interfaceState.selectedSetLabel)")

                    if let reference = interfaceState.selectedOddsReference {
                        Button {
                            presentedSheet = .oddsReference(reference)
                        } label: {
                            Image(systemName: "info.circle")
                                .frame(width: 24, height: 24)
                        }
                        .buttonStyle(.glass)
                        .accessibilityLabel("About \(interfaceState.selectedSetLabel) pack odds")
                    }

                    PhotosPicker(selection: $selectedArtwork, matching: .images) {
                        Image(systemName: "photo.badge.plus")
                            .frame(width: 24, height: 24)
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel("Use custom pack artwork")
                }

                if let status = offlinePackDownloads.status(forSetID: interfaceState.selectedSetID) {
                    PackOfflineAvailabilityLabel(status: status)
                        .font(.caption.weight(.semibold))
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if interfaceState.selectedSetOptions.count > 1 {
                    Menu {
                        ForEach(interfaceState.selectedSetOptions) { option in
                            Button(option.resolvedVariationLabel) {
                                send(.selectPack(option.id))
                            }
                        }
                    } label: {
                        Label(
                            interfaceState.selectedVariationLabel,
                            systemImage: "rectangle.portrait.on.rectangle.portrait"
                        )
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .lineLimit(1)
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel("Pack artwork, \(interfaceState.selectedVariationLabel)")
                }

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
                    "\(interfaceState.revealedCount) of \(interfaceState.totalCards) cards revealed",
                    icon: "rectangle.stack.fill"
                )
                HStack(spacing: 10) {
                    backButton
                    Button(interfaceState.revealedCount >= interfaceState.totalCards ? "Finish" : "Reveal Next") {
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
            if state.phase != .reveal {
                revealInspectedCardIndex = nil
            } else if revealInspectedCardIndex != nil,
                      state.revealedCount > interfaceState.revealedCount {
                revealInspectedCardIndex = state.revealedCount - 1
            }
            if state.phase != .summary && state.phase != .final {
                summaryInspectedPullIndex = nil
            }
            if let session = state.session, prefetchedSessionID != session.id {
                prefetchedSessionID = session.id
                ImageCache.shared.prefetch(urls: session.resultArtworkURLs)
            }
            interfaceState = state
        case .inspectRequested(_):
            guard interfaceState.phase == .reveal else { return }
            withAnimation(.snappy) {
                revealInspectedCardIndex = max(0, interfaceState.revealedCount - 1)
            }
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

private struct PackOpeningNativeResultsView: View {
    let session: PackOpeningPullSession
    @Binding var inspectedPullIndex: Int?

    private let columns = [
        GridItem(.flexible(minimum: 120), spacing: 14),
        GridItem(.flexible(minimum: 120), spacing: 14),
    ]

    private var bestPull: PackOpeningPull? {
        session.pulls.max { tierRank($0.tier) < tierRank($1.tier) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if session.packs.count > 1, let bestPull {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Best Pull", systemImage: "sparkles")
                            .font(.title3.bold())
                            .foregroundStyle(.orange)

                        PackOpeningNativeResultCard(pull: bestPull) {
                            withAnimation(.snappy) {
                                inspectedPullIndex = session.pulls.firstIndex(of: bestPull)
                            }
                        }
                            .frame(maxWidth: 190)
                            .frame(maxWidth: .infinity)
                    }
                }

                ForEach(Array(session.packs.enumerated()), id: \.offset) { packIndex, pack in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(session.packs.count == 1 ? "Your Pulls" : "Pack \(packIndex + 1)")
                                .font(.title3.bold())
                            Spacer()
                            Text("\(pack.count) cards")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        LazyVGrid(columns: columns, alignment: .center, spacing: 20) {
                            ForEach(Array(pack.enumerated()), id: \.offset) { cardIndex, pull in
                                PackOpeningNativeResultCard(pull: pull) {
                                    withAnimation(.snappy) {
                                        inspectedPullIndex = session.packs
                                            .prefix(packIndex)
                                            .reduce(0) { $0 + $1.count } + cardIndex
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 118)
            .padding(.bottom, 94)
        }
        .scrollIndicators(.hidden)
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .accessibilityLabel("Pack results for \(session.packLabel)")
    }

    private func tierRank(_ tier: String) -> Int {
        switch tier.lowercased() {
        case "chase": 5
        case "ultra": 4
        case "rare": 3
        case "uncommon": 2
        default: 1
        }
    }
}

private struct PackOpeningResultSummary: View {
    let session: PackOpeningPullSession

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.title2)
                .foregroundStyle(.green)

            VStack(alignment: .leading, spacing: 2) {
                Text(session.packLabel)
                    .font(.headline)
                Text("\(session.packs.count) \(session.packs.count == 1 ? "pack" : "packs") · \(session.pulls.count) cards")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(Color(uiColor: .separator).opacity(0.5), lineWidth: 1)
        }
    }
}

private struct PackOpeningNativeResultCard: View {
    let pull: PackOpeningPull
    let onInspect: () -> Void

    var body: some View {
        Button(action: onInspect) {
            VStack(spacing: 9) {
            CachedAsyncImage(card: pull.card, thumbnail: true) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                case .failure:
                    Image(systemName: "rectangle.portrait.slash")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                default:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .aspectRatio(2.5 / 3.5, contentMode: .fit)
            .clipShape(TradingCardShape())
            .shadow(color: tierColor.opacity(0.16), radius: 10, y: 5)

            VStack(spacing: 2) {
                Text(pull.name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                Text(pull.rarity.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(tierColor)
                    .lineLimit(1)
            }
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(pull.name), \(pull.rarity)")
    }

    private var tierColor: Color {
        switch pull.tier.lowercased() {
        case "chase": .orange
        case "ultra": .purple
        case "rare": .blue
        case "uncommon": .green
        default: .secondary
        }
    }
}

private struct PackOpeningCardCloseUp: View {
    let pull: PackOpeningPull
    let identity: String
    let onClose: () -> Void
    /// Positive advances, negative moves backward or exits when unavailable.
    let onSwipe: (Int) -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var isShowingBack = false
    @State private var settledScale: CGFloat = 1
    @GestureState private var liveScale: CGFloat = 1
    @GestureState private var dragOffset: CGSize = .zero
    @State private var wishlistCard: Card?
    @State private var isSavingFavorite = false
    @State private var favoriteMessage: String?
    @State private var favoriteError: String?

    private let apiService = APIService()

    private var effectiveScale: CGFloat {
        min(max(settledScale * liveScale, 1), 5)
    }

    private var shareText: String {
        var text = "\(pull.name) — \(pull.setName) #\(pull.collectorNumber)"
        if !pull.imageUrl.isEmpty { text += "\n\(pull.imageUrl)" }
        return text
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture(perform: onClose)

                cardFace
                    .frame(maxWidth: min(geometry.size.width * 0.9, 430))
                    .frame(maxHeight: geometry.size.height * 0.76)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 88)

                VStack {
                    HStack {
                        Button(action: onClose) {
                            Image(systemName: "arrow.down.right.and.arrow.up.left")
                                .font(.headline)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.glass)
                        .accessibilityLabel("Return to card reveal")

                        Spacer()

                        Button {
                            withAnimation(.snappy) { isShowingBack.toggle() }
                        } label: {
                            Image(systemName: "rectangle.on.rectangle.angled")
                                .font(.headline)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.glass)
                        .accessibilityLabel("Flip card")
                    }

                    Spacer()
                    actionBar
                }
                .padding(.horizontal, 18)
                .safeAreaPadding(.top, 12)
                .safeAreaPadding(.bottom, 14)
            }
        }
        .background(.black.opacity(0.06))
        .onChange(of: identity) { _, _ in
            isShowingBack = false
            settledScale = 1
        }
        .sheet(item: $wishlistCard) { card in
            AddToWishlistSheet(card: card)
        }
        .alert("Favorites", isPresented: Binding(
            get: { favoriteMessage != nil || favoriteError != nil },
            set: { if !$0 { favoriteMessage = nil; favoriteError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(favoriteMessage ?? favoriteError ?? "")
        }
    }

    private var cardFace: some View {
        Group {
            if isShowingBack,
               let assetName = TCGGame(rawValue: pull.tcg)?.cardBackAssetName {
                Image(assetName)
                    .resizable()
                    .scaledToFit()
            } else {
                CachedAsyncImage(card: pull.card, thumbnail: false) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    case .failure:
                        Image(systemName: "rectangle.portrait.slash")
                            .font(.system(size: 52))
                            .foregroundStyle(.secondary)
                    default: ProgressView()
                    }
                }
            }
        }
        .aspectRatio(2.5 / 3.5, contentMode: .fit)
        .clipShape(TradingCardShape())
        .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
        .scaleEffect(effectiveScale)
        .offset(x: dragOffset.width, y: dragOffset.height * 0.18)
        .rotationEffect(.degrees(Double(dragOffset.width / 28)))
        .opacity(max(0.35, 1 - abs(dragOffset.width) / 360))
        .rotation3DEffect(.degrees(isShowingBack ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .contentShape(Rectangle())
        .gesture(
            MagnifyGesture()
                .updating($liveScale) { value, state, _ in state = value.magnification }
                .onEnded { value in
                    settledScale = min(max(settledScale * value.magnification, 1), 5)
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .updating($dragOffset) { value, state, _ in
                    guard effectiveScale <= 1.02 else { return }
                    state = value.translation
                }
                .onEnded { value in
                    guard effectiveScale <= 1.02 else { return }
                    let horizontal = abs(value.translation.width)
                    let vertical = abs(value.translation.height)
                    if horizontal > 72, horizontal > vertical {
                        onSwipe(value.translation.width < 0 ? 1 : -1)
                    } else if vertical > 90, vertical > horizontal {
                        onClose()
                    }
                }
        )
        .onTapGesture(count: 2) {
            withAnimation(.snappy) { isShowingBack.toggle() }
        }
        .accessibilityLabel(isShowingBack ? "Back of \(pull.name)" : "Front of \(pull.name)")
    }

    private var actionBar: some View {
        HStack(spacing: 10) {
            Button {
                Task { await addToFavorites() }
            } label: {
                Label("Favorite", systemImage: "star.fill")
            }
            .buttonStyle(.glass)
            .disabled(isSavingFavorite)

            Button {
                wishlistCard = pull.card
            } label: {
                Label("Wishlist", systemImage: "heart")
            }
            .buttonStyle(.glass)

            ShareLink(item: shareText) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.glass)

            Button {
                onClose()
            } label: {
                Label("Done", systemImage: "arrow.down.right.and.arrow.up.left")
            }
            .buttonStyle(.glassProminent)
        }
        .labelStyle(.iconOnly)
    }

    @MainActor
    private func addToFavorites() async {
        guard !isSavingFavorite else { return }
        guard let token = environmentStore.authToken else {
            favoriteError = "Sign in before adding favorites."
            return
        }
        isSavingFavorite = true
        defer { isSavingFavorite = false }

        do {
            let collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: false
            )
            let existingFavorite = collections.first {
                $0.name.compare("Favorites", options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
            }
            let resolvedFavorite: Collection
            if let existingFavorite {
                resolvedFavorite = existingFavorite
            } else {
                resolvedFavorite = try await apiService.createCollection(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    name: "Favorites",
                    description: "Favorite cards",
                    colorHex: "#F59E0B"
                )
            }
            _ = try await apiService.addCardToBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: resolvedFavorite.id,
                card: pull.card,
                details: BinderCardAddDetails(quantity: 1, notes: "Favorited from Pack Opening")
            )
            NotificationCenter.default.post(name: .collectionDidChange, object: resolvedFavorite)
            HapticManager.notification(.success)
            favoriteMessage = "Added \(pull.name) to Favorites."
        } catch {
            favoriteError = error.localizedDescription
        }
    }
}

private extension PackOpeningView {
    enum SheetDestination: Identifiable {
        case review(PackOpeningPullSession)
        case oddsReference(PackOpeningInterfaceState.PackOption.OddsReference)

        var id: String {
            switch self {
            case .review(let session):
                "review-\(session.id)"
            case .oddsReference(let reference):
                "odds-\(reference.url)"
            }
        }
    }
}

private struct PackOddsSourceSheet: View {
    @Environment(\.dismiss) private var dismiss

    let reference: PackOpeningInterfaceState.PackOption.OddsReference

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Label("Pack odds source", systemImage: "chart.bar.doc.horizontal")
                    .font(.headline)

                Spacer()

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark")
                        .frame(width: 20, height: 20)
                }
                .buttonStyle(.glass)
                .accessibilityLabel("Close")
            }

            Text(reference.title)
                .font(.title3.weight(.semibold))

            Text("Based on a \(reference.sampleSize.formatted())-pack sample. \(reference.note)")
                .foregroundStyle(.secondary)

            if let destination = reference.destination {
                Link(destination: destination) {
                    Label("Open Source", systemImage: "arrow.up.right.square")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .accessibilityLabel("Open pull-rate source: \(reference.title)")
            }
        }
        .padding(20)
        .presentationDetents([.height(280)])
        .presentationDragIndicator(.visible)
    }
}

struct PackOpeningInterfaceState: Codable, Equatable {
    enum Phase: String, Codable {
        case loading, select, tear, opening, reveal, summary, final
    }

    enum OpeningMode: String, Codable {
        case normal, quick
    }

    struct PackOption: Codable, Equatable, Identifiable {
        struct OddsReference: Codable, Equatable {
            let title: String
            let url: String
            let sampleSize: Int
            let note: String

            var destination: URL? { URL(string: url) }
        }

        let id: String
        let label: String
        let setID: String?
        let setLabel: String?
        let variationLabel: String?
        let oddsReference: OddsReference?

        var resolvedSetID: String { setID ?? id }
        var resolvedSetLabel: String { setLabel ?? label }
        var resolvedVariationLabel: String { variationLabel ?? label }
    }

    struct PackSet: Equatable, Identifiable {
        let id: String
        let label: String
        let options: [PackOption]
    }

    let phase: Phase
    let selectedPackID: String
    let selectedPackLabel: String
    let packCount: Int
    let openingMode: OpeningMode
    let packBackwards: Bool
    let packOptions: [PackOption]
    let revealedCount: Int
    let totalCards: Int
    let currentPackNumber: Int
    let totalPacks: Int
    let canSave: Bool
    let warning: String?
    let session: PackOpeningPullSession?

    static let loading = Self(
        phase: .loading,
        selectedPackID: "",
        selectedPackLabel: "Loading",
        packCount: 1,
        openingMode: .normal,
        packBackwards: false,
        packOptions: [],
        revealedCount: 0,
        totalCards: 0,
        currentPackNumber: 0,
        totalPacks: 0,
        canSave: false,
        warning: nil,
        session: nil
    )

    var showsNativeResults: Bool {
        (phase == .summary || phase == .final) && session != nil
    }

    var packSets: [PackSet] {
        var order: [String] = []
        var labels: [String: String] = [:]
        var grouped: [String: [PackOption]] = [:]

        for option in packOptions {
            let setID = option.resolvedSetID
            if grouped[setID] == nil { order.append(setID) }
            labels[setID] = option.resolvedSetLabel
            grouped[setID, default: []].append(option)
        }

        return order.map { id in
            PackSet(id: id, label: labels[id] ?? id, options: grouped[id] ?? [])
        }
    }

    var selectedPackOption: PackOption? {
        packOptions.first { $0.id == selectedPackID }
    }

    var selectedSetLabel: String {
        selectedPackOption?.resolvedSetLabel ?? selectedPackLabel
    }

    var selectedSetID: String {
        selectedPackOption?.resolvedSetID ?? selectedPackID
    }

    var selectedSetOptions: [PackOption] {
        guard let selectedPackOption else { return [] }
        return packOptions.filter { $0.resolvedSetID == selectedPackOption.resolvedSetID }
    }

    var selectedOddsReference: PackOption.OddsReference? {
        selectedPackOption?.oddsReference
    }

    var selectedVariationLabel: String {
        selectedPackOption?.resolvedVariationLabel ?? selectedPackLabel
    }

    var subtitle: String {
        switch phase {
        case .loading: "Loading"
        case .select: selectedPackLabel
        case .tear: "Tear the seal"
        case .opening: "Opening pack"
        case .reveal: "Reveal \(revealedCount) of \(totalCards)"
        case .summary: "Pack results"
        case .final: "\(totalPacks) pack results"
        }
    }
}

struct PackOpeningCommand: Equatable {
    enum Action: String {
        case selectPack, setPackCount, setOpeningMode, togglePackOrientation, openPack, backToPacks, advance, showAll, savePulls, uploadArtwork
    }

    let id = UUID()
    let action: Action
    var optionID: String?
    var count: Int?
    var mode: String?
    var dataURL: String?
    var label: String?

    var payload: [String: Any] {
        var value: [String: Any] = ["type": action.rawValue]
        if let optionID { value["id"] = optionID }
        if let count { value["count"] = count }
        if let mode { value["mode"] = mode }
        if let dataURL { value["dataURL"] = dataURL }
        if let label { value["label"] = label }
        return value
    }

    static func selectPack(_ id: String) -> Self { .init(action: .selectPack, optionID: id) }
    static func setPackCount(_ count: Int) -> Self { .init(action: .setPackCount, count: count) }
    static func setOpeningMode(_ mode: PackOpeningInterfaceState.OpeningMode) -> Self {
        .init(action: .setOpeningMode, mode: mode.rawValue)
    }
    static var togglePackOrientation: Self { .init(action: .togglePackOrientation) }
    static var openPack: Self { .init(action: .openPack) }
    static var backToPacks: Self { .init(action: .backToPacks) }
    static var advance: Self { .init(action: .advance) }
    static var showAll: Self { .init(action: .showAll) }
    static var savePulls: Self { .init(action: .savePulls) }
    static func uploadArtwork(dataURL: String, label: String) -> Self {
        .init(action: .uploadArtwork, dataURL: dataURL, label: label)
    }
}

enum PackOpeningBridgeEvent: Equatable {
    case ready
    case phaseChanged(String)
    case interfaceState(PackOpeningInterfaceState)
    case haptic(String)
    case saveRequested(PackOpeningPullSession)
    case inspectRequested(PackOpeningPull)
    case error(String)
}

@MainActor
final class PackOpeningWebSession: ObservableObject {
    let coordinator: PackOpeningWebCoordinator
    let webView: WKWebView

    var latestInterfaceState: PackOpeningInterfaceState? {
        coordinator.latestState
    }

    var isReady: Bool {
        coordinator.isReady
    }

    init() {
        let coordinator = PackOpeningWebCoordinator()
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.isTextInteractionEnabled = false
        if #available(iOS 17.0, *) {
            configuration.preferences.inactiveSchedulingPolicy = .none
        }
        configuration.userContentController.add(coordinator, name: PackOpeningWebCoordinator.bridgeName)
        configuration.userContentController.addScriptMessageHandler(
            coordinator.resourceBridge,
            contentWorld: .page,
            name: PackOpeningFetchBridge.bridgeName
        )
        configuration.userContentController.addUserScript(
            WKUserScript(
                source: PackOpeningFetchBridge.fetchShim,
                injectionTime: .atDocumentStart,
                forMainFrameOnly: true
            )
        )
        configuration.setURLSchemeHandler(coordinator.resourceHandler, forURLScheme: PackOpeningResource.scheme)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.underPageBackgroundColor = .systemBackground
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        self.coordinator = coordinator
        self.webView = webView

        guard PackOpeningResource.rootURL() != nil else {
            coordinator.emit(.error("PackOpening.bundle is missing. Run `bash scripts/ios-assets.sh build`."))
            return
        }
        webView.load(URLRequest(url: PackOpeningResource.entryURL))
    }

    func setEventHandler(
        _ onEvent: @escaping (PackOpeningBridgeEvent) -> Void,
        replay: Bool
    ) {
        coordinator.setEventHandler(onEvent, replay: replay)
    }

    func send(_ command: PackOpeningCommand) {
        guard coordinator.lastCommandID != command.id else { return }
        coordinator.lastCommandID = command.id
        Task { @MainActor in
            do {
                _ = try await webView.callAsyncJavaScript(
                    "window.tcgerPack?.command(command)",
                    arguments: ["command": command.payload],
                    in: nil,
                    contentWorld: .page
                )
            } catch {
                coordinator.emit(.error(error.localizedDescription))
            }
        }
    }

    func reload() {
        coordinator.resetReplayState()
        webView.stopLoading()
        webView.load(URLRequest(url: PackOpeningResource.entryURL))
    }

    func setPrefersBundledResources(_ prefersBundledResources: Bool) {
        coordinator.setPrefersBundledResources(prefersBundledResources)
    }
}

struct PackOpeningWebView: UIViewRepresentable {
    let session: PackOpeningWebSession
    let command: PackOpeningCommand?
    let onEvent: (PackOpeningBridgeEvent) -> Void

    func makeCoordinator() -> AttachmentCoordinator {
        AttachmentCoordinator()
    }

    func makeUIView(context: Context) -> PackOpeningWebContainerView {
        session.setEventHandler(onEvent, replay: true)
        context.coordinator.didReplay = true
        let container = PackOpeningWebContainerView()
        container.attach(session.webView)
        return container
    }

    func updateUIView(_ container: PackOpeningWebContainerView, context: Context) {
        session.setEventHandler(onEvent, replay: !context.coordinator.didReplay)
        context.coordinator.didReplay = true
        container.attach(session.webView)
        if let command { session.send(command) }
    }

    static func dismantleUIView(
        _ container: PackOpeningWebContainerView,
        coordinator: AttachmentCoordinator
    ) {
        container.detachWebView()
    }

    final class AttachmentCoordinator {
        var didReplay = false
    }
}

final class PackOpeningWebContainerView: UIView {
    private weak var attachedWebView: WKWebView?

    func attach(_ webView: WKWebView) {
        guard webView.superview !== self else { return }

        webView.removeFromSuperview()
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),
        ])
        attachedWebView = webView
    }

    func detachWebView() {
        guard let attachedWebView, attachedWebView.superview === self else { return }
        attachedWebView.removeFromSuperview()
    }
}

@MainActor
final class PackOpeningWebCoordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let bridgeName = "packBridge"
    let resourceHandler = PackOpeningSchemeHandler()
    let resourceBridge = PackOpeningFetchBridge()
    var lastCommandID: UUID?

    private var onEvent: (PackOpeningBridgeEvent) -> Void = { _ in }
    private(set) var isReady = false
    private(set) var latestState: PackOpeningInterfaceState?
    private var latestError: String?

    func setEventHandler(
        _ handler: @escaping (PackOpeningBridgeEvent) -> Void,
        replay: Bool
    ) {
        onEvent = handler
        guard replay else { return }
        if isReady { handler(.ready) }
        if let latestState { handler(.interfaceState(latestState)) }
        if let latestError { handler(.error(latestError)) }
    }

    func emit(_ event: PackOpeningBridgeEvent) {
        switch event {
        case .ready:
            isReady = true
            latestError = nil
        case .interfaceState(let state):
            latestState = state
        case .error(let message):
            latestError = message
        default:
            break
        }
        onEvent(event)
    }

    func resetReplayState() {
        isReady = false
        latestState = nil
        latestError = nil
        lastCommandID = nil
    }

    func setPrefersBundledResources(_ prefersBundledResources: Bool) {
        resourceBridge.setPrefersBundledResources(prefersBundledResources)
        resourceHandler.setPrefersBundledResources(prefersBundledResources)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == Self.bridgeName,
            let payload = message.body as? [String: Any],
            let type = payload["type"] as? String
        else { return }

        switch type {
        case "ready":
            emit(.ready)
        case "phaseChanged":
            if let phase = payload["phase"] as? String { emit(.phaseChanged(phase)) }
        case "nativeState":
            if let state = PackOpeningBridgeDecoder.interfaceState(from: payload) {
                emit(.interfaceState(state))
            }
        case "haptic":
            if let style = payload["style"] as? String { emit(.haptic(style)) }
        case "saveRequested":
            if let session = PackOpeningBridgeDecoder.pullSession(from: payload) {
                emit(.saveRequested(session))
            } else {
                emit(.error("The completed pack results could not be read."))
            }
        case "inspectRequested":
            if let pull = PackOpeningBridgeDecoder.pull(from: payload) {
                emit(.inspectRequested(pull))
            }
        case "error":
            emit(.error(payload["message"] as? String ?? "The pack renderer reported an error."))
        default:
            break
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
        emit(.error(error.localizedDescription))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
        emit(.error(error.localizedDescription))
    }
}

/// WebKit can render custom-scheme images and scripts through
/// `WKURLSchemeHandler`, but `window.fetch` rejects those same URLs before the
/// scheme handler receives them. The pack renderer fetches its JSON manifest
/// and OBJ mesh, so bridge only those custom-scheme fetches to native code and
/// return a normal JavaScript `Response`. HTTP(S) requests keep using the
/// browser's native fetch implementation.
final class PackOpeningFetchBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let bridgeName = "packResource"

    static let fetchShim = #"""
    (() => {
      const bridge = window.webkit?.messageHandlers?.packResource;
      if (!bridge) return;

      const browserFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const value = typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
        const url = new URL(value, window.location.href);
        if (url.protocol !== "tcger-pack:") {
          return browserFetch(input, init);
        }

        const resource = await bridge.postMessage(url.href);
        const binary = atob(resource.base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return new Response(bytes, {
          status: 200,
          headers: { "Content-Type": resource.mimeType || "application/octet-stream" },
        });
      };
    })();
    """#

    private struct Resource {
        let data: Data
        let mimeType: String
    }

    private let remoteBaseURL: URL
    private let session: URLSession
    private let assetCache: PackOpeningAssetCache
    private let resourceModeLock = NSLock()
    private var _prefersBundledResources = false

    private var prefersBundledResources: Bool {
        resourceModeLock.withLock { _prefersBundledResources }
    }

    init(
        remoteBaseURL: URL = PackOpeningResource.remoteBaseURL(),
        session: URLSession = .shared,
        assetCache: PackOpeningAssetCache = .shared
    ) {
        self.remoteBaseURL = remoteBaseURL
        self.session = session
        self.assetCache = assetCache
    }

    func setPrefersBundledResources(_ prefersBundledResources: Bool) {
        resourceModeLock.withLock {
            _prefersBundledResources = prefersBundledResources
        }
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        guard
            message.name == Self.bridgeName,
            let value = message.body as? String,
            let requestURL = URL(string: value),
            requestURL.scheme == PackOpeningResource.scheme
        else {
            replyHandler(nil, "Invalid pack resource request.")
            return
        }

        load(requestURL) { result in
            DispatchQueue.main.async {
                switch result {
                case .success(let resource):
                    replyHandler([
                        "base64": resource.data.base64EncodedString(),
                        "mimeType": resource.mimeType,
                    ], nil)
                case .failure(let error):
                    replyHandler(nil, error.localizedDescription)
                }
            }
        }
    }

    private func load(
        _ requestURL: URL,
        completion: @escaping (Result<Resource, Error>) -> Void
    ) {
        guard let remoteURL = PackOpeningResource.remoteURL(for: requestURL, baseURL: remoteBaseURL) else {
            loadBundled(requestURL, completion: completion)
            return
        }

        let prefersBundledResources = prefersBundledResources
        let isManifest = PackOpeningResource.isManifest(remoteURL)
        if let cached = assetCache.data(for: remoteURL),
           prefersBundledResources || !isManifest || !NetworkMonitor.shared.isConnected {
            completion(.success(Resource(
                data: cached,
                mimeType: PackOpeningResource.mimeType(for: remoteURL.pathExtension)
            )))
            return
        }

        if prefersBundledResources {
            loadBundled(requestURL, completion: completion)
            return
        }

        guard NetworkMonitor.shared.isConnected else {
            loadBundled(requestURL, completion: completion)
            return
        }

        var request = URLRequest(url: remoteURL)
        request.cachePolicy = PackOpeningResource.cachePolicy(for: remoteURL)
        request.timeoutInterval = 20
        session.dataTask(with: request) { [weak self] data, response, error in
            if
                error == nil,
                let data,
                let response,
                (response as? HTTPURLResponse).map({ 200 ..< 300 ~= $0.statusCode }) ?? true
            {
                self?.assetCache.store(data, for: remoteURL)
                completion(.success(Resource(
                    data: data,
                    mimeType: response.mimeType
                        ?? PackOpeningResource.mimeType(for: remoteURL.pathExtension)
                )))
                return
            }
            if let cached = self?.assetCache.data(for: remoteURL) {
                completion(.success(Resource(
                    data: cached,
                    mimeType: PackOpeningResource.mimeType(for: remoteURL.pathExtension)
                )))
            } else {
                self?.loadBundled(requestURL, completion: completion)
            }
        }.resume()
    }

    private func loadBundled(
        _ requestURL: URL,
        completion: (Result<Resource, Error>) -> Void
    ) {
        guard
            let root = PackOpeningResource.rootURL(),
            let file = PackOpeningResource.fileURL(for: requestURL, root: root)
        else {
            completion(.failure(URLError(.fileDoesNotExist)))
            return
        }

        do {
            completion(.success(Resource(
                data: try Data(contentsOf: file, options: .mappedIfSafe),
                mimeType: PackOpeningResource.mimeType(for: file.pathExtension)
            )))
        } catch {
            completion(.failure(error))
        }
    }
}

enum PackOpeningBridgeDecoder {
    private struct SaveMessage: Decodable {
        let session: PackOpeningPullSession
    }

    private struct StateMessage: Decodable {
        let state: PackOpeningInterfaceState
    }

    private struct InspectMessage: Decodable {
        let pull: PackOpeningPull
    }

    static func pullSession(from body: Any) -> PackOpeningPullSession? {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              let message = try? JSONDecoder().decode(SaveMessage.self, from: data)
        else { return nil }
        return message.session
    }

    static func interfaceState(from body: Any) -> PackOpeningInterfaceState? {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              let message = try? JSONDecoder().decode(StateMessage.self, from: data)
        else { return nil }
        return message.state
    }

    static func pull(from body: Any) -> PackOpeningPull? {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              let message = try? JSONDecoder().decode(InspectMessage.self, from: data)
        else { return nil }
        return message.pull
    }
}

enum PackOpeningResource {
    static let scheme = "tcger-pack"
    static let bundleHost = "bundle"
    static let assetHost = "assets"
    static let remoteTexturePath = "/remote-image"
    // Keep the document and its textures on one custom-scheme origin. WebKit
    // otherwise treats `bundle` and `assets` as different origins and rejects
    // Three.js textures even though both hosts use this same scheme handler.
    static let entryURL = URL(string: "\(scheme)://\(assetHost)/index.html")!
    static let defaultRemoteBaseURL = URL(string: "https://assets.tcger.ahmadjalil.com")!

    static func remoteBaseURL(in bundle: Bundle = .main) -> URL {
        guard
            let value = bundle.object(forInfoDictionaryKey: "TCGerPackAssetBaseURL") as? String,
            !value.isEmpty,
            !value.contains("$("),
            let url = URL(string: value),
            url.scheme == "https"
        else { return defaultRemoteBaseURL }
        return url
    }

    static func rootURL(in bundle: Bundle = .main) -> URL? {
        guard let resources = bundle.resourceURL else { return nil }
        let root = resources.appendingPathComponent("PackOpening.bundle", isDirectory: true)
        return FileManager.default.fileExists(atPath: root.appendingPathComponent("index.html").path)
            ? root
            : nil
    }

    static func fileURL(for requestURL: URL, root: URL) -> URL? {
        guard
            requestURL.scheme == scheme,
            requestURL.host == bundleHost || requestURL.host == assetHost
        else { return nil }
        let relativePath = requestURL.path.removingPercentEncoding?
            .trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        guard !relativePath.isEmpty else { return nil }

        let normalizedRoot = root.standardizedFileURL
        let file = normalizedRoot.appendingPathComponent(relativePath).standardizedFileURL
        let allowedPrefix = normalizedRoot.path.hasSuffix("/") ? normalizedRoot.path : normalizedRoot.path + "/"
        guard file.path.hasPrefix(allowedPrefix), FileManager.default.fileExists(atPath: file.path) else {
            return nil
        }
        return file
    }

    static func remoteURL(for requestURL: URL, baseURL: URL) -> URL? {
        if
            requestURL.scheme == scheme,
            requestURL.host == assetHost,
            requestURL.path == remoteTexturePath
        {
            guard
                let components = URLComponents(url: requestURL, resolvingAgainstBaseURL: false),
                let value = components.queryItems?.first(where: { $0.name == "url" })?.value,
                let url = URL(string: value),
                url.scheme == "https",
                url.host?.lowercased() == "assets.tcgdex.net"
            else { return nil }
            return url
        }

        guard
            requestURL.scheme == scheme,
            requestURL.host == assetHost,
            baseURL.scheme == "https"
        else { return nil }
        let relativePath = requestURL.path.removingPercentEncoding?
            .trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        guard
            relativePath == "pack" || relativePath.hasPrefix("pack/"),
            !relativePath.split(separator: "/").contains("..")
        else { return nil }

        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        let basePath = components?.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        components?.path = "/" + [basePath, relativePath].filter { !$0.isEmpty }.joined(separator: "/")
        components?.query = requestURL.query
        return components?.url
    }

    static func mimeType(for extensionName: String) -> String {
        switch extensionName.lowercased() {
        case "html": "text/html"
        case "js", "mjs": "text/javascript"
        case "css": "text/css"
        case "json": "application/json"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "webp": "image/webp"
        case "svg": "image/svg+xml"
        case "obj": "text/plain"
        case "wasm": "application/wasm"
        default: "application/octet-stream"
        }
    }

    static func isManifest(_ remoteURL: URL) -> Bool {
        remoteURL.path.hasSuffix("/manifest.json")
    }

    /// Pack metadata changes independently of the content-addressed objects it
    /// references. Reaching past WebKit's HTTP cache while online prevents an
    /// older Base-only manifest from hiding newly published sets such as Pitch
    /// Black. The durable byte cache remains the offline fallback.
    static func cachePolicy(for remoteURL: URL) -> URLRequest.CachePolicy {
        isManifest(remoteURL) ? .reloadIgnoringLocalCacheData : .returnCacheDataElseLoad
    }
}

@MainActor
final class PackOpeningSchemeHandler: NSObject, WKURLSchemeHandler {
    private struct RemoteTask {
        let dataTask: URLSessionDataTask
        let schemeTask: any WKURLSchemeTask
    }

    private let remoteBaseURL: URL
    private let session: URLSession
    private let assetCache: PackOpeningAssetCache
    private var remoteTasks: [ObjectIdentifier: RemoteTask] = [:]
    private var prefersBundledResources = false

    init(
        remoteBaseURL: URL? = nil,
        session: URLSession = .shared,
        assetCache: PackOpeningAssetCache? = nil
    ) {
        self.remoteBaseURL = remoteBaseURL ?? PackOpeningResource.remoteBaseURL()
        self.session = session
        self.assetCache = assetCache ?? .shared
    }

    func setPrefersBundledResources(_ prefersBundledResources: Bool) {
        self.prefersBundledResources = prefersBundledResources
    }

    func webView(_ webView: WKWebView, start urlSchemeTask: any WKURLSchemeTask) {
        guard
            let requestURL = urlSchemeTask.request.url
        else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        if let remoteURL = PackOpeningResource.remoteURL(for: requestURL, baseURL: remoteBaseURL) {
            loadRemote(remoteURL, requestURL: requestURL, schemeTask: urlSchemeTask)
            return
        }

        loadBundled(requestURL, schemeTask: urlSchemeTask)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: any WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask as AnyObject)
        let task = remoteTasks.removeValue(forKey: key)
        task?.dataTask.cancel()
    }

    private func loadRemote(
        _ remoteURL: URL,
        requestURL: URL,
        schemeTask: any WKURLSchemeTask
    ) {
        let isManifest = PackOpeningResource.isManifest(remoteURL)
        if let cached = assetCache.data(for: remoteURL),
           prefersBundledResources || !isManifest || !NetworkMonitor.shared.isConnected {
            deliver(
                cached,
                remoteURL: remoteURL,
                requestURL: requestURL,
                schemeTask: schemeTask
            )
            return
        }

        if prefersBundledResources {
            loadBundled(requestURL, schemeTask: schemeTask)
            return
        }

        guard NetworkMonitor.shared.isConnected else {
            loadBundled(requestURL, schemeTask: schemeTask)
            return
        }

        let key = ObjectIdentifier(schemeTask as AnyObject)
        var request = URLRequest(url: remoteURL)
        request.cachePolicy = PackOpeningResource.cachePolicy(for: remoteURL)
        request.timeoutInterval = 20

        let task = session.dataTask(with: request) { [weak self] data, response, error in
            Task { @MainActor [weak self] in
                guard let self, let remoteTask = self.remoteTasks.removeValue(forKey: key) else { return }
                if
                    error == nil,
                    let data,
                    let response,
                    (response as? HTTPURLResponse).map({ 200 ..< 300 ~= $0.statusCode }) ?? true
                {
                    self.assetCache.store(data, for: remoteURL)
                    self.deliver(
                        data,
                        remoteURL: remoteURL,
                        requestURL: requestURL,
                        schemeTask: remoteTask.schemeTask,
                        textEncodingName: response.textEncodingName
                    )
                } else {
                    if let cached = self.assetCache.data(for: remoteURL) {
                        self.deliver(
                            cached,
                            remoteURL: remoteURL,
                            requestURL: requestURL,
                            schemeTask: remoteTask.schemeTask
                        )
                    } else {
                        self.loadBundled(requestURL, schemeTask: remoteTask.schemeTask)
                    }
                }
            }
        }
        remoteTasks[key] = RemoteTask(dataTask: task, schemeTask: schemeTask)
        task.resume()
    }

    private func deliver(
        _ data: Data,
        remoteURL: URL,
        requestURL: URL,
        schemeTask: any WKURLSchemeTask,
        textEncodingName: String? = nil
    ) {
        let response = URLResponse(
            url: requestURL,
            mimeType: PackOpeningResource.mimeType(for: remoteURL.pathExtension),
            expectedContentLength: data.count,
            textEncodingName: textEncodingName
        )
        schemeTask.didReceive(response)
        schemeTask.didReceive(data)
        schemeTask.didFinish()
    }

    private func loadBundled(_ requestURL: URL, schemeTask: any WKURLSchemeTask) {
        guard
            let root = PackOpeningResource.rootURL(),
            let file = PackOpeningResource.fileURL(for: requestURL, root: root)
        else {
            schemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        do {
            let data = try Data(contentsOf: file, options: .mappedIfSafe)
            let response = URLResponse(
                url: requestURL,
                mimeType: PackOpeningResource.mimeType(for: file.pathExtension),
                expectedContentLength: data.count,
                textEncodingName: ["html", "js", "mjs", "css", "json", "obj"].contains(file.pathExtension)
                    ? "utf-8"
                    : nil
            )
            schemeTask.didReceive(response)
            schemeTask.didReceive(data)
            schemeTask.didFinish()
        } catch {
            schemeTask.didFailWithError(error)
        }
    }
}

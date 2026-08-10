import PhotosUI
import SwiftUI
import UIKit

private struct ScannerGuideFramePreferenceKey: PreferenceKey {
    static var defaultValue: CGRect = .zero

    static func reduce(value: inout CGRect, nextValue: () -> CGRect) {
        let next = nextValue()
        if next.width > 0, next.height > 0 {
            value = next
        }
    }
}

private enum ScannerGuideLayout {
    static let cornerRadius: CGFloat = 18
}

private enum ScannerPhotoPickerMode {
    case single
    case bulk
}

private struct ScannerPhotoImportProgress {
    let captureMode: ScannerCaptureMode
    let current: Int
    let total: Int
}

@MainActor
private enum ScannerDemoFixture {
    private static let binderCardNames = [
        "BossOrders",
        "Peonia",
        "PokeStop",
        "ProfessorsResearch",
        "Rayquaza",
        "PokemonCardBack",
        "PokeStop",
        "BossOrders",
        "Peonia"
    ]

    static func image(for captureMode: ScannerCaptureMode) -> CGImage? {
        switch captureMode {
        case .card:
            return UIImage(named: "BossOrders")?.cgImage
        case .binder:
            return binderPageImage()
        }
    }

    private static func binderPageImage() -> CGImage? {
        let cards = binderCardNames.compactMap(UIImage.init(named:))
        guard cards.count == binderCardNames.count else { return nil }

        let pageSize = CGSize(width: 1_400, height: 1_980)
        let pageInset: CGFloat = 48
        let gutter: CGFloat = 20
        let cardWidth = (pageSize.width - pageInset * 2 - gutter * 2) / 3
        let cardHeight = cardWidth * 1.395
        let rendererFormat = UIGraphicsImageRendererFormat()
        rendererFormat.scale = 1
        rendererFormat.opaque = true

        return UIGraphicsImageRenderer(size: pageSize, format: rendererFormat).image { context in
            let bounds = CGRect(origin: .zero, size: pageSize)
            UIColor(red: 0.035, green: 0.055, blue: 0.08, alpha: 1).setFill()
            context.fill(bounds)

            for (index, card) in cards.enumerated() {
                let column = index % 3
                let row = index / 3
                let cardRect = CGRect(
                    x: pageInset + CGFloat(column) * (cardWidth + gutter),
                    y: pageInset + CGFloat(row) * (cardHeight + gutter),
                    width: cardWidth,
                    height: cardHeight
                )
                let pocketRect = cardRect.insetBy(dx: -6, dy: -6)

                UIColor.white.withAlphaComponent(0.16).setFill()
                UIBezierPath(roundedRect: pocketRect, cornerRadius: 14).fill()
                card.draw(in: cardRect)

                UIColor.white.withAlphaComponent(0.32).setStroke()
                let pocketOutline = UIBezierPath(roundedRect: pocketRect, cornerRadius: 14)
                pocketOutline.lineWidth = 3
                pocketOutline.stroke()
            }
        }.cgImage
    }
}

struct CardScannerView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.isPresented) private var isPresented
    @AppStorage("cardScannerShowTestingTools") private var showTestingTools = false
    @AppStorage(ScannerDevModeStore.enabledDefaultsKey) private var devModeRecordingEnabled = false
    @AppStorage("cardScannerAutomaticallyShowResults") private var automaticallyShowResults = false
    @StateObject private var viewModel = CardScannerViewModel()
    @State private var showingRecentDebugCaptures = false
    @State private var photoPickerMode: ScannerPhotoPickerMode?
    @State private var selectedPhotoItems: [PhotosPickerItem] = []
    @State private var photoImportProgress: ScannerPhotoImportProgress?
    @State private var bottomControlsHeight: CGFloat = 120
    @State private var showingSessionReview = false
    @State private var didApplyBinderStart = false
    let scope: CardScanScope?
    let startingBinderID: String?
    let startingBinderPageNumber: Int?

    init(
        scope: CardScanScope? = nil,
        startingBinderID: String? = nil,
        startingBinderPageNumber: Int? = nil
    ) {
        self.scope = scope
        self.startingBinderID = startingBinderID
        self.startingBinderPageNumber = startingBinderPageNumber
    }

    var body: some View {
        ZStack {
            CardScannerCameraPreview(controller: viewModel.cameraController)
                .ignoresSafeArea()

            framingOverlay
        }
        .overlay(alignment: .top) {
            topStatusOverlay
                .padding(.horizontal, 16)
                .padding(.top, 8)
        }
        .overlay(alignment: .bottom) {
            bottomControls
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .onGeometryChange(for: CGFloat.self) { proxy in
                    proxy.size.height
                } action: { height in
                    bottomControlsHeight = height
                }
        }
        .toolbar(.hidden, for: .navigationBar)
        .onAppear {
            viewModel.setAutomaticallyPresentsResults(automaticallyShowResults)
            viewModel.updateEnvironment(environmentStore)
            viewModel.updateScope(scope)
            if scope == nil {
                syncSelectedModeWithModules()
                consumePendingScanMode()
            }
            applyBinderStartIfNeeded()
        }
        .onReceive(environmentStore.$pendingDeepLinkTab) { tab in
            guard tab == .scan, scope == nil else { return }
            consumePendingScanMode()
        }
        .onChange(of: environmentStore.authToken, initial: false) { _, _ in
            viewModel.updateEnvironment(environmentStore)
        }
        .onChange(of: automaticallyShowResults, initial: false) { _, enabled in
            viewModel.setAutomaticallyPresentsResults(enabled)
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
        .onChange(of: selectedPhotoItems, initial: false) { _, items in
            guard !items.isEmpty else { return }
            Task { await scanSelectedPhotos(items) }
        }
        .photosPicker(
            isPresented: photoPickerIsPresented,
            selection: $selectedPhotoItems,
            maxSelectionCount: photoPickerSelectionLimit,
            matching: .images
        )
        .onPreferenceChange(ScannerGuideFramePreferenceKey.self) { frame in
            viewModel.updateGuideFrame(frame)
        }
        .sheet(item: $viewModel.latestResult, onDismiss: {
            viewModel.clearResult()
        }) { result in
            ScanResultSheet(
                result: result,
                color: accentColor(for: viewModel.selectedMode),
                onSelectCandidate: { candidate in
                    viewModel.selectCandidate(candidate, for: result.id)
                },
                onAddCard: { card, binderId, details in
                    try await APIService().addCardToBinder(
                        config: environmentStore.serverConfiguration,
                        token: environmentStore.authToken,
                        binderId: binderId,
                        card: card,
                        details: details
                    )
                }
            )
            .presentationDetents([.medium, .large])
        }
        .fullScreenCover(isPresented: $showingSessionReview) {
            ScannerSessionReviewView(
                viewModel: viewModel,
                color: accentColor(for: viewModel.selectedMode)
            )
            .environmentObject(environmentStore)
        }
        .fullScreenCover(item: $viewModel.binderReviewPresentation, onDismiss: {
            viewModel.finishBinderPageReview()
        }) { presentation in
            BinderPageReviewView(
                viewModel: viewModel,
                initialPageIndex: presentation.initialPageIndex
            )
            .environmentObject(environmentStore)
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

    private func applyBinderStartIfNeeded() {
        guard !didApplyBinderStart,
              let startingBinderID,
              let startingBinderPageNumber else { return }
        didApplyBinderStart = true
        viewModel.captureMode = .binder
        viewModel.selectedBinderID = startingBinderID
        viewModel.setNextBinderPageNumber(startingBinderPageNumber)
    }

    @ViewBuilder
    private var topStatusOverlay: some View {
        VStack(spacing: 10) {
            ScannerCameraToolbar(
                cameraController: viewModel.cameraController,
                scopeTitle: scope.map { "Scanning \($0.setName)" },
                onDismiss: (scope != nil || isPresented) ? { dismiss() } : nil,
                dismissIcon: scope == nil ? "chevron.left" : "xmark",
                triggerMode: $viewModel.triggerMode,
                automaticallyShowResults: $automaticallyShowResults,
                showsTestInputs: showTestingTools || isSimulator,
                isProcessing: isProcessingPhoto,
                onLoadPhoto: { presentPhotoPicker(.single) },
                onLoadPhotos: { presentPhotoPicker(.bulk) },
                demoTitle: viewModel.captureMode == .binder ? "Demo Binder Page" : "Demo Card",
                onRunDemo: scanDemoImage
            ) {
                gameControl
            }

            if devModeRecordingEnabled {
                devModeRecordingBadge
            }

            if let photoImportProgress {
                photoImportStatus(photoImportProgress)
            } else {
                statusContent
            }
        }
    }

    /// Always visible while dev-mode recording is on: every scan on this
    /// screen is being persisted, and that should never be a surprise.
    private var devModeRecordingBadge: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(Color.red)
                .frame(width: 8, height: 8)
            Text("Recording scans for model testing")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.black.opacity(0.6), in: Capsule())
        .accessibilityLabel("Dev mode is recording every scan")
    }

    private func photoImportStatus(_ progress: ScannerPhotoImportProgress) -> some View {
        HStack(spacing: 8) {
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: .white))
            Text("Scanning \(progress.captureMode.displayName.lowercased()) photo \(progress.current) of \(progress.total)…")
                .font(.callout)
                .foregroundStyle(.white)
        }
        .padding(12)
        .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var statusContent: some View {
        switch viewModel.state {
        case .unauthorized:
            VStack(spacing: 12) {
                Text("Camera access is required to scan cards.")
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                HStack(spacing: 10) {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text("Open Settings")
                            .font(.callout.weight(.semibold))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .background(Color.white)
                            .foregroundColor(.black)
                            .cornerRadius(10)
                    }
                    Button {
                        viewModel.prepareCameraIfPossible()
                    } label: {
                        Text("Try Again")
                            .font(.callout.weight(.semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(Color.white.opacity(0.6), lineWidth: 1)
                            )
                    }
                }
            }
            .padding(16)
            .background(Color.black.opacity(0.6))
            .cornerRadius(12)
        case .processing:
            HStack(spacing: 8) {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                Text(viewModel.captureMode == .binder ? "Scanning binder page..." : "Identifying card...")
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
                Text("Enable at least one scanner-supported game in Settings to scan cards.")
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
            // The game selector shares the camera toolbar row, so one row of
            // clearance keeps the guide large without putting controls over it.
            let topClearance: CGFloat = 72
            // The guide shrinks as the bottom controls grow (session tray,
            // testing tools) so they never cover it.
            let bottomClearance: CGFloat = bottomControlsHeight + 20
            let availableHeight = max(0, geometry.size.height - topClearance - bottomClearance)
            let width = min(geometry.size.width - 48, availableHeight / 1.4)
            let height = width * 1.4

            ZStack {
                RoundedRectangle(cornerRadius: ScannerGuideLayout.cornerRadius)
                    .strokeBorder(Color.white.opacity(0.42), lineWidth: 1)

                ScannerCornerGuide(cornerRadius: ScannerGuideLayout.cornerRadius)
                    .stroke(
                        accentColor(for: viewModel.selectedMode),
                        style: StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round)
                    )

                Text(framingInstruction)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .background(.ultraThinMaterial, in: Capsule())
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
                    .frame(maxHeight: .infinity, alignment: .bottom)
            }
                .frame(width: width, height: height)
                .background {
                    GeometryReader { guideGeometry in
                        Color.clear.preference(
                            key: ScannerGuideFramePreferenceKey.self,
                            value: guideGeometry.frame(in: .global)
                        )
                    }
                }
                .position(
                    x: geometry.size.width / 2,
                    y: topClearance + availableHeight / 2
                )
                .animation(.snappy, value: bottomControlsHeight)
        }
        .allowsHitTesting(false)
    }

    private var bottomControls: some View {
        VStack(spacing: 10) {
            // Debug captures are stored on the server, so the control is
            // pointless without one.
            if hasEnabledScanModes && isModeSupported && !environmentStore.serverConfiguration.isOnDevice {
                debugCaptureControls
            }

            if viewModel.captureMode == .binder, viewModel.binderPagesScanned > 0 {
                binderSessionSummary
            } else if !viewModel.sessionResults.isEmpty || viewModel.liveConfirmationCount > 0 {
                ScannerSessionTray(
                    results: viewModel.sessionResults,
                    pendingCardName: viewModel.liveCandidateName,
                    pendingCount: viewModel.liveConfirmationCount,
                    pendingRequired: viewModel.liveConfirmationRequired,
                    color: accentColor(for: viewModel.selectedMode),
                    onReview: { showingSessionReview = true },
                    onSelect: viewModel.presentSessionResult,
                    onRemove: viewModel.removeSessionResult,
                    onClear: viewModel.clearSession
                )
            }

            adaptiveCaptureControls
        }
        .animation(.snappy, value: viewModel.liveConfirmationCount)
        .animation(.snappy, value: viewModel.sessionResults.count)
    }

    @ViewBuilder
    private var adaptiveCaptureControls: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 12) {
                captureControlsLayout
            }
        } else {
            captureControlsLayout
        }
    }

    private var captureControlsLayout: some View {
        captureActionControl
            .frame(maxWidth: .infinity)
            .overlay(alignment: .leading) {
                captureModeControl
            }
            .overlay(alignment: .trailing) {
                engineControl
            }
    }

    @ViewBuilder
    private var captureActionControl: some View {
        if viewModel.captureMode == .binder || viewModel.triggerMode == .manual {
            Button(action: viewModel.capturePhoto) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.16))
                        .frame(width: 76, height: 76)
                    Circle()
                        .fill(accentColor(for: viewModel.selectedMode))
                        .frame(width: 62, height: 62)
                    if isProcessingPhoto {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Image(systemName: "camera.aperture")
                            .font(.title2)
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
            .accessibilityLabel(viewModel.captureMode == .binder ? "Scan binder page" : "Scan card")
            .accessibilityHint(viewModel.captureMode == .binder
                ? "Captures and identifies every card on the page"
                : "Captures the card inside the guide")
        } else {
            ZStack {
                Circle()
                    .fill(Color.white.opacity(0.16))
                    .frame(width: 76, height: 76)
                Circle()
                    .fill(accentColor(for: viewModel.selectedMode).opacity(0.88))
                    .frame(width: 62, height: 62)
                if viewModel.isAnalyzingFrame {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                } else {
                    Image(systemName: "viewfinder")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(.white)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Automatic scanning active")
            .accessibilityHint("Center one card and hold it steady")
        }
    }

    private var captureModeControl: some View {
        Menu {
            ForEach(ScannerCaptureMode.allCases) { mode in
                Button {
                    viewModel.captureMode = mode
                } label: {
                    if viewModel.captureMode == mode {
                        Label(mode.displayName, systemImage: "checkmark")
                    } else {
                        Label(mode.displayName, systemImage: mode.systemImage)
                    }
                }
            }
        } label: {
            ScannerOptionLabel(
                title: viewModel.captureMode.displayName,
                systemImage: viewModel.captureMode.systemImage
            )
        }
        .disabled(isProcessingPhoto)
        .animation(.snappy, value: viewModel.captureMode)
        .accessibilityLabel("Scanner capture mode")
        .accessibilityValue(viewModel.captureMode.displayName)
    }

    private var binderSessionSummary: some View {
        HStack(spacing: 10) {
            Button {
                viewModel.reopenBinderReview()
            } label: {
                HStack(spacing: 8) {
                    Label("\(viewModel.binderPagesScanned) pages", systemImage: "rectangle.stack")
                    Text("·")
                    Text("\(viewModel.binderCardsScanned) cards")
                    if viewModel.binderCardsAdded > 0 {
                        Text("·")
                        Text("\(viewModel.binderCardsAdded) added")
                    }
                    Label("Review", systemImage: "chevron.right")
                        .fontWeight(.semibold)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                "Review \(viewModel.binderPagesScanned) binder pages, " +
                    "\(viewModel.binderCardsScanned) detected cards, " +
                    "\(viewModel.binderCardsAdded) added"
            )

            Spacer(minLength: 0)
            Button("Clear") {
                viewModel.clearBinderSession()
            }
            .font(.caption.weight(.semibold))
            .accessibilityHint("Clears all scanned binder pages and their review changes")
        }
        .font(.caption)
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color.black.opacity(0.48), in: Capsule())
    }

    @ViewBuilder
    private var gameControl: some View {
        if scope == nil, availableScanModes.count > 1 {
            Menu {
                ForEach(availableScanModes) { mode in
                    Button {
                        viewModel.selectedMode = mode
                    } label: {
                        if mode == viewModel.selectedMode {
                            Label(mode.displayName, systemImage: "checkmark")
                        } else {
                            Text(mode.displayName)
                        }
                    }
                }
            } label: {
                ScannerOptionLabel(
                    title: viewModel.selectedMode.displayName,
                    systemImage: "rectangle.stack"
                )
            }
            .accessibilityLabel("Card game")
            .accessibilityValue(viewModel.selectedMode.displayName)
        } else {
            ScannerOptionLabel(
                title: hasEnabledScanModes ? viewModel.selectedMode.displayName : "No games",
                systemImage: "rectangle.stack",
                isInteractive: false
            )
            .accessibilityLabel("Card game")
            .accessibilityValue(hasEnabledScanModes ? viewModel.selectedMode.displayName : "No enabled games")
        }
    }

    @ViewBuilder
    private var engineControl: some View {
        if availableScanEngines.count > 1 {
            Menu {
                ForEach(availableScanEngines) { engine in
                    Button {
                        viewModel.selectedEngine = engine
                    } label: {
                        if engine == viewModel.selectedEngine {
                            Label(engine.displayName, systemImage: "checkmark")
                        } else {
                            Text(engine.displayName)
                        }
                    }
                }
            } label: {
                ScannerOptionLabel(
                    title: engineControlTitle,
                    systemImage: viewModel.selectedEngine.isLocalOnly ? "iphone" : "wand.and.stars"
                )
            }
            .accessibilityLabel("Recognition engine")
            .accessibilityValue(viewModel.selectedEngine.displayName)
            .accessibilityHint("On-device recognition works privately without a server")
        } else {
            ScannerOptionLabel(
                title: engineControlTitle,
                systemImage: viewModel.selectedEngine.isLocalOnly ? "iphone" : "wand.and.stars",
                isInteractive: false
            )
            .accessibilityLabel("Recognition engine")
            .accessibilityValue(availableScanEngines.first?.displayName ?? "Unavailable")
            .accessibilityHint("On-device recognition works privately without a server")
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

    private func scanDemoImage() {
        guard !isProcessingPhoto else { return }
        guard let image = ScannerDemoFixture.image(for: viewModel.captureMode) else {
            viewModel.errorMessage = "The bundled scanner demo fixtures are unavailable."
            return
        }
        Task { await viewModel.scanCurrentCaptureMode(image: image) }
    }

    private func presentPhotoPicker(_ mode: ScannerPhotoPickerMode) {
        selectedPhotoItems = []
        photoPickerMode = mode
    }

    private func scanSelectedPhotos(_ items: [PhotosPickerItem]) async {
        let captureMode = viewModel.captureMode
        let isBulkImport = items.count > 1
        let shouldDeferBinderReview = isBulkImport && captureMode == .binder
        let shouldSuppressCardSheets = isBulkImport && captureMode == .card && automaticallyShowResults
        let binderPageCountBeforeImport = viewModel.binderPagesScanned
        var loadFailureCount = 0

        viewModel.setPhotoImportActive(true)
        if shouldSuppressCardSheets {
            viewModel.setAutomaticallyPresentsResults(false)
        }

        for (index, item) in items.enumerated() {
            photoImportProgress = ScannerPhotoImportProgress(
                captureMode: captureMode,
                current: index + 1,
                total: items.count
            )

            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    loadFailureCount += 1
                    continue
                }
                await viewModel.scan(
                    imageData: data,
                    presentsBinderReview: !shouldDeferBinderReview
                )
            } catch is CancellationError {
                break
            } catch {
                loadFailureCount += 1
            }
        }

        if shouldDeferBinderReview, viewModel.binderPagesScanned > binderPageCountBeforeImport {
            viewModel.reopenBinderReview()
        }
        if shouldSuppressCardSheets {
            viewModel.setAutomaticallyPresentsResults(true)
        }
        viewModel.setPhotoImportActive(false)

        selectedPhotoItems = []
        photoImportProgress = nil

        if loadFailureCount > 0 {
            viewModel.errorMessage = "Unable to load \(loadFailureCount) of \(items.count) selected photos."
        }
    }

    private func accentColor(for mode: ScanMode) -> Color {
        switch mode {
        case .pokemon: return Color.red
        case .yugioh: return Color.purple
        case .mtg: return Color.green
        }
    }

}

private extension CardScannerView {
    var isSimulator: Bool {
        #if targetEnvironment(simulator)
        true
        #else
        false
        #endif
    }

    var availableScanModes: [ScanMode] {
        ScanMode.allCases.filter { environmentStore.isGameEnabled($0.tcgGame) }
    }

    /// Server-backed matchers are hidden in phone-only mode — there is no
    /// backend to send the capture to.
    var availableScanEngines: [ScanEnginePreference] {
        let isOnDevice = environmentStore.serverConfiguration.isOnDevice
        return ScanEnginePreference.allCases.filter { engine in
            guard engine.supports(viewModel.selectedMode) else { return false }
            return !isOnDevice || !engine.requiresServerOnlyFlow
        }
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

    /// Deep links (tcger://scan?game=…) stash the requested game under this key
    /// because the scanner may not be on screen when the URL arrives.
    func consumePendingScanMode() {
        let defaults = UserDefaults.standard
        guard let raw = defaults.string(forKey: "scanner.pendingMode") else { return }
        defaults.removeObject(forKey: "scanner.pendingMode")
        guard let mode = ScanMode(rawValue: raw), availableScanModes.contains(mode) else { return }
        viewModel.selectedMode = mode
    }

    var isModeSupported: Bool {
        viewModel.isModeSupported(viewModel.selectedMode)
    }

    var isProcessingPhoto: Bool {
        if photoImportProgress != nil {
            return true
        }
        if viewModel.isProcessingPhoto {
            return true
        }
        if case .processing = viewModel.state {
            return true
        }
        return false
    }

    var photoPickerIsPresented: Binding<Bool> {
        Binding(
            get: { photoPickerMode != nil },
            set: { isPresented in
                if !isPresented {
                    photoPickerMode = nil
                }
            }
        )
    }

    var photoPickerSelectionLimit: Int? {
        switch photoPickerMode {
        case .single:
            return 1
        case .bulk:
            return viewModel.captureMode == .binder ? 30 : 100
        case nil:
            return 1
        }
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

    var framingInstruction: String {
        if viewModel.captureMode == .binder {
            return "Fit the full binder page · Tap to scan"
        }
        return viewModel.triggerMode == .automatic && viewModel.supportsLivePreview(viewModel.selectedMode)
            ? "Center one card · Hold steady"
            : "Center one card · Tap shutter"
    }

    var engineControlTitle: String {
        switch viewModel.selectedEngine {
        case .localOnly:
            return "Offline AI"
        case .automatic:
            return "Auto AI"
        case .serverHash:
            return "Server Hash"
        case .serverEmbedding:
            return "Server AI"
        }
    }
}

private struct ScannerOptionLabel: View {
    let title: String
    let systemImage: String
    var isInteractive = true

    var body: some View {
        adaptiveLabel
    }

    @ViewBuilder
    private var adaptiveLabel: some View {
        if #available(iOS 26.0, *) {
            labelContent
                .glassEffect(.regular.interactive(isInteractive), in: .capsule)
        } else {
            labelContent
                .background(.ultraThinMaterial, in: Capsule())
        }
    }

    private var labelContent: some View {
        VStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(.body.weight(.semibold))
            Text(title)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .foregroundStyle(.primary)
        .frame(width: 96, height: 48)
        .contentShape(Capsule())
    }
}

private struct ScannerCornerGuide: Shape {
    let cornerRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        let cornerLength = min(34, min(rect.width, rect.height) * 0.16)
        let radius = min(cornerRadius, cornerLength, rect.width / 2, rect.height / 2)
        var path = Path()

        path.move(to: CGPoint(x: rect.minX, y: rect.minY + cornerLength))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + radius, y: rect.minY),
            control: CGPoint(x: rect.minX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.minX + cornerLength, y: rect.minY))

        path.move(to: CGPoint(x: rect.maxX - cornerLength, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX, y: rect.minY + radius),
            control: CGPoint(x: rect.maxX, y: rect.minY)
        )
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + cornerLength))

        path.move(to: CGPoint(x: rect.maxX, y: rect.maxY - cornerLength))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
        path.addQuadCurve(
            to: CGPoint(x: rect.maxX - radius, y: rect.maxY),
            control: CGPoint(x: rect.maxX, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.maxX - cornerLength, y: rect.maxY))

        path.move(to: CGPoint(x: rect.minX + cornerLength, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX, y: rect.maxY - radius),
            control: CGPoint(x: rect.minX, y: rect.maxY)
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY - cornerLength))

        return path
    }
}

private struct ScanResultSheet: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var selectedCandidate: CardScanCandidate
    @State private var cardToAdd: Card?
    @State private var debugCapture: APIService.ScanDebugCaptureResponse?
    @State private var debugCaptureError: String?
    @State private var isUpdatingDebugCapture = false

    let result: CardScanResult
    let color: Color
    let onSelectCandidate: (CardScanCandidate) -> Void
    let onAddCard: (Card, String, BinderCardAddDetails) async throws -> Void

    init(
        result: CardScanResult,
        color: Color,
        onSelectCandidate: @escaping (CardScanCandidate) -> Void,
        onAddCard: @escaping (Card, String, BinderCardAddDetails) async throws -> Void
    ) {
        self.result = result
        self.color = color
        self.onSelectCandidate = onSelectCandidate
        self.onAddCard = onAddCard
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
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add to Binder") {
                        cardToAdd = candidateCard
                    }
                    .disabled(candidateCard == nil)
                }
            }
        }
        .sheet(item: $cardToAdd) { card in
            AddCardToBinderSheet(card: card) { binderId, details in
                try await onAddCard(card, binderId, details)
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
                Label(price.priceText, systemImage: "dollarsign.circle")
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

            ScanMetricRow(label: "Strategy", value: selectedCandidate.originatingStrategy.displayName)
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
                    onSelectCandidate(candidate)
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

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
    @State private var pullSession: PackOpeningPullSession?
    @State private var interfaceState = PackOpeningInterfaceState.loading
    @State private var command: PackOpeningCommand?
    @State private var selectedArtwork: PhotosPickerItem?
    @State private var rendererReady = false
    @State private var prefetchedSessionID: String?
    @StateObject private var webSession: PackOpeningWebSession

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
                PackOpeningNativeResultsView(session: session)
                    .transition(.opacity)
            }

            VStack(spacing: 0) {
                topOverlay
                Spacer(minLength: 24)
                if let errorMessage {
                    errorOverlay(errorMessage)
                } else if rendererReady {
                    bottomOverlay
                }
            }
            .padding(.horizontal, 16)
            .safeAreaPadding(.top, 8)
            .safeAreaPadding(.bottom, 12)
        }
        .sheet(item: $pullSession) { session in
            PackOpeningReviewSheet(session: session) {
                phase = "Saved to collection"
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
        .onDisappear {
            webSession.send(.backToPacks)
        }
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
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(interfaceState.showsNativeResults ? "Pack Results" : "Open Packs")
                        .font(.headline)
                    if interfaceState.phase != .loading {
                        Text(interfaceState.subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .contentTransition(.numericText())
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .glassEffect(.regular, in: .capsule)

                Spacer(minLength: 0)

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
                HStack(spacing: 10) {
                    Menu {
                        ForEach(interfaceState.packOptions) { option in
                            Button(option.label) { send(.selectPack(option.id)) }
                        }
                    } label: {
                        Label(interfaceState.selectedPackLabel, systemImage: "shippingbox.fill")
                            .lineLimit(1)
                    }
                    .buttonStyle(.glass)

                    PhotosPicker(selection: $selectedArtwork, matching: .images) {
                        Image(systemName: "photo.badge.plus")
                            .frame(width: 24, height: 24)
                    }
                    .buttonStyle(.glass)
                    .accessibilityLabel("Use custom pack artwork")
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
                instruction("Swipe across the seal, or open it now", icon: "hand.draw.fill")
                HStack(spacing: 10) {
                    backButton
                    Button("Open Pack") { send(.advance) }
                        .buttonStyle(.glassProminent)
                }
            }

        case .opening:
            VStack(spacing: 10) {
                instruction(
                    interfaceState.totalPacks == 1 ? "Opening your pack…" : "Opening \(interfaceState.totalPacks) packs…",
                    icon: "sparkles"
                )
                backButton
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
                    Button("Show All") { send(.showAll) }
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
            if let session = state.session, prefetchedSessionID != session.id {
                prefetchedSessionID = session.id
                ImageCache.shared.prefetch(urls: session.resultArtworkURLs)
            }
            interfaceState = state
        case .haptic(let style):
            switch style {
            case "selection": HapticManager.selection()
            case "success": HapticManager.notification(.success)
            default: HapticManager.impact(.medium)
            }
        case .saveRequested(let session):
            pullSession = session
        case .error(let message):
            errorMessage = message
        }
    }
}

private struct PackOpeningNativeResultsView: View {
    let session: PackOpeningPullSession

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
                resultSummary

                if session.packs.count > 1, let bestPull {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Best Pull", systemImage: "sparkles")
                            .font(.title3.bold())
                            .foregroundStyle(.orange)

                        PackOpeningNativeResultCard(pull: bestPull)
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
                            ForEach(Array(pack.enumerated()), id: \.offset) { _, pull in
                                PackOpeningNativeResultCard(pull: pull)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 82)
            .padding(.bottom, 94)
        }
        .scrollIndicators(.hidden)
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .accessibilityLabel("Pack results for \(session.packLabel)")
    }

    private var resultSummary: some View {
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

private struct PackOpeningNativeResultCard: View {
    let pull: PackOpeningPull

    var body: some View {
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
            .clipShape(.rect(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(tierColor.opacity(0.7), lineWidth: 2)
            }
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

struct PackOpeningInterfaceState: Codable, Equatable {
    enum Phase: String, Codable {
        case loading, select, tear, opening, reveal, summary, final
    }

    struct PackOption: Codable, Equatable, Identifiable {
        let id: String
        let label: String
    }

    let phase: Phase
    let selectedPackID: String
    let selectedPackLabel: String
    let packCount: Int
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
        case selectPack, setPackCount, openPack, backToPacks, advance, showAll, savePulls, uploadArtwork
    }

    let id = UUID()
    let action: Action
    var optionID: String?
    var count: Int?
    var dataURL: String?
    var label: String?

    var payload: [String: Any] {
        var value: [String: Any] = ["type": action.rawValue]
        if let optionID { value["id"] = optionID }
        if let count { value["count"] = count }
        if let dataURL { value["dataURL"] = dataURL }
        if let label { value["label"] = label }
        return value
    }

    static func selectPack(_ id: String) -> Self { .init(action: .selectPack, optionID: id) }
    static func setPackCount(_ count: Int) -> Self { .init(action: .setPackCount, count: count) }
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

    init(
        remoteBaseURL: URL = PackOpeningResource.remoteBaseURL(),
        session: URLSession = .shared
    ) {
        self.remoteBaseURL = remoteBaseURL
        self.session = session
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

        var request = URLRequest(url: remoteURL)
        request.cachePolicy = .returnCacheDataElseLoad
        request.timeoutInterval = 20
        session.dataTask(with: request) { [weak self] data, response, error in
            if
                error == nil,
                let data,
                let response,
                (response as? HTTPURLResponse).map({ 200 ..< 300 ~= $0.statusCode }) ?? true
            {
                completion(.success(Resource(
                    data: data,
                    mimeType: response.mimeType
                        ?? PackOpeningResource.mimeType(for: remoteURL.pathExtension)
                )))
                return
            }
            self?.loadBundled(requestURL, completion: completion)
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
}

enum PackOpeningResource {
    static let scheme = "tcger-pack"
    static let bundleHost = "bundle"
    static let assetHost = "assets"
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
}

@MainActor
final class PackOpeningSchemeHandler: NSObject, WKURLSchemeHandler {
    private struct RemoteTask {
        let dataTask: URLSessionDataTask
        let schemeTask: any WKURLSchemeTask
    }

    private let remoteBaseURL: URL
    private let session: URLSession
    private var remoteTasks: [ObjectIdentifier: RemoteTask] = [:]

    init(
        remoteBaseURL: URL? = nil,
        session: URLSession = .shared
    ) {
        self.remoteBaseURL = remoteBaseURL ?? PackOpeningResource.remoteBaseURL()
        self.session = session
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
        let key = ObjectIdentifier(schemeTask as AnyObject)
        var request = URLRequest(url: remoteURL)
        request.cachePolicy = .returnCacheDataElseLoad
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
                    let bridgedResponse = URLResponse(
                        url: requestURL,
                        mimeType: response.mimeType ?? PackOpeningResource.mimeType(for: remoteURL.pathExtension),
                        expectedContentLength: data.count,
                        textEncodingName: response.textEncodingName
                    )
                    remoteTask.schemeTask.didReceive(bridgedResponse)
                    remoteTask.schemeTask.didReceive(data)
                    remoteTask.schemeTask.didFinish()
                } else {
                    self.loadBundled(requestURL, schemeTask: remoteTask.schemeTask)
                }
            }
        }
        remoteTasks[key] = RemoteTask(dataTask: task, schemeTask: schemeTask)
        task.resume()
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

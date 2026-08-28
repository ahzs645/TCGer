import SwiftUI
import Combine
import UIKit
@preconcurrency import WebKit

@MainActor
final class PackOpeningWebSession: ObservableObject {
    let coordinator: PackOpeningWebCoordinator
    let webView: WKWebView
    @Published private(set) var remoteAssetsUsable = false

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
        coordinator.resourceBridge.setRemoteAvailabilityHandler { [weak self] isUsable in
            Task { @MainActor [weak self] in self?.remoteAssetsUsable = isUsable }
        }
        coordinator.resourceHandler.setRemoteAvailabilityHandler { [weak self] isUsable in
            self?.remoteAssetsUsable = isUsable
        }

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
        if prefersBundledResources { remoteAssetsUsable = false }
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
    private var _onRemoteAvailabilityChanged: (Bool) -> Void = { _ in }

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
        if prefersBundledResources { reportRemoteAvailability(false) }
    }

    func setRemoteAvailabilityHandler(_ handler: @escaping (Bool) -> Void) {
        resourceModeLock.withLock { _onRemoteAvailabilityChanged = handler }
    }

    private func reportRemoteAvailability(_ isUsable: Bool) {
        let handler = resourceModeLock.withLock { _onRemoteAvailabilityChanged }
        handler(isUsable)
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
        if let cached = assetCache.data(for: remoteURL) {
            if isManifest { reportRemoteAvailability(false) }
            completion(.success(Resource(
                data: cached,
                mimeType: PackOpeningResource.mimeType(for: remoteURL.pathExtension)
            )))
            if isManifest,
               !prefersBundledResources,
               NetworkMonitor.shared.isConnected {
                refreshCachedResource(remoteURL)
            }
            return
        }

        if prefersBundledResources {
            if isManifest { reportRemoteAvailability(false) }
            loadBundled(requestURL, completion: completion)
            return
        }

        guard NetworkMonitor.shared.isConnected else {
            if isManifest { reportRemoteAvailability(false) }
            loadBundled(requestURL, completion: completion)
            return
        }

        var request = URLRequest(url: remoteURL)
        request.cachePolicy = PackOpeningResource.cachePolicy(for: remoteURL)
        request.timeoutInterval = PackOpeningResource.requestTimeout(for: remoteURL)
        session.dataTask(with: request) { [weak self] data, response, error in
            if
                error == nil,
                let data,
                let response,
                (response as? HTTPURLResponse).map({ 200 ..< 300 ~= $0.statusCode }) ?? true
            {
                if isManifest { self?.reportRemoteAvailability(true) }
                self?.assetCache.store(data, for: remoteURL)
                completion(.success(Resource(
                    data: data,
                    mimeType: response.mimeType
                        ?? PackOpeningResource.mimeType(for: remoteURL.pathExtension)
                )))
                return
            }
            if isManifest { self?.reportRemoteAvailability(false) }
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

    /// A cached manifest is sufficient to start the renderer. Refresh it for a
    /// future opening without making the current opening wait for a network
    /// route that may be technically satisfied but unusably weak.
    private func refreshCachedResource(_ remoteURL: URL) {
        var request = URLRequest(url: remoteURL)
        request.cachePolicy = PackOpeningResource.cachePolicy(for: remoteURL)
        request.timeoutInterval = PackOpeningResource.requestTimeout(for: remoteURL)
        session.dataTask(with: request) { [weak self] data, response, error in
            guard
                error == nil,
                let data,
                let response,
                (response as? HTTPURLResponse).map({ 200 ..< 300 ~= $0.statusCode }) ?? true
            else {
                self?.reportRemoteAvailability(false)
                return
            }
            self?.assetCache.store(data, for: remoteURL)
            self?.reportRemoteAvailability(true)
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

    /// Metadata has a bundled/cached fallback and must fail over quickly. Large
    /// immutable textures can keep the longer timeout because they never block
    /// a cached pack opening.
    static func requestTimeout(for remoteURL: URL) -> TimeInterval {
        isManifest(remoteURL) ? 3 : 20
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
    private var onRemoteAvailabilityChanged: (Bool) -> Void = { _ in }

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
        if prefersBundledResources { onRemoteAvailabilityChanged(false) }
    }

    func setRemoteAvailabilityHandler(_ handler: @escaping (Bool) -> Void) {
        onRemoteAvailabilityChanged = handler
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
        if let cached = assetCache.data(for: remoteURL) {
            if isManifest { onRemoteAvailabilityChanged(false) }
            deliver(
                cached,
                remoteURL: remoteURL,
                requestURL: requestURL,
                schemeTask: schemeTask
            )
            if isManifest,
               !prefersBundledResources,
               NetworkMonitor.shared.isConnected {
                refreshCachedResource(remoteURL)
            }
            return
        }

        if prefersBundledResources {
            if isManifest { onRemoteAvailabilityChanged(false) }
            loadBundled(requestURL, schemeTask: schemeTask)
            return
        }

        guard NetworkMonitor.shared.isConnected else {
            if isManifest { onRemoteAvailabilityChanged(false) }
            loadBundled(requestURL, schemeTask: schemeTask)
            return
        }

        let key = ObjectIdentifier(schemeTask as AnyObject)
        var request = URLRequest(url: remoteURL)
        request.cachePolicy = PackOpeningResource.cachePolicy(for: remoteURL)
        request.timeoutInterval = PackOpeningResource.requestTimeout(for: remoteURL)

        let task = session.dataTask(with: request) { [weak self] data, response, error in
            Task { @MainActor [weak self] in
                guard let self, let remoteTask = self.remoteTasks.removeValue(forKey: key) else { return }
                if
                    error == nil,
                    let data,
                    let response,
                    (response as? HTTPURLResponse).map({ 200 ..< 300 ~= $0.statusCode }) ?? true
                {
                    if isManifest { self.onRemoteAvailabilityChanged(true) }
                    self.assetCache.store(data, for: remoteURL)
                    self.deliver(
                        data,
                        remoteURL: remoteURL,
                        requestURL: requestURL,
                        schemeTask: remoteTask.schemeTask,
                        textEncodingName: response.textEncodingName
                    )
                } else {
                    if isManifest { self.onRemoteAvailabilityChanged(false) }
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

    private func refreshCachedResource(_ remoteURL: URL) {
        var request = URLRequest(url: remoteURL)
        request.cachePolicy = PackOpeningResource.cachePolicy(for: remoteURL)
        request.timeoutInterval = PackOpeningResource.requestTimeout(for: remoteURL)
        session.dataTask(with: request) { [weak self] data, response, error in
            Task { @MainActor [weak self] in
                guard let self else { return }
                guard
                    error == nil,
                    let data,
                    let response,
                    (response as? HTTPURLResponse).map({ 200 ..< 300 ~= $0.statusCode }) ?? true
                else {
                    self.onRemoteAvailabilityChanged(false)
                    return
                }
                self.assetCache.store(data, for: remoteURL)
                self.onRemoteAvailabilityChanged(true)
            }
        }.resume()
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

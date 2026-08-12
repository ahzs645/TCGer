import SwiftUI
import WebKit

struct PackOpeningView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var phase = "Loading"
    @State private var errorMessage: String?
    @State private var reloadID = UUID()
    @State private var pullSession: PackOpeningPullSession?

    var body: some View {
        NavigationStack {
            ZStack {
                PackOpeningWebView { event in
                    handle(event)
                }
                .id(reloadID)
                .ignoresSafeArea(edges: .bottom)

                if let errorMessage {
                    ContentUnavailableView {
                        Label("Pack Opening Unavailable", systemImage: "shippingbox")
                    } description: {
                        Text(errorMessage)
                    } actions: {
                        Button("Try Again") {
                            self.errorMessage = nil
                            reloadID = UUID()
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .padding()
                    .background(.background)
                }
            }
            .navigationTitle("Open Packs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    VStack(spacing: 1) {
                        Text("Open Packs")
                            .font(.headline)
                        Text(phase)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .sheet(item: $pullSession) { session in
            PackOpeningReviewSheet(session: session) {
                phase = "Saved to collection"
            }
        }
    }

    private func handle(_ event: PackOpeningBridgeEvent) {
        switch event {
        case .ready:
            phase = "Choose a pack"
            errorMessage = nil
        case .phaseChanged(let value):
            phase = value.replacingOccurrences(of: "([a-z])([A-Z])", with: "$1 $2", options: .regularExpression)
                .capitalized
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

enum PackOpeningBridgeEvent: Equatable {
    case ready
    case phaseChanged(String)
    case haptic(String)
    case saveRequested(PackOpeningPullSession)
    case error(String)
}

struct PackOpeningWebView: UIViewRepresentable {
    let onEvent: (PackOpeningBridgeEvent) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onEvent: onEvent)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.preferences.isTextInteractionEnabled = false
        configuration.userContentController.add(context.coordinator, name: Coordinator.bridgeName)
        configuration.setURLSchemeHandler(context.coordinator.resourceHandler, forURLScheme: PackOpeningResource.scheme)

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        guard PackOpeningResource.rootURL() != nil else {
            onEvent(.error("PackOpening.bundle is missing. Run `bash scripts/ios-assets.sh build`."))
            return webView
        }
        webView.load(URLRequest(url: PackOpeningResource.entryURL))
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        context.coordinator.onEvent = onEvent
    }

    static func dismantleUIView(_ webView: WKWebView, coordinator: Coordinator) {
        webView.configuration.userContentController.removeScriptMessageHandler(forName: Coordinator.bridgeName)
        webView.evaluateJavaScript("window.tcgerPack?.destroy()")
        webView.stopLoading()
        webView.navigationDelegate = nil
    }

    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        static let bridgeName = "packBridge"
        let resourceHandler = PackOpeningSchemeHandler()
        var onEvent: (PackOpeningBridgeEvent) -> Void

        init(onEvent: @escaping (PackOpeningBridgeEvent) -> Void) {
            self.onEvent = onEvent
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard
                message.name == Self.bridgeName,
                let payload = message.body as? [String: Any],
                let type = payload["type"] as? String
            else { return }

            switch type {
            case "ready":
                onEvent(.ready)
            case "phaseChanged":
                if let phase = payload["phase"] as? String { onEvent(.phaseChanged(phase)) }
            case "haptic":
                if let style = payload["style"] as? String { onEvent(.haptic(style)) }
            case "saveRequested":
                if let session = PackOpeningBridgeDecoder.pullSession(from: payload) {
                    onEvent(.saveRequested(session))
                } else {
                    onEvent(.error("The completed pack results could not be read."))
                }
            case "error":
                onEvent(.error(payload["message"] as? String ?? "The pack renderer reported an error."))
            default:
                break
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: any Error) {
            onEvent(.error(error.localizedDescription))
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: any Error) {
            onEvent(.error(error.localizedDescription))
        }
    }
}

enum PackOpeningBridgeDecoder {
    private struct SaveMessage: Decodable {
        let session: PackOpeningPullSession
    }

    static func pullSession(from body: Any) -> PackOpeningPullSession? {
        guard JSONSerialization.isValidJSONObject(body),
              let data = try? JSONSerialization.data(withJSONObject: body),
              let message = try? JSONDecoder().decode(SaveMessage.self, from: data)
        else { return nil }
        return message.session
    }
}

enum PackOpeningResource {
    static let scheme = "tcger-pack"
    static let bundleHost = "bundle"
    static let assetHost = "assets"
    static let entryURL = URL(string: "\(scheme)://\(bundleHost)/index.html")!
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

final class PackOpeningSchemeHandler: NSObject, WKURLSchemeHandler {
    private let remoteBaseURL: URL
    private let session: URLSession
    private let taskLock = NSLock()
    private var remoteTasks: [ObjectIdentifier: URLSessionDataTask] = [:]

    init(
        remoteBaseURL: URL = PackOpeningResource.remoteBaseURL(),
        session: URLSession = .shared
    ) {
        self.remoteBaseURL = remoteBaseURL
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
        taskLock.lock()
        let task = remoteTasks.removeValue(forKey: key)
        taskLock.unlock()
        task?.cancel()
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
            guard let self, self.removeRemoteTask(for: key) else { return }
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
                schemeTask.didReceive(bridgedResponse)
                schemeTask.didReceive(data)
                schemeTask.didFinish()
            } else {
                self.loadBundled(requestURL, schemeTask: schemeTask)
            }
        }
        taskLock.lock()
        remoteTasks[key] = task
        taskLock.unlock()
        task.resume()
    }

    @discardableResult
    private func removeRemoteTask(for key: ObjectIdentifier) -> Bool {
        taskLock.lock()
        defer { taskLock.unlock() }
        return remoteTasks.removeValue(forKey: key) != nil
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

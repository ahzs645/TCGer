import Foundation
import UIKit
import WebKit

struct DecodedRemoteImage {
    let image: UIImage
    let cacheData: Data
}

@MainActor
enum RemoteImageDecoder {
    static func decode(
        data: Data,
        response: HTTPURLResponse,
        url: URL
    ) async -> DecodedRemoteImage? {
        guard isSVG(data: data, response: response, url: url) else {
            guard let image = UIImage(data: data) else { return nil }
            return DecodedRemoteImage(image: image, cacheData: data)
        }

        guard let image = await SVGSnapshotRenderer.shared.image(from: data),
              let pngData = image.pngData() else {
            return nil
        }
        return DecodedRemoteImage(image: image, cacheData: pngData)
    }

    nonisolated static func isSVG(
        data: Data,
        response: HTTPURLResponse,
        url: URL
    ) -> Bool {
        if response.value(forHTTPHeaderField: "Content-Type")?
            .lowercased()
            .contains("image/svg+xml") == true {
            return true
        }
        if url.pathExtension.lowercased() == "svg" {
            return true
        }

        let prefix = data.prefix(512)
        guard let text = String(data: prefix, encoding: .utf8)?.lowercased() else {
            return false
        }
        return text.contains("<svg")
    }
}

@MainActor
private final class SVGSnapshotRenderer: NSObject, WKNavigationDelegate {
    static let shared = SVGSnapshotRenderer()

    private struct Request {
        let data: Data
        let continuation: CheckedContinuation<UIImage?, Never>
    }

    private final class ActiveRequest {
        let webView: WKWebView
        let continuation: CheckedContinuation<UIImage?, Never>

        init(webView: WKWebView, continuation: CheckedContinuation<UIImage?, Never>) {
            self.webView = webView
            self.continuation = continuation
        }
    }

    private var pending: [Request] = []
    private var active: ActiveRequest?
    private let renderSize = CGSize(width: 128, height: 128)

    func image(from data: Data) async -> UIImage? {
        await withCheckedContinuation { continuation in
            pending.append(Request(data: data, continuation: continuation))
            startNextIfNeeded()
        }
    }

    private func startNextIfNeeded() {
        guard active == nil, !pending.isEmpty else { return }
        let request = pending.removeFirst()

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let preferences = WKWebpagePreferences()
        preferences.allowsContentJavaScript = false
        configuration.defaultWebpagePreferences = preferences

        let webView = WKWebView(
            frame: CGRect(origin: .zero, size: renderSize),
            configuration: configuration
        )
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = self
        active = ActiveRequest(webView: webView, continuation: request.continuation)
        webView.load(
            request.data,
            mimeType: "image/svg+xml",
            characterEncodingName: "utf-8",
            baseURL: URL(fileURLWithPath: "/")
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard active?.webView === webView else { return }
        let configuration = WKSnapshotConfiguration()
        configuration.rect = CGRect(origin: .zero, size: renderSize)
        webView.takeSnapshot(with: configuration) { [weak self] image, _ in
            Task { @MainActor in
                self?.finish(image)
            }
        }
    }

    func webView(
        _ webView: WKWebView,
        didFail navigation: WKNavigation!,
        withError error: any Error
    ) {
        guard active?.webView === webView else { return }
        finish(nil)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: any Error
    ) {
        guard active?.webView === webView else { return }
        finish(nil)
    }

    private func finish(_ image: UIImage?) {
        guard let active else { return }
        self.active = nil
        active.continuation.resume(returning: image)
        startNextIfNeeded()
    }
}

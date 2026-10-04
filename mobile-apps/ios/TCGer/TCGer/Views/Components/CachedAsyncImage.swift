import SwiftUI
import UIKit
import Combine

/// The shared physical silhouette for trading-card artwork. A standard card is
/// 63 mm wide with approximately 3 mm corner radii, so the shape scales cleanly
/// from compact thumbnails to full-screen previews.
struct TradingCardShape: InsettableShape {
    private static let cornerRadiusRatio: CGFloat = 3 / 63
    private var insetAmount: CGFloat = 0

    func path(in rect: CGRect) -> Path {
        let insetRect = rect.insetBy(dx: insetAmount, dy: insetAmount)
        let radius = max(0, rect.width * Self.cornerRadiusRatio - insetAmount)
        return RoundedRectangle(cornerRadius: radius, style: .continuous)
            .path(in: insetRect)
    }

    func inset(by amount: CGFloat) -> TradingCardShape {
        var shape = self
        shape.insetAmount += amount
        return shape
    }
}

struct CachedAsyncImage<Content: View>: View {
    private let url: URL?
    private let fallbackAssetName: String?
    private let content: (AsyncImagePhase) -> Content

    @StateObject private var loader: CachedImageLoader

    init(
        url: URL?,
        fallbackAssetName: String? = nil,
        @ViewBuilder content: @escaping (AsyncImagePhase) -> Content
    ) {
        let url = url.flatMap { candidate -> URL? in
            guard let scheme = candidate.scheme?.lowercased() else { return nil }
            return ["http", "https", "file"].contains(scheme) ? candidate : nil
        }
        self.url = url
        self.fallbackAssetName = fallbackAssetName
        self.content = content

        let loader = CachedImageLoader()
        if let url,
           let cachedImage = ImageCache.shared.image(for: url) {
            loader.seed(with: url, image: cachedImage)
        }
        _loader = StateObject(wrappedValue: loader)
    }

    init(
        card: Card,
        thumbnail: Bool = true,
        @ViewBuilder content: @escaping (AsyncImagePhase) -> Content
    ) {
        let rawURL = thumbnail ? (card.imageUrlSmall ?? card.imageUrl) : (card.imageUrl ?? card.imageUrlSmall)
        let remoteURL = rawURL
            .flatMap(URL.init(string:))
            .flatMap { $0.scheme == nil ? nil : $0 }
        let fallback = TCGGame(rawValue: card.tcg)?.cardBackAssetName
        self.init(url: remoteURL, fallbackAssetName: fallback, content: content)
    }

    init(
        url: URL?,
        tcg: String,
        @ViewBuilder content: @escaping (AsyncImagePhase) -> Content
    ) {
        let remoteURL = url?.scheme == nil ? nil : url
        let fallback = TCGGame(rawValue: tcg)?.cardBackAssetName
        self.init(url: remoteURL, fallbackAssetName: fallback, content: content)
    }

    var body: some View {
        content(displayPhase)
            .task(id: url) {
                await loader.load(for: url)
            }
    }

    private var displayPhase: AsyncImagePhase {
        if case .success = loader.phase {
            return loader.phase
        }
        if let fallbackAssetName {
            return .success(Image(fallbackAssetName))
        }
        return loader.phase
    }
}

// MARK: - Loader
@MainActor
final class CachedImageLoader: ObservableObject {
    @Published private(set) var phase: AsyncImagePhase = .empty
    private var currentURL: URL?
    private var requestID = UUID()
    private var request: Task<DecodedRemoteImage, Error>?
    private let cache: ImageCache
    private let fetch: (URL) async throws -> DecodedRemoteImage

    init(cache: ImageCache = .shared, fetch: ((URL) async throws -> DecodedRemoteImage)? = nil) {
        self.cache = cache
        self.fetch = fetch ?? Self.fetchImage
    }

    func load(for url: URL?) async {
        if currentURL == url, case .success = phase { return }
        // Every invocation owns publication. A replacement cancels the previous
        // transport and remains safe even when that transport ignores cancellation.
        request?.cancel()
        let id = UUID()
        requestID = id
        currentURL = url
        phase = .empty
        guard let url else { request = nil; return }
        if let image = cache.image(for: url) {
            phase = .success(Image(uiImage: image))
            request = nil
            return
        }
        let task = Task { try await fetch(url) }
        request = task
        await withTaskCancellationHandler {
            do {
                let decoded = try await task.value
                guard requestID == id, currentURL == url, !Task.isCancelled, !task.isCancelled else { return }
                cache.store(decoded.image, data: decoded.cacheData, for: url)
                phase = .success(Image(uiImage: decoded.image))
            } catch {
                guard requestID == id, currentURL == url, !Task.isCancelled, !task.isCancelled else { return }
                phase = .failure(error)
            }
            if requestID == id { request = nil }
        } onCancel: { task.cancel() }
    }

    private static func fetchImage(_ url: URL) async throws -> DecodedRemoteImage {
        let data: Data
        let response: URLResponse
        if url.isFileURL {
            data = try Data(contentsOf: url, options: .mappedIfSafe)
            response = URLResponse(url: url, mimeType: url.pathExtension.lowercased() == "svg" ? "image/svg+xml" : "image/webp", expectedContentLength: data.count, textEncodingName: nil)
        } else {
            guard NetworkMonitor.shared.isConnected else { throw URLError(.notConnectedToInternet) }
            (data, response) = try await URLSession.shared.data(from: url)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw URLError(.badServerResponse) }
        }
        try Task.checkCancellation()
        guard let decoded = await RemoteImageDecoder.decode(data: data, response: response, url: url) else { throw URLError(.cannotDecodeContentData) }
        try Task.checkCancellation()
        return decoded
    }

    func seed(with url: URL, image: UIImage) {
        request?.cancel()
        requestID = UUID()
        currentURL = url
        phase = .success(Image(uiImage: image))
    }
}

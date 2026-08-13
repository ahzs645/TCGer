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
private final class CachedImageLoader: ObservableObject {
    @Published private(set) var phase: AsyncImagePhase = .empty

    private var currentURL: URL?
    private var isLoading = false
    private let cache: ImageCache

    @MainActor
    init(cache: ImageCache) {
        self.cache = cache
    }

    @MainActor
    convenience init() {
        self.init(cache: ImageCache.shared)
    }

    func load(for url: URL?) async {
        if currentURL != url {
            currentURL = url
            phase = .empty
        }

        guard let url else {
            phase = .empty
            return
        }

        if case .success = phase {
            return
        }

        if let cachedImage = cache.image(for: url) {
            phase = .success(Image(uiImage: cachedImage))
            return
        }

        if url.isFileURL {
            do {
                let data = try Data(contentsOf: url, options: .mappedIfSafe)
                let response = URLResponse(
                    url: url,
                    mimeType: url.pathExtension.lowercased() == "svg"
                        ? "image/svg+xml"
                        : "image/webp",
                    expectedContentLength: data.count,
                    textEncodingName: nil
                )
                guard let decoded = await RemoteImageDecoder.decode(
                    data: data,
                    response: response,
                    url: url
                ) else {
                    throw URLError(.cannotDecodeContentData)
                }
                cache.store(decoded.image, data: decoded.cacheData, for: url)
                phase = .success(Image(uiImage: decoded.image))
            } catch {
                phase = .failure(error)
            }
            return
        }

        guard NetworkMonitor.shared.isConnected else {
            return
        }

        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            let (data, response) = try await URLSession.shared.data(from: url)
            guard let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }

            guard let decoded = await RemoteImageDecoder.decode(
                data: data,
                response: httpResponse,
                url: url
            ) else {
                throw URLError(.cannotDecodeContentData)
            }

            cache.store(decoded.image, data: decoded.cacheData, for: url)
            phase = .success(Image(uiImage: decoded.image))
        } catch {
            phase = .failure(error)
        }
    }

    func seed(with url: URL, image: UIImage) {
        currentURL = url
        phase = .success(Image(uiImage: image))
    }
}

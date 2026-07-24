import SwiftUI
import UIKit
import Combine

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

            guard let uiImage = UIImage(data: data) else {
                throw URLError(.cannotDecodeContentData)
            }

            cache.store(uiImage, data: data, for: url)
            phase = .success(Image(uiImage: uiImage))
        } catch {
            phase = .failure(error)
        }
    }

    func seed(with url: URL, image: UIImage) {
        currentURL = url
        phase = .success(Image(uiImage: image))
    }
}

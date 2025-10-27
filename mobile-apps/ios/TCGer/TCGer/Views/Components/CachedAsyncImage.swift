import SwiftUI
import UIKit
import Combine

struct CachedAsyncImage<Content: View>: View {
    private let url: URL?
    private let content: (AsyncImagePhase) -> Content

    @StateObject private var loader: CachedImageLoader

    init(url: URL?, @ViewBuilder content: @escaping (AsyncImagePhase) -> Content) {
        self.url = url
        self.content = content

        let loader = CachedImageLoader()
        if let url,
           let cachedImage = ImageCache.shared.image(for: url) {
            loader.seed(with: url, image: cachedImage)
        }
        _loader = StateObject(wrappedValue: loader)
    }

    var body: some View {
        content(loader.phase)
            .task(id: url) {
                await loader.load(for: url)
            }
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

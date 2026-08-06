import Combine
import SwiftUI

/// Shared wishlist state that survives transient navigation destinations such
/// as screens pushed from the app's More tab.
@MainActor
final class WishlistStore: ObservableObject {
    typealias Loader = @MainActor (ServerConfiguration, String) async throws -> [Wishlist]

    @Published private(set) var wishlists: [Wishlist] = []
    @Published private(set) var isLoading = false
    @Published private(set) var hasLoaded = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var revision = 0

    private struct Source: Equatable {
        let baseURL: String
        let token: String
    }

    private let loader: Loader
    private let refreshInterval: TimeInterval
    private var source: Source?
    private var lastLoadedAt: Date?
    private var activeLoad: Task<[Wishlist], Error>?

    init(
        refreshInterval: TimeInterval = 30,
        loader: @escaping Loader = { config, token in
            try await APIService().getWishlists(config: config, token: token)
        }
    ) {
        self.refreshInterval = refreshInterval
        self.loader = loader
    }

    func load(
        config: ServerConfiguration,
        token: String,
        force: Bool = false
    ) async {
        let requestedSource = Source(baseURL: config.baseURL, token: token)
        prepare(for: requestedSource)

        if !force, isFresh {
            return
        }

        if let activeLoad {
            // The request that created this task owns applying its result.
            // Other callers only wait for it so one response cannot publish
            // twice when multiple view tasks arrive together.
            _ = try? await activeLoad.value
            return
        }

        isLoading = true
        errorMessage = nil

        let task = Task { [loader] in
            try await loader(config, token)
        }
        activeLoad = task
        await apply(task, for: requestedSource)
    }

    func insert(_ wishlist: Wishlist) {
        wishlists.removeAll { $0.id == wishlist.id }
        wishlists.insert(wishlist, at: 0)
        hasLoaded = true
        lastLoadedAt = Date()
        errorMessage = nil
        revision &+= 1
    }

    func remove(id: String) {
        wishlists.removeAll { $0.id == id }
        hasLoaded = true
        lastLoadedAt = Date()
        errorMessage = nil
        revision &+= 1
    }

    private var isFresh: Bool {
        guard hasLoaded, let lastLoadedAt else { return false }
        return Date().timeIntervalSince(lastLoadedAt) < refreshInterval
    }

    private func prepare(for requestedSource: Source) {
        guard source != requestedSource else { return }
        activeLoad?.cancel()
        activeLoad = nil
        source = requestedSource
        wishlists = []
        isLoading = false
        hasLoaded = false
        errorMessage = nil
        lastLoadedAt = nil
    }

    private func apply(
        _ task: Task<[Wishlist], Error>,
        for requestedSource: Source
    ) async {
        do {
            let loadedWishlists = try await task.value
            guard source == requestedSource else { return }
            wishlists = loadedWishlists
            hasLoaded = true
            lastLoadedAt = Date()
            errorMessage = nil
            revision &+= 1
        } catch is CancellationError {
            // Source changes and view lifecycle cancellation are expected.
        } catch {
            guard source == requestedSource else { return }
            errorMessage = error.localizedDescription
        }

        guard source == requestedSource else { return }
        activeLoad = nil
        isLoading = false
    }
}

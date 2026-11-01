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
    private let repository: (any WishlistRepository)?
    private let refreshInterval: TimeInterval
    private var source: Source?
    private var lastLoadedAt: Date?
    private var activeLoad: Task<[Wishlist], Error>?
    private var generation = UUID()
    private var contentRevision = 0

    struct MutationScope {
        fileprivate let baseURL: String
        fileprivate let token: String
        fileprivate let generation: UUID
    }

    func mutationScope(config: ServerConfiguration, token: String) -> MutationScope {
        prepare(for: Source(baseURL: config.baseURL, token: token))
        return MutationScope(baseURL: config.baseURL, token: token, generation: generation)
    }

    func publish(_ wishlist: Wishlist, for scope: MutationScope) throws {
        guard source == Source(baseURL: scope.baseURL, token: scope.token), generation == scope.generation, !Task.isCancelled else { throw CancellationError() }
        insert(wishlist)
    }

    init(
        refreshInterval: TimeInterval = 30,
        repository: any WishlistRepository
    ) {
        self.refreshInterval = refreshInterval
        self.repository = repository
        self.loader = { config, token in
            try await repository.wishlists(config: config, token: token)
        }
    }

    /// Loader-only initializer retained for focused cache/coalescing tests.
    /// Mutation methods require the repository-backed initializer.
    init(
        refreshInterval: TimeInterval = 30,
        loader: @escaping Loader
    ) {
        self.refreshInterval = refreshInterval
        self.repository = nil
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
        await apply(task, for: requestedSource, generation: generation, contentRevision: contentRevision)
    }

    private func insert(_ wishlist: Wishlist) {
        contentRevision &+= 1
        wishlists.removeAll { $0.id == wishlist.id }
        wishlists.insert(wishlist, at: 0)
        hasLoaded = true
        lastLoadedAt = Date()
        errorMessage = nil
        revision &+= 1
    }

    private func remove(id: String) {
        contentRevision &+= 1
        wishlists.removeAll { $0.id == id }
        hasLoaded = true
        lastLoadedAt = Date()
        errorMessage = nil
        revision &+= 1
    }

    @discardableResult
    func create(
        config: ServerConfiguration,
        token: String,
        input: CreateWishlistInput
    ) async throws -> Wishlist {
        guard let repository else {
            throw RepositoryConfigurationError.mutationsUnavailable
        }
        let requestedSource = Source(baseURL: config.baseURL, token: token)
        prepare(for: requestedSource)
        let requestedGeneration = generation
        let wishlist = try await repository.createWishlist(
            config: config,
            token: token,
            input: input
        )
        guard source == requestedSource, generation == requestedGeneration, !Task.isCancelled else {
            throw CancellationError()
        }
        insert(wishlist)
        return wishlist
    }

    func delete(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws {
        guard let repository else {
            throw RepositoryConfigurationError.mutationsUnavailable
        }
        let requestedSource = Source(baseURL: config.baseURL, token: token)
        prepare(for: requestedSource)
        let requestedGeneration = generation
        try await repository.deleteWishlist(config: config, token: token, id: id)
        guard source == requestedSource, generation == requestedGeneration, !Task.isCancelled else {
            throw CancellationError()
        }
        remove(id: id)
    }

    private var isFresh: Bool {
        guard hasLoaded, let lastLoadedAt else { return false }
        return Date().timeIntervalSince(lastLoadedAt) < refreshInterval
    }

    func matches(config: ServerConfiguration, token: String?) -> Bool {
        guard let token else { return false }
        return source == Source(baseURL: config.baseURL, token: token)
    }

    func reset() {
        generation = UUID()
        activeLoad?.cancel()
        activeLoad = nil
        source = nil
        wishlists = []
        hasLoaded = false
        isLoading = false
        errorMessage = nil
        lastLoadedAt = nil
    }

    private func prepare(for requestedSource: Source) {
        guard source != requestedSource else { return }
        generation = UUID()
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
        for requestedSource: Source,
        generation requestedGeneration: UUID,
        contentRevision requestedRevision: Int
    ) async {
        defer {
            if source == requestedSource, generation == requestedGeneration {
                activeLoad = nil
                isLoading = false
            }
        }
        do {
            let loadedWishlists = try await task.value
            guard source == requestedSource, generation == requestedGeneration, contentRevision == requestedRevision, !Task.isCancelled else { return }
            wishlists = loadedWishlists
            hasLoaded = true
            lastLoadedAt = Date()
            errorMessage = nil
            revision &+= 1
        } catch is CancellationError {
            // Source changes and view lifecycle cancellation are expected.
        } catch {
            guard source == requestedSource, generation == requestedGeneration, contentRevision == requestedRevision, !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }

    }
}

private enum RepositoryConfigurationError: LocalizedError {
    case mutationsUnavailable

    var errorDescription: String? {
        "This wishlist store was configured for read-only loading."
    }
}

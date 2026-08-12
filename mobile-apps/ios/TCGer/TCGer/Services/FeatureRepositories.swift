import Combine
import Foundation

struct CreateCollectionInput: Equatable {
    let name: String
    let description: String?
    let colorHex: String?
    let defaultCondition: String?
    let containerType: String?
    let imageUrl: String?
    let associatedTcg: String?
    let associatedSetCode: String?
    let associatedSetName: String?
}

struct CreateWishlistInput: Equatable {
    let name: String
    let description: String?
    let colorHex: String?
    let matchAnyPrinting: Bool
}

/// The collection-list boundary. Detail and scanner operations intentionally
/// stay outside this first seam so adopting dependency injection does not
/// destabilize their larger editing workflows.
@MainActor
protocol CollectionRepository: AnyObject {
    func collections(
        config: ServerConfiguration,
        token: String?,
        useCache: Bool
    ) async throws -> [Collection]

    func createCollection(
        config: ServerConfiguration,
        token: String,
        input: CreateCollectionInput
    ) async throws -> Collection
}

@MainActor
protocol WishlistRepository: AnyObject {
    func wishlists(
        config: ServerConfiguration,
        token: String
    ) async throws -> [Wishlist]

    func createWishlist(
        config: ServerConfiguration,
        token: String,
        input: CreateWishlistInput
    ) async throws -> Wishlist

    func deleteWishlist(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws
}

@MainActor
final class APICollectionRepository: CollectionRepository {
    private let apiService: APIService

    init(apiService: APIService) {
        self.apiService = apiService
    }

    func collections(
        config: ServerConfiguration,
        token: String?,
        useCache: Bool
    ) async throws -> [Collection] {
        try await apiService.getCollections(
            config: config,
            token: token,
            useCache: useCache
        )
    }

    func createCollection(
        config: ServerConfiguration,
        token: String,
        input: CreateCollectionInput
    ) async throws -> Collection {
        try await apiService.createCollection(
            config: config,
            token: token,
            name: input.name,
            description: input.description,
            colorHex: input.colorHex,
            defaultCondition: input.defaultCondition,
            containerType: input.containerType,
            imageUrl: input.imageUrl,
            associatedTcg: input.associatedTcg,
            associatedSetCode: input.associatedSetCode,
            associatedSetName: input.associatedSetName
        )
    }
}

@MainActor
final class APIWishlistRepository: WishlistRepository {
    private let apiService: APIService

    init(apiService: APIService) {
        self.apiService = apiService
    }

    func wishlists(
        config: ServerConfiguration,
        token: String
    ) async throws -> [Wishlist] {
        try await apiService.getWishlists(config: config, token: token)
    }

    func createWishlist(
        config: ServerConfiguration,
        token: String,
        input: CreateWishlistInput
    ) async throws -> Wishlist {
        try await apiService.createWishlist(
            config: config,
            token: token,
            name: input.name,
            description: input.description,
            colorHex: input.colorHex,
            matchAnyPrinting: input.matchAnyPrinting
        )
    }

    func deleteWishlist(
        config: ServerConfiguration,
        token: String,
        id: String
    ) async throws {
        try await apiService.deleteWishlist(config: config, token: token, id: id)
    }
}

/// Immutable feature services installed once by `TCGerApp` and shared by the
/// app shell. Tests can substitute either repository independently.
@MainActor
final class AppFeatureDependencies: ObservableObject {
    let collections: any CollectionRepository
    let wishlists: any WishlistRepository

    init(
        collections: any CollectionRepository,
        wishlists: any WishlistRepository
    ) {
        self.collections = collections
        self.wishlists = wishlists
    }
}

@MainActor
final class CollectionListStore: ObservableObject {
    @Published private(set) var collections: [Collection] = []
    @Published private(set) var isLoading = true
    @Published private(set) var hasLoaded = false
    @Published private(set) var errorMessage: String?

    private let repository: any CollectionRepository

    init(repository: any CollectionRepository) {
        self.repository = repository
    }

    func load(
        config: ServerConfiguration,
        token: String?,
        useCache: Bool
    ) async {
        let shouldShowLoading = collections.isEmpty
        if shouldShowLoading {
            isLoading = true
            errorMessage = nil
        }

        do {
            collections = try await repository.collections(
                config: config,
                token: token,
                useCache: useCache
            )
            hasLoaded = true
            isLoading = false
            errorMessage = nil
        } catch {
            if let apiError = error as? APIService.APIError,
               case .unauthorized = apiError {
                errorMessage = "Sign in is required to view collections."
            } else if shouldShowLoading {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }

    @discardableResult
    func create(
        config: ServerConfiguration,
        token: String,
        input: CreateCollectionInput
    ) async throws -> Collection {
        do {
            let collection = try await repository.createCollection(
                config: config,
                token: token,
                input: input
            )
            collections.append(collection)
            errorMessage = nil
            return collection
        } catch {
            errorMessage = error.localizedDescription
            throw error
        }
    }

    func reportAuthenticationRequired() {
        errorMessage = "Not authenticated"
    }
}

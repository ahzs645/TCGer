import Foundation
import Observation

/// Shared state and request lifecycle for the app's lightweight catalog pickers.
///
/// Full catalog browsing remains in `CardSearchView`; this model keeps the
/// smaller "find one card" flows consistent without coupling their layouts or
/// follow-up actions.
@MainActor
@Observable
final class CatalogCardSearchModel {
    var query = ""

    private(set) var results: [Card] = []
    private(set) var isSearching = false
    private(set) var errorMessage: String?
    private(set) var hasSearched = false

    private var activeRequestID: UUID?
    private let apiService: APIService

    init() {
        apiService = APIService()
    }

    init(apiService: APIService) {
        self.apiService = apiService
    }

    var normalizedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func search(
        config: ServerConfiguration,
        authToken: String?,
        game: TCGGame
    ) async {
        let submittedQuery = normalizedQuery
        guard !submittedQuery.isEmpty else {
            reset()
            return
        }

        guard let token = authenticationToken(config: config, authToken: authToken) else {
            activeRequestID = nil
            isSearching = false
            errorMessage = "Not authenticated"
            return
        }

        let requestID = UUID()
        activeRequestID = requestID
        isSearching = true
        errorMessage = nil
        hasSearched = true

        do {
            let response = try await apiService.searchCards(
                config: config,
                token: token,
                query: submittedQuery,
                game: game
            )
            guard activeRequestID == requestID else { return }
            results = SearchTextNormalizer.rankedByName(
                response.cards,
                query: submittedQuery,
                name: \.name
            )
            isSearching = false
        } catch {
            guard activeRequestID == requestID else { return }
            errorMessage = error.localizedDescription
            isSearching = false
        }
    }

    /// Clears stale results when the user deletes the submitted query.
    func resetIfQueryIsEmpty() {
        guard normalizedQuery.isEmpty else { return }
        reset()
    }

    func clearError() {
        errorMessage = nil
    }

    private func reset() {
        activeRequestID = nil
        results = []
        isSearching = false
        errorMessage = nil
        hasSearched = false
    }

    private func authenticationToken(
        config: ServerConfiguration,
        authToken: String?
    ) -> String? {
        if config.isOnDevice {
            return authToken ?? ""
        }
        return authToken
    }
}

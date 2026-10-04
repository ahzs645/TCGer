import Combine
import Foundation

/// Caches only successful health responses. Failure leaves the same server's
/// last known capabilities intact and permits the next recovery request.
@MainActor
final class ServerFeatureRefreshStore: ObservableObject {
    typealias Loader = @MainActor (ServerConfiguration) async throws -> ServerFeatures

    @Published private(set) var errorMessage: String?
    private let loader: Loader
    private var sourceURL: String?
    private var successfulFeatures: ServerFeatures?
    private var activeRequest: (id: UUID, task: Task<ServerFeatures, Error>)?

    init(loader: @escaping Loader = { configuration in
        try await APIService().getServerFeatures(config: configuration)
    }) {
        self.loader = loader
    }

    func reset() {
        activeRequest?.task.cancel()
        activeRequest = nil
        sourceURL = nil
        successfulFeatures = nil
        errorMessage = nil
    }

    func refresh(config: ServerConfiguration, force: Bool = false) async -> ServerFeatures? {
        if sourceURL != config.baseURL {
            reset()
            sourceURL = config.baseURL
        }
        if let activeRequest {
            // The creating caller owns publication. Others wait rather than
            // issuing another request or applying the same response twice.
            _ = try? await activeRequest.task.value
            return nil
        }
        if !force, let successfulFeatures { return successfulFeatures }

        let requestID = UUID()
        let task = Task { [loader] in try await loader(config) }
        activeRequest = (requestID, task)
        do {
            let features = try await task.value
            guard sourceURL == config.baseURL, activeRequest?.id == requestID else { return nil }
            activeRequest = nil
            successfulFeatures = features
            errorMessage = nil
            return features
        } catch {
            guard sourceURL == config.baseURL, activeRequest?.id == requestID else { return nil }
            activeRequest = nil
            if error is CancellationError || (error as? URLError)?.code == .cancelled {
                return nil
            }
            errorMessage = "Server capabilities could not be refreshed. \(error.localizedDescription)"
            return nil
        }
    }
}

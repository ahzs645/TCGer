import Foundation

/// Serializes ownership of search results, even when a provider ignores cancellation.
@MainActor
final class LatestSearchRequest {
    private var generation = 0
    private var task: Task<Void, Never>?

    func cancel() {
        generation += 1
        task?.cancel()
        task = nil
    }

    func run<Value>(
        operation: @escaping @MainActor () async throws -> Value,
        completion: @escaping @MainActor (Result<Value, Error>) -> Void
    ) {
        cancel()
        let request = generation
        task = Task {
            let result: Result<Value, Error>
            do {
                result = .success(try await operation())
            } catch {
                result = .failure(error)
            }
            guard request == generation, !Task.isCancelled else { return }
            task = nil
            completion(result)
        }
    }
}

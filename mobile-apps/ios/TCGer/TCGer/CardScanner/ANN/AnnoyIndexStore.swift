import Foundation

actor AnnoyIndexStore: ANNIndexProviding {
    enum StoreError: Error {
        case indexUnavailable
    }

    private let resourceName: String
    private let fileExtension: String
    private var vectors: [[Float]] = []
    private var isLoaded = false

    init(resourceName: String = "CardsIndexVectors", fileExtension: String = "json") {
        self.resourceName = resourceName
        self.fileExtension = fileExtension
    }

    func nearestNeighbors(for vector: [Float], limit: Int) async throws -> [ANNVectorMatch] {
        try await loadIfNeeded()
        guard !vectors.isEmpty else { return [] }

        let matches = vectors.enumerated().map { index, candidate -> ANNVectorMatch in
            let distance = cosineDistance(lhs: vector, rhs: candidate)
            return ANNVectorMatch(index: index, distance: distance)
        }
        .sorted { $0.distance < $1.distance }

        return Array(matches.prefix(limit))
    }

    private func loadIfNeeded(bundle: Bundle = .main) async throws {
        guard !isLoaded else { return }
        defer { isLoaded = true }
        guard let url = bundle.url(forResource: resourceName, withExtension: fileExtension) else {
            throw StoreError.indexUnavailable
        }
        let data = try Data(contentsOf: url)
        let decoded = try JSONDecoder().decode([[Float]].self, from: data)
        vectors = decoded
    }

    private func cosineDistance(lhs: [Float], rhs: [Float]) -> Double {
        guard lhs.count == rhs.count else { return .infinity }
        var dot: Double = 0
        var lhsNorm: Double = 0
        var rhsNorm: Double = 0
        for idx in 0..<lhs.count {
            let l = Double(lhs[idx])
            let r = Double(rhs[idx])
            dot += l * r
            lhsNorm += l * l
            rhsNorm += r * r
        }
        let denominator = (lhsNorm.squareRoot() * rhsNorm.squareRoot())
        guard denominator > 0 else { return .infinity }
        let cosine = dot / denominator
        return 1 - min(max(cosine, -1), 1)
    }
}

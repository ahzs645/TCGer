import Foundation

actor AnnoyIndexStore: ANNIndexProviding {
    enum StoreError: Error {
        case indexUnavailable
    }

    private let resourceName: String
    private let fileExtension: String
    private let bundle: Bundle
    private var vectors: [[Float]] = []
    private var isLoaded = false
    nonisolated let isAvailable: Bool

    init(
        resourceName: String = "CardsIndexVectors",
        fileExtension: String = "bin",
        bundle: Bundle = .main
    ) {
        self.resourceName = resourceName
        self.fileExtension = fileExtension
        self.bundle = bundle
        isAvailable = Self.hasValidHeader(
            bundle: bundle,
            resourceName: resourceName,
            fileExtension: fileExtension
        )
    }

    func nearestNeighbors(
        for vector: [Float],
        limit: Int,
        allowedIndices: Set<Int>
    ) async throws -> [ANNVectorMatch] {
        try await loadIfNeeded()
        guard !vectors.isEmpty, !allowedIndices.isEmpty else { return [] }

        let matches = vectors.enumerated().compactMap { index, candidate -> ANNVectorMatch? in
            guard allowedIndices.contains(index) else { return nil }
            let distance = cosineDistance(lhs: vector, rhs: candidate)
            return ANNVectorMatch(index: index, distance: distance)
        }
        .sorted { $0.distance < $1.distance }

        return Array(matches.prefix(limit))
    }

    /// Loads the packed int8 index: header [Int32 count, Int32 dim] (little-endian)
    /// followed by `count * dim` Int8 values, dequantised by `scale` (127). This
    /// replaces the impractical ~80 MB `[[Float]]` JSON with an ~8 MB binary that
    /// matches the web index exactly.
    private func loadIfNeeded() async throws {
        guard !isLoaded else { return }
        defer { isLoaded = true }
        guard let url = bundle.url(forResource: resourceName, withExtension: fileExtension) else {
            throw StoreError.indexUnavailable
        }
        let data = try Data(contentsOf: url)
        guard data.count >= 8 else { throw StoreError.indexUnavailable }

        let count = Int(data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: Int32.self).littleEndian })
        let dim = Int(data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: Int32.self).littleEndian })
        guard count > 0, dim > 0, data.count >= 8 + count * dim else {
            throw StoreError.indexUnavailable
        }

        let scale: Float = 127
        var loaded = [[Float]]()
        loaded.reserveCapacity(count)
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            let base = raw.baseAddress!.advanced(by: 8).assumingMemoryBound(to: Int8.self)
            for i in 0..<count {
                let offset = i * dim
                var row = [Float](repeating: 0, count: dim)
                for k in 0..<dim {
                    row[k] = Float(base[offset + k]) / scale
                }
                loaded.append(row)
            }
        }
        vectors = loaded
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

    private nonisolated static func hasValidHeader(
        bundle: Bundle,
        resourceName: String,
        fileExtension: String
    ) -> Bool {
        guard let url = bundle.url(forResource: resourceName, withExtension: fileExtension),
              let data = try? Data(contentsOf: url, options: .mappedIfSafe),
              data.count >= 8
        else {
            return false
        }
        let count = Int(data.withUnsafeBytes {
            $0.loadUnaligned(fromByteOffset: 0, as: Int32.self).littleEndian
        })
        let dimension = Int(data.withUnsafeBytes {
            $0.loadUnaligned(fromByteOffset: 4, as: Int32.self).littleEndian
        })
        return count > 0 && dimension > 0 && data.count >= 8 + count * dimension
    }
}

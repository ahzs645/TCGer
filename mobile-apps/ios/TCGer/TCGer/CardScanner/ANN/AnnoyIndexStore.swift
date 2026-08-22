import Accelerate
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

    /// Vectorized-path representation, built lazily from `vectors` on first
    /// use so the legacy scalar path pays nothing for it. Row-major
    /// `flatVectors[count * dimension]`; `rowNorms[i] < 0` marks a row whose
    /// length differs from `dimension` (the scalar path treats those as
    /// infinite distance, and so does this one).
    private var flatVectors: [Float] = []
    private var rowNorms: [Float] = []
    private var flatDimension = 0

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

    /// In-memory initializer for deterministic tests and replay tooling. It
    /// exercises the same cosine ranking path without requiring a bundled
    /// binary index fixture.
    init(vectors: [[Float]]) {
        resourceName = ""
        fileExtension = ""
        bundle = .main
        self.vectors = vectors
        isLoaded = true
        isAvailable = !vectors.isEmpty
    }

    func nearestNeighbors(
        for vector: [Float],
        limit: Int,
        allowedIndices: Set<Int>
    ) async throws -> [ANNVectorMatch] {
        try await loadIfNeeded()
        guard !vectors.isEmpty, !allowedIndices.isEmpty else { return [] }

        if ScannerPerfOptions.isVectorizedANNEnabled {
            return vectorizedNearestNeighbors(
                for: vector,
                limit: limit,
                allowedIndices: allowedIndices
            )
        }

        let matches = vectors.enumerated().compactMap { index, candidate -> ANNVectorMatch? in
            guard allowedIndices.contains(index) else { return nil }
            let distance = cosineDistance(lhs: vector, rhs: candidate)
            return ANNVectorMatch(index: index, distance: distance)
        }
        .sorted { $0.distance < $1.distance }

        return Array(matches.prefix(limit))
    }

    /// One vDSP matrix-vector product computes every row's dot product with
    /// the query, ranking the candidates in Float precision; the surviving
    /// shortlist then has its distances recomputed with the scalar path's
    /// exact Double cosine so every returned distance is bit-identical to the
    /// legacy path — Float drift at an acceptance-threshold boundary must not
    /// flip a downstream policy decision. Edge behavior also matches:
    /// dimension mismatches and zero-norm rows rank at infinite distance
    /// rather than being dropped.
    private func vectorizedNearestNeighbors(
        for vector: [Float],
        limit: Int,
        allowedIndices: Set<Int>
    ) -> [ANNVectorMatch] {
        buildFlatRepresentationIfNeeded()
        let count = rowNorms.count
        let dimension = flatDimension
        guard count > 0, dimension > 0 else { return [] }

        var dots = [Float](repeating: 0, count: count)
        var queryNorm: Float = 0
        if vector.count == dimension {
            flatVectors.withUnsafeBufferPointer { rows in
                vector.withUnsafeBufferPointer { query in
                    vDSP_mmul(
                        rows.baseAddress!, 1,
                        query.baseAddress!, 1,
                        &dots, 1,
                        vDSP_Length(count), 1, vDSP_Length(dimension)
                    )
                }
            }
            var sumOfSquares: Float = 0
            vDSP_svesq(vector, 1, &sumOfSquares, vDSP_Length(dimension))
            queryNorm = sumOfSquares.squareRoot()
        }

        let approximate = allowedIndices.compactMap { index -> ANNVectorMatch? in
            guard index >= 0, index < count else { return nil }
            let rowNorm = rowNorms[index]
            let denominator = Double(rowNorm) * Double(queryNorm)
            guard vector.count == dimension, rowNorm >= 0, denominator > 0 else {
                return ANNVectorMatch(index: index, distance: .infinity)
            }
            let cosine = Double(dots[index]) / denominator
            return ANNVectorMatch(index: index, distance: 1 - min(max(cosine, -1), 1))
        }
        .sorted { $0.distance < $1.distance }

        // Exact re-rank: a small buffer past `limit` absorbs any Float-level
        // ordering jitter near the cut, then the scalar Double distances make
        // the final ranking and values.
        let shortlist = approximate.prefix(limit + 8).map { match in
            ANNVectorMatch(
                index: match.index,
                distance: cosineDistance(lhs: vector, rhs: vectors[match.index])
            )
        }
        .sorted { $0.distance < $1.distance }

        return Array(shortlist.prefix(limit))
    }

    private func buildFlatRepresentationIfNeeded() {
        guard rowNorms.isEmpty, let first = vectors.first else { return }
        let dimension = first.count
        flatDimension = dimension
        flatVectors = [Float](repeating: 0, count: vectors.count * dimension)
        rowNorms = [Float](repeating: -1, count: vectors.count)
        guard dimension > 0 else { return }
        flatVectors.withUnsafeMutableBufferPointer { flat in
            for (index, row) in vectors.enumerated() {
                guard row.count == dimension else { continue }
                row.withUnsafeBufferPointer { source in
                    flat.baseAddress!.advanced(by: index * dimension)
                        .update(from: source.baseAddress!, count: dimension)
                }
                var sumOfSquares: Float = 0
                vDSP_svesq(row, 1, &sumOfSquares, vDSP_Length(dimension))
                rowNorms[index] = sumOfSquares.squareRoot()
            }
        }
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
              let fileSize = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
              let handle = try? FileHandle(forReadingFrom: url)
        else {
            return false
        }
        defer { try? handle.close() }
        guard let data = try? handle.read(upToCount: 8), data.count == 8 else {
            return false
        }
        let count = Int(data.withUnsafeBytes {
            $0.loadUnaligned(fromByteOffset: 0, as: Int32.self).littleEndian
        })
        let dimension = Int(data.withUnsafeBytes {
            $0.loadUnaligned(fromByteOffset: 4, as: Int32.self).littleEndian
        })
        return count > 0 && dimension > 0 && fileSize >= 8 + count * dimension
    }
}

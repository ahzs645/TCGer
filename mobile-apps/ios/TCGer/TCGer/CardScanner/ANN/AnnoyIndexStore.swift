import Accelerate
import Foundation

actor AnnoyIndexStore: ANNIndexProviding {
    enum StoreError: Error {
        case indexUnavailable
    }

    private let resourceName: String
    private let fileExtension: String
    private let bundle: Bundle
    private let fileURL: URL?
    private var vectors: [[Float]] = []
    private var packedVectorData: Data?
    private var packedRowNorms: [Float] = []
    private var packedCount = 0
    private var packedDimension = 0
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
        fileURL = nil
        isAvailable = Self.hasValidHeader(
            bundle: bundle,
            resourceName: resourceName,
            fileExtension: fileExtension
        )
    }

    init(fileURL: URL, fileManager: FileManager = .default) {
        resourceName = ""
        fileExtension = ""
        bundle = .main
        self.fileURL = fileURL
        isAvailable = fileManager.fileExists(atPath: fileURL.path)
            && Self.hasValidHeader(at: fileURL)
    }

    /// In-memory initializer for deterministic tests and replay tooling. It
    /// exercises the same cosine ranking path without requiring a bundled
    /// binary index fixture.
    init(vectors: [[Float]]) {
        resourceName = ""
        fileExtension = ""
        bundle = .main
        fileURL = nil
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
        guard !allowedIndices.isEmpty else { return [] }

        if let packedVectorData {
            return packedNearestNeighbors(
                for: vector,
                limit: limit,
                allowedIndices: allowedIndices,
                data: packedVectorData
            )
        }

        guard !vectors.isEmpty else { return [] }

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

    /// Searches a file-backed Int8 index without expanding it into two
    /// `count * dimension` Float buffers. That expansion is tolerable for the
    /// small historical fixture, but Magic's 111k-row index consumed more
    /// than 340 MB before metadata, camera frames, and Core ML were counted.
    ///
    /// The Int8 quantization scale cancels during the approximate cosine pass.
    /// Only the small surviving shortlist is dequantized for the exact Double
    /// rerank used by the legacy implementation.
    private func packedNearestNeighbors(
        for vector: [Float],
        limit: Int,
        allowedIndices: Set<Int>,
        data: Data
    ) -> [ANNVectorMatch] {
        guard limit > 0, packedCount > 0, packedDimension > 0 else { return [] }
        let validIndices = allowedIndices.filter { $0 >= 0 && $0 < packedCount }
        guard !validIndices.isEmpty else { return [] }

        guard vector.count == packedDimension else {
            return validIndices.sorted().prefix(limit).map {
                ANNVectorMatch(index: $0, distance: .infinity)
            }
        }

        var querySumOfSquares: Float = 0
        vDSP_svesq(vector, 1, &querySumOfSquares, vDSP_Length(vector.count))
        let queryNorm = querySumOfSquares.squareRoot()
        guard queryNorm > 0 else {
            return validIndices.sorted().prefix(limit).map {
                ANNVectorMatch(index: $0, distance: .infinity)
            }
        }

        let shortlistLimit = min(limit + 8, validIndices.count)
        var shortlist: [ANNVectorMatch] = []
        shortlist.reserveCapacity(shortlistLimit + 1)

        data.withUnsafeBytes { raw in
            let base = raw.baseAddress!.advanced(by: 8).assumingMemoryBound(to: Int8.self)
            for index in validIndices {
                let rowNorm = packedRowNorms[index]
                guard rowNorm > 0 else { continue }
                let offset = index * packedDimension
                var dot: Float = 0
                for component in 0..<packedDimension {
                    dot += vector[component] * Float(base[offset + component])
                }
                let cosine = Double(dot / (queryNorm * rowNorm))
                let match = ANNVectorMatch(
                    index: index,
                    distance: 1 - min(max(cosine, -1), 1)
                )
                if shortlist.count == shortlistLimit,
                   let last = shortlist.last,
                   !Self.ranksBefore(match, last) {
                    continue
                }
                shortlist.append(match)
                shortlist.sort(by: Self.ranksBefore)
                if shortlist.count > shortlistLimit {
                    shortlist.removeLast()
                }
            }
        }

        let exact = data.withUnsafeBytes { raw -> [ANNVectorMatch] in
            let base = raw.baseAddress!.advanced(by: 8).assumingMemoryBound(to: Int8.self)
            return shortlist.map { match in
                let offset = match.index * packedDimension
                var dot: Double = 0
                var lhsNorm: Double = 0
                var rhsNorm: Double = 0
                for component in 0..<packedDimension {
                    let lhs = Double(vector[component])
                    let rhs = Double(Float(base[offset + component]) / 127)
                    dot += lhs * rhs
                    lhsNorm += lhs * lhs
                    rhsNorm += rhs * rhs
                }
                let denominator = lhsNorm.squareRoot() * rhsNorm.squareRoot()
                let distance: Double
                if denominator > 0 {
                    let cosine = dot / denominator
                    distance = 1 - min(max(cosine, -1), 1)
                } else {
                    distance = .infinity
                }
                return ANNVectorMatch(index: match.index, distance: distance)
            }
        }
        return Array(exact.sorted(by: Self.ranksBefore).prefix(limit))
    }

    private nonisolated static func ranksBefore(
        _ lhs: ANNVectorMatch,
        _ rhs: ANNVectorMatch
    ) -> Bool {
        lhs.distance == rhs.distance
            ? lhs.index < rhs.index
            : lhs.distance < rhs.distance
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

    /// Loads the packed Int8 index: header [Int32 count, Int32 dim]
    /// (little-endian), followed by `count * dim` values. File-backed indices
    /// remain packed and memory-mapped; only their small row-norm table is
    /// materialized. In-memory test vectors continue to use the Float path.
    private func loadIfNeeded() async throws {
        guard !isLoaded else { return }
        defer { isLoaded = true }
        guard let url = fileURL
                ?? bundle.url(forResource: resourceName, withExtension: fileExtension) else {
            throw StoreError.indexUnavailable
        }
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard data.count >= 8 else { throw StoreError.indexUnavailable }

        let count = Int(data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 0, as: Int32.self).littleEndian })
        let dim = Int(data.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: 4, as: Int32.self).littleEndian })
        guard count > 0, dim > 0, data.count == 8 + count * dim else {
            throw StoreError.indexUnavailable
        }

        var norms = [Float](repeating: 0, count: count)
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            let base = raw.baseAddress!.advanced(by: 8).assumingMemoryBound(to: Int8.self)
            for index in 0..<count {
                let offset = index * dim
                var sumOfSquares: Float = 0
                for component in 0..<dim {
                    let value = Float(base[offset + component])
                    sumOfSquares += value * value
                }
                norms[index] = sumOfSquares.squareRoot()
            }
        }
        packedCount = count
        packedDimension = dim
        packedRowNorms = norms
        packedVectorData = data
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
        guard let url = bundle.url(forResource: resourceName, withExtension: fileExtension) else {
            return false
        }
        return hasValidHeader(at: url)
    }

    private nonisolated static func hasValidHeader(at url: URL) -> Bool {
        guard let fileSize = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize,
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
        return count > 0 && dimension > 0 && fileSize == 8 + count * dimension
    }
}

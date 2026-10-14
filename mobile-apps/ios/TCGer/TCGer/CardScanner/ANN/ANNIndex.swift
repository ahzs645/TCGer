import CoreGraphics
import Foundation

nonisolated struct ANNVectorMatch: Hashable, Sendable {
    let index: Int
    let distance: Double
}

nonisolated protocol ANNIndexProviding: Sendable {
    var isAvailable: Bool { get }
    func nearestNeighbors(
        for vector: [Float],
        limit: Int,
        allowedIndices: Set<Int>
    ) async throws -> [ANNVectorMatch]
}

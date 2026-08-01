import CoreGraphics
import Foundation

struct ANNVectorMatch: Hashable {
    let index: Int
    let distance: Double
}

protocol ANNIndexProviding {
    var isAvailable: Bool { get }
    func nearestNeighbors(
        for vector: [Float],
        limit: Int,
        allowedIndices: Set<Int>
    ) async throws -> [ANNVectorMatch]
}

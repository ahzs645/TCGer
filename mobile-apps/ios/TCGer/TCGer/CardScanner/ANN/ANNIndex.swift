import CoreGraphics
import Foundation

struct ANNVectorMatch: Hashable {
    let index: Int
    let distance: Double
}

protocol ANNIndexProviding {
    func nearestNeighbors(for vector: [Float], limit: Int) async throws -> [ANNVectorMatch]
}

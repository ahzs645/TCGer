import Foundation

struct BinderPagePoint: Codable, Hashable, Sendable {
    let x: Double
    let y: Double
}

struct BinderPageQuad: Codable, Hashable, Sendable {
    let topLeft: BinderPagePoint
    let topRight: BinderPagePoint
    let bottomRight: BinderPagePoint
    let bottomLeft: BinderPagePoint
}

struct BinderPagePlacement: Codable, Hashable, Sendable, Identifiable {
    let slotIndex: Int
    let cardId: String
    let name: String
    let tcg: String
    let setCode: String?
    let confidence: Double
    let status: String
    let quad: BinderPageQuad

    var id: String { "\(slotIndex)-\(cardId)" }
}

struct SavedBinderPage: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let binderId: String
    let pageNumber: Int
    let revision: Int
    let capturedAt: String
    let imageUrl: String?
    let placements: [BinderPagePlacement]
    let createdAt: String
    let updatedAt: String
}

extension BinderPageRecord {
    var persistentPlacements: [BinderPagePlacement] {
        detections.enumerated().compactMap { index, detection in
            guard detection.isIncluded, let candidate = detection.selectedCandidate else { return nil }
            let quad = detection.quad
            return BinderPagePlacement(
                slotIndex: index,
                cardId: candidate.details.identity.id,
                name: candidate.details.identity.name,
                tcg: candidate.details.identity.game.rawValue,
                setCode: candidate.details.identity.setCode,
                confidence: candidate.confidence.score,
                status: detection.status == .matched ? "matched" : "uncertain",
                quad: BinderPageQuad(
                    topLeft: BinderPagePoint(x: quad.topLeft.x, y: quad.topLeft.y),
                    topRight: BinderPagePoint(x: quad.topRight.x, y: quad.topRight.y),
                    bottomRight: BinderPagePoint(x: quad.bottomRight.x, y: quad.bottomRight.y),
                    bottomLeft: BinderPagePoint(x: quad.bottomLeft.x, y: quad.bottomLeft.y)
                )
            )
        }
    }
}

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

struct BinderCardLocation: Hashable, Sendable, Identifiable {
    let pageNumber: Int
    let slotIndex: Int
    let cardId: String

    var id: String { "\(pageNumber)-\(slotIndex)-\(cardId)" }
    var pocketNumber: Int { slotIndex + 1 }
    var label: String { "Page \(pageNumber) · Pocket \(pocketNumber)" }

    static func summary(for locations: [BinderCardLocation]) -> String {
        let grouped = Dictionary(grouping: locations, by: \.pageNumber)
        return grouped.keys.sorted().map { pageNumber in
            let pockets = grouped[pageNumber, default: []]
                .map(\.pocketNumber)
                .sorted()
            let pocketLabel = pockets.count == 1 ? "Pocket" : "Pockets"
            let pocketNumbers = pockets.map(String.init).joined(separator: ", ")
            return "Page \(pageNumber) · \(pocketLabel) \(pocketNumbers)"
        }
        .joined(separator: " · ")
    }
}

extension Array where Element == SavedBinderPage {
    func locations(for card: CollectionCard) -> [BinderCardLocation] {
        let cardIDs = Set([card.cardId, card.externalId].compactMap { value in
            value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
        guard !cardIDs.isEmpty else { return [] }

        return flatMap { page in
            page.placements.compactMap { placement in
                guard cardIDs.contains(placement.cardId.lowercased()) else { return nil }
                return BinderCardLocation(
                    pageNumber: page.pageNumber,
                    slotIndex: placement.slotIndex,
                    cardId: placement.cardId
                )
            }
        }
        .sorted {
            ($0.pageNumber, $0.slotIndex) < ($1.pageNumber, $1.slotIndex)
        }
    }
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

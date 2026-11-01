import Foundation

struct StorageAuditObservation: Codable, Equatable, Sendable {
    let compartmentId: String
    let slotIndex: Int
    var collectionEntryId: String? = nil
    var externalId: String? = nil
    var tcg: String? = nil
    var name: String? = nil
    var quantity: Int? = nil
}

struct StorageAuditRequest: Codable, Equatable, Sendable {
    let containerId: String
    let compartmentId: String?
    let source: String
    let observations: [StorageAuditObservation]?
}

struct StorageAuditResult: Decodable, Sendable {
    struct Item: Decodable, Sendable {
        let compartmentId: String
        let compartmentLabel: String
        let slotIndex: Int
        let status: String
        let expectedName: String?
        let observedName: String?
        let expectedQuantity: Int
        let observedQuantity: Int
    }
    let valid: Bool
    let source: String
    let containerId: String
    let containerName: String
    let capturedAt: String
    let summary: [String: Int]
    let items: [Item]
    let issues: [String]
    let id: String?
    let status: String?
    let createdAt: String?
}

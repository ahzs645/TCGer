import Foundation

enum StorageContainerKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case binder
    case box
    case `case`
    case other

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

struct StoragePlacement: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let collectionEntryId: String
    let slotIndex: Int
    let quantity: Int
    let stackKey: String?
    var cardName: String?
    var printedName: String?
}

struct StorageCompartment: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let label: String
    let order: Int
    let pageNumber: Int?
    let rows: Int
    let columns: Int
    let capacity: Int
    let locked: Bool
    let placements: [StoragePlacement]
}

struct StorageContainer: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let binderId: String?
    let name: String
    let kind: StorageContainerKind
    let order: Int
    let isUnsorted: Bool
    let locked: Bool
    let compartments: [StorageCompartment]
}

struct CreateStorageContainerRequest: Encodable, Sendable {
    let name: String
    let kind: StorageContainerKind
    let binderId: String?
    let order: Int?
    let isUnsorted: Bool
    let locked: Bool
}

struct UpdateStorageContainerRequest: Encodable, Sendable {
    let name: String?
    let order: Int?
    let locked: Bool?
}

struct CreateStorageCompartmentRequest: Encodable, Sendable {
    let containerId: String
    let label: String
    let order: Int
    let pageNumber: Int?
    let rows: Int
    let columns: Int
    let capacity: Int
    let locked: Bool
}

struct UpdateStorageCompartmentRequest: Encodable, Sendable {
    let label: String?
    let order: Int?
    let pageNumber: Int?
    let locked: Bool?
}

struct PlaceCollectionEntryRequest: Encodable, Sendable {
    let compartmentId: String
    let collectionEntryId: String
    let slotIndex: Int
    let quantity: Int
    let allowDuplicateStacking: Bool
}

struct DeckCheckoutAllocation: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let deckCardId: String
    let collectionEntryId: String
    let quantity: Int
    let containerId: String?
    let containerName: String?
    let compartmentId: String?
    let compartmentLabel: String?
    let slotIndex: Int?
    let cardName: String?
    let printedName: String?
    let refilledAt: String?

    var locationDescription: String {
        let location = [containerName, compartmentLabel].compactMap { $0 }.joined(separator: " · ")
        guard let slotIndex else { return location.isEmpty ? "Unsorted" : location }
        return [location, "Slot \(slotIndex + 1)"].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

struct DeckCheckoutSession: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let deckId: String
    let status: String
    let note: String?
    let checkedOutAt: String
    let checkedInAt: String?
    let allocations: [DeckCheckoutAllocation]

    var isCheckedOut: Bool { status == "checked_out" }
}

struct RapidSetEntryRequest: Encodable, Sendable {
    struct Entry: Encodable, Sendable {
        let rowId: String
        let collectorNumber: String
        let card: CardData
        let quantity: Int
    }

    struct CardData: Encodable, Sendable {
        let name: String
        let printedName: String?
        let searchAliases: [String]?
        let tcg: String
        let externalId: String
        let setCode: String?
        let setName: String?
        let collectorNumber: String?
        let imageUrl: String?
        let imageUrlSmall: String?
    }

    let binderId: String
    let tcg: String
    let setCode: String
    let entries: [Entry]
}

struct RapidSetEntryReceipt: Identifiable, Codable, Hashable, Sendable {
    let receiptId: String
    let addedRows: Int
    let addedCopies: Int
    let items: [Item]
    var cardName: String?
    var printedName: String?

    var id: String { receiptId }

    struct Item: Identifiable, Codable, Hashable, Sendable {
        let rowId: String
        let collectorNumber: String
        let entryId: String
        let auditId: String
        let quantity: Int

        var id: String { auditId }
    }
}

struct UndoCollectionMutationRequest: Encodable, Sendable {
    let idempotencyKey: String
}

struct UndoCollectionMutationResponse: Codable, Sendable {
    let audit: JSONValue
}

struct LegacyRapidSetEntryReceipt: Identifiable, Codable, Hashable, Sendable {
    let id: String
    let auditId: String
    let collectionEntryIds: [String]
    let cardName: String
    let printedName: String?
    let setCode: String
    let collectorNumber: String
    let quantity: Int
}

struct AcquisitionCostSplitItem: Identifiable, Codable, Hashable, Sendable {
    let collectionEntryId: String
    var weight: Int
    var cardName: String?

    var id: String { collectionEntryId }
}

struct AcquisitionCostSplitRequest: Encodable, Sendable {
    struct Line: Encodable, Sendable {
        let collectionEntryId: String
        let weight: Int
    }

    let totalCents: Int
    let currency: String
    let mode: String
    let lines: [Line]
    let notes: String?
}

struct AcquisitionCostAllocation: Identifiable, Codable, Hashable, Sendable {
    let collectionEntryId: String
    let allocatedCents: Int
    let acquisitionPrice: Double
    let transactionId: String

    var id: String { collectionEntryId }
}

struct AcquisitionCostSplitReceipt: Identifiable, Codable, Hashable, Sendable {
    let allocationGroupId: String
    let auditId: String
    let totalCents: Int
    let currency: String
    let allocations: [AcquisitionCostAllocation]

    var id: String { allocationGroupId }
}

struct PSACertificationLookup: Codable, Hashable, Sendable {
    let certNumber: String
    let grader: String
    let grade: Double?
    let gradeLabel: String?
    let labelType: String?
    let year: String?
    let brand: String?
    let subject: String?
    let searchableName: String?
    let cardNumber: String?
    let variety: String?
    let category: String?
    let population: Int?
    let populationHigher: Int?
    let specId: String?
    let cardId: String?
    let providerResponseHash: String
    let retrievedAt: String
    let refreshAfter: String
    let cached: Bool
}

struct PSACertIntakeRequest: Encodable, Sendable {
    let binderId: String
    let entryId: String
    let gradingCompany: String
    let gradingScore: String?
    let certNumber: String
}

struct PrintedIdentityUpdateRequest: Encodable, Sendable {
    let printedName: String?
    let searchAliases: [String]
}

struct TrackedPriceRequest: Encodable, Sendable {
    struct Item: Encodable, Sendable {
        let tcg: String
        let externalId: String
    }

    let items: [Item]
    let force: Bool
    let source: String
}

struct LibraryTrackedPriceResult: Identifiable, Codable, Hashable, Sendable {
    struct Provenance: Codable, Hashable, Sendable {
        struct OriginalQuote: Codable, Hashable, Sendable {
            let amount: Double
            let currency: String
            let source: String
            let asOf: String?
        }

        struct FX: Codable, Hashable, Sendable {
            let fromCurrency: String
            let toCurrency: String
            let rate: Double
            let source: String
            let asOf: String
        }

        struct Match: Codable, Hashable, Sendable {
            let method: String
            let confidence: Double
            let ambiguous: Bool?
            let providerProductId: String?
            let providerGroupId: String?
        }

        let provider: String
        let retrievedAt: String
        let originalQuotes: [OriginalQuote]
        let fx: FX?
        let match: Match?
    }

    let key: String
    let tcg: String
    let externalId: String
    let price: Double?
    let currency: String?
    let source: String?
    let updatedAt: String?
    let cached: Bool
    let error: String?
    let provenance: Provenance?

    var id: String { key }
}

struct LibraryTrackedPricesEnvelope: Decodable, Sendable {
    let prices: [LibraryTrackedPriceResult]
    let refreshedAt: String?
    let refreshAfter: String?
}

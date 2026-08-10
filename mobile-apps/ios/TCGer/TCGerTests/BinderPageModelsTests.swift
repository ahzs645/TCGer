import XCTest
@testable import TCGer

@MainActor
final class BinderPageModelsTests: XCTestCase {
    func testSavedPageRoundTripsWithoutAnImage() throws {
        let page = SavedBinderPage(
            id: "page-7",
            binderId: "binder-1",
            pageNumber: 7,
            revision: 2,
            capturedAt: "2026-08-10T12:00:00Z",
            imageUrl: nil,
            placements: [
                BinderPagePlacement(
                    slotIndex: 0,
                    cardId: "sv3-125",
                    name: "Pikachu",
                    tcg: "pokemon",
                    setCode: "SV3",
                    confidence: 0.94,
                    status: "matched",
                    quad: BinderPageQuad(
                        topLeft: .init(x: 0.1, y: 0.9),
                        topRight: .init(x: 0.3, y: 0.9),
                        bottomRight: .init(x: 0.3, y: 0.5),
                        bottomLeft: .init(x: 0.1, y: 0.5)
                    )
                )
            ],
            createdAt: "2026-08-10T12:00:00Z",
            updatedAt: "2026-08-10T12:05:00Z"
        )

        let decoded = try JSONDecoder().decode(
            SavedBinderPage.self,
            from: JSONEncoder().encode(page)
        )

        XCTAssertEqual(decoded, page)
        XCTAssertNil(decoded.imageUrl)
        XCTAssertEqual(decoded.placements.first?.slotIndex, 0)
    }

    func testLocalPageUpsertRevisesMetadataWithoutRequiringPhoto() throws {
        let store = LocalStore()
        let binder = store.createCollection(
            name: "Binder Page Test \(UUID().uuidString)",
            description: nil,
            colorHex: nil
        )
        defer { try? store.deleteCollection(id: binder.id) }

        let first = store.upsertBinderPage(
            binderId: binder.id,
            pageNumber: 4,
            capturedAt: Date(),
            placements: []
        )
        let revised = store.upsertBinderPage(
            binderId: binder.id,
            pageNumber: 4,
            capturedAt: Date(),
            placements: []
        )

        XCTAssertEqual(first.revision, 1)
        XCTAssertEqual(revised.revision, 2)
        XCTAssertNil(revised.imageUrl)
        XCTAssertEqual(store.getBinderPages(binderId: binder.id).count, 1)

        let withImage = try store.replaceBinderPageImage(
            binderId: binder.id,
            pageNumber: 4,
            imageData: Data([0xFF, 0xD8, 0xFF, 0xD9])
        )
        XCTAssertNotNil(withImage.imageUrl)

        store.removeBinderPageImage(binderId: binder.id, pageNumber: 4)
        XCTAssertNil(store.getBinderPages(binderId: binder.id).first?.imageUrl)
    }
}

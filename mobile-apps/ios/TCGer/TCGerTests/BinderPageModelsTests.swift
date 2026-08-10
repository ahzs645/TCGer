import XCTest
@testable import TCGer

@MainActor
final class BinderPageModelsTests: XCTestCase {
    private func candidate(id: String, score: Double, ocrVerified: Bool = false) -> CardScanCandidate {
        CardScanCandidate(
            details: CardDetails(
                identity: CardIdentity(id: id, name: id, game: .pokemon, setCode: nil, setName: nil),
                rarity: nil,
                imageURL: nil,
                price: nil
            ),
            confidence: CardScanConfidence(score: score, reason: "test"),
            originatingStrategy: .mlDetector,
            debugInfo: ocrVerified ? ["ocrVerified": "true"] : [:]
        )
    }

    func testUncertainSuggestionsNeedAnnMarginOrOCRToAutoInclude() {
        // Matched detections are always included, regardless of margin.
        XCTAssertTrue(BinderPageScanner.isReliableSuggestion(
            primary: candidate(id: "sv1-1", score: 0.85),
            alternatives: [candidate(id: "sv1-2", score: 0.84)],
            status: .matched
        ))
        // Uncertain with a clear margin (0.79 vs 0.70) stays auto-included.
        XCTAssertTrue(BinderPageScanner.isReliableSuggestion(
            primary: candidate(id: "sv1-1", score: 0.79),
            alternatives: [candidate(id: "sv1-2", score: 0.70)],
            status: .uncertain
        ))
        // A near-tied rival (margin 0.01 < 0.05) makes the suggestion
        // review-only: measured wrong review candidates all had margin <=
        // 0.047 on the 67-attempt binder evidence set.
        XCTAssertFalse(BinderPageScanner.isReliableSuggestion(
            primary: candidate(id: "sv1-1", score: 0.79),
            alternatives: [candidate(id: "sv1-2", score: 0.78)],
            status: .uncertain
        ))
        // Same-card duplicates never count as rivals; only a different
        // identity competes.
        XCTAssertTrue(BinderPageScanner.isReliableSuggestion(
            primary: candidate(id: "sv1-1", score: 0.79),
            alternatives: [candidate(id: "sv1-1", score: 0.78), candidate(id: "sv1-2", score: 0.60)],
            status: .uncertain
        ))
        // OCR-verified primaries are exempt even when the ANN margin is tiny.
        XCTAssertTrue(BinderPageScanner.isReliableSuggestion(
            primary: candidate(id: "sv1-1", score: 0.75, ocrVerified: true),
            alternatives: [candidate(id: "sv1-2", score: 0.749)],
            status: .uncertain
        ))
        // No alternatives at all means no rival — the suggestion stands.
        XCTAssertTrue(BinderPageScanner.isReliableSuggestion(
            primary: candidate(id: "sv1-1", score: 0.73),
            alternatives: [],
            status: .uncertain
        ))
    }

    func testSampleBinderPageUsesACompleteThreeByThreePocketLayout() {
        let page = LocalStore.makeSampleBinderPage(timestamp: "2026-08-10T12:00:00Z")

        XCTAssertEqual(page.binderId, "sample-binder-1")
        XCTAssertEqual(page.pageNumber, 1)
        XCTAssertNil(page.imageUrl)
        XCTAssertEqual(page.placements.count, 9)
        XCTAssertEqual(page.placements.map(\.slotIndex), Array(0..<9))

        for placement in page.placements {
            let points = [
                placement.quad.topLeft,
                placement.quad.topRight,
                placement.quad.bottomRight,
                placement.quad.bottomLeft
            ]
            XCTAssertTrue(points.allSatisfy { (0...1).contains($0.x) && (0...1).contains($0.y) })
        }

        let leftEdges = Set(page.placements.map { $0.quad.topLeft.x })
        let topEdges = Set(page.placements.map { $0.quad.topLeft.y })
        XCTAssertEqual(leftEdges.count, 3)
        XCTAssertEqual(topEdges.count, 3)
    }

    func testLoadingSampleDataSeedsTheNinePocketFavoritesBinder() throws {
        let store = LocalStore()
        let wasLoaded = store.isSampleDataLoaded
        if wasLoaded {
            store.removeSampleData()
        }
        defer {
            store.removeSampleData()
            if wasLoaded {
                store.loadSampleData()
            }
        }

        store.loadSampleData()

        let binder = try store.getCollection(id: "sample-binder-1")
        let page = try XCTUnwrap(store.getBinderPages(binderId: binder.id).first)
        XCTAssertEqual(binder.totalCopies, 9)
        XCTAssertEqual(page.placements.count, 9)
        XCTAssertEqual(Set(page.placements.map(\.slotIndex)), Set(0..<9))
    }

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

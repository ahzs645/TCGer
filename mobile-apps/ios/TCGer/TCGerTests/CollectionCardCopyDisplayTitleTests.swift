import XCTest
@testable import TCGer

final class CollectionCardCopyDisplayTitleTests: XCTestCase {
    func testSingleUnserializedCopyHasNoDisplayTitle() {
        XCTAssertNil(makeCopy().displayTitle(index: 0, totalCount: 1))
    }

    func testMultipleUnserializedCopiesUseOneBasedOrdinals() {
        let copy = makeCopy()

        XCTAssertEqual(copy.displayTitle(index: 0, totalCount: 2), "Copy #1")
        XCTAssertEqual(copy.displayTitle(index: 1, totalCount: 2), "Copy #2")
    }

    func testSerialNumberIsPreservedForSingleCopy() {
        XCTAssertEqual(
            makeCopy(serialNumber: "  42/100  ").displayTitle(index: 0, totalCount: 1),
            "42/100"
        )
    }

    func testCopyCountsUseSingularAndPluralGrammar() {
        XCTAssertEqual(CollectionCopyText.count(1), "1 copy")
        XCTAssertEqual(CollectionCopyText.count(2), "2 copies")
        XCTAssertEqual(CollectionCopyText.total(1), "1 total copy")
        XCTAssertEqual(CollectionCopyText.total(2), "2 total copies")
    }

    private func makeCopy(serialNumber: String? = nil) -> CollectionCardCopy {
        CollectionCardCopy(
            id: "copy-1",
            condition: nil,
            language: nil,
            notes: nil,
            price: nil,
            acquisitionPrice: nil,
            serialNumber: serialNumber,
            acquiredAt: nil,
            isFoil: nil,
            finishCode: nil,
            finishLabel: nil,
            edition: nil,
            stamp: nil,
            isSealedPromo: nil,
            isOversized: nil,
            isPeelOff: nil,
            isSigned: nil,
            isAltered: nil,
            imageUrls: nil,
            gradingCompany: nil,
            gradingScore: nil,
            certNumber: nil,
            storageLocation: nil,
            tags: []
        )
    }
}

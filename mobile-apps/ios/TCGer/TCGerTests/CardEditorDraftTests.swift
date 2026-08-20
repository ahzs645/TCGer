import XCTest
@testable import TCGer

final class CardEditorDraftTests: XCTestCase {
    func testVariantTrimsSharedEditorValues() {
        let draft = makeDraft(
            finishCode: "holo",
            edition: "  1st Edition  ",
            stamp: "  Staff  "
        )

        XCTAssertEqual(draft.variant.finishCode, "holo")
        XCTAssertEqual(draft.variant.finishLabel, PokemonFinishOption.label(for: "holo"))
        XCTAssertEqual(draft.variant.edition, "1st Edition")
        XCTAssertEqual(draft.variant.stamp, "Staff")
    }

    func testAddRequestEncodesOwnedCopyDetailsFromSharedEditor() throws {
        let request = APIService.AddCardToBinderRequest(
            cardId: "card-1",
            quantity: 1,
            condition: "Near Mint",
            language: "English",
            notes: nil,
            price: nil,
            acquisitionPrice: nil,
            isFoil: true,
            finishCode: "holo",
            finishLabel: "Holo",
            edition: nil,
            stamp: nil,
            isSealedPromo: false,
            isOversized: false,
            isPeelOff: false,
            isSigned: false,
            isAltered: false,
            gradingCompany: "PSA",
            gradingScore: "10",
            certNumber: "12345",
            storageLocation: "Display Case",
            tags: ["favorite"],
            newTags: nil,
            cardData: nil
        )

        let data = try JSONEncoder().encode(request)
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(json["gradingCompany"] as? String, "PSA")
        XCTAssertEqual(json["gradingScore"] as? String, "10")
        XCTAssertEqual(json["certNumber"] as? String, "12345")
        XCTAssertEqual(json["storageLocation"] as? String, "Display Case")
        XCTAssertEqual(json["tags"] as? [String], ["favorite"])
    }

    private func makeDraft(
        finishCode: String = "",
        edition: String = "",
        stamp: String = ""
    ) -> CardEditorDraft {
        CardEditorDraft(
            quantity: 1,
            condition: "Near Mint",
            language: "English",
            notes: "",
            isFoil: false,
            isSigned: false,
            isAltered: false,
            finishCode: finishCode,
            edition: edition,
            stamp: stamp,
            isSealedPromo: false,
            isOversized: false,
            isPeelOff: false,
            gradingCompany: "",
            gradingScore: "",
            certNumber: "",
            storageLocation: "",
            selectedTagIds: []
        )
    }
}

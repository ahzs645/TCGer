import XCTest
@testable import TCGer

final class LibraryOperationsContractTests: XCTestCase {
    func testTrackedPricesDecodeFromEnvelope() throws {
        let json = #"{"prices":[{"key":"pokemon:sv1-1","tcg":"pokemon","externalId":"sv1-1","price":1.25,"currency":"USD","cached":true}],"refreshedAt":"2026-08-29T00:00:00Z","refreshAfter":"2026-08-29T01:00:00Z"}"#
        let envelope = try JSONDecoder().decode(LibraryTrackedPricesEnvelope.self, from: Data(json.utf8))
        XCTAssertEqual(envelope.prices.first?.externalId, "sv1-1")
        XCTAssertEqual(envelope.refreshAfter, "2026-08-29T01:00:00Z")
    }

    func testStoragePatchOmitsUnchangedFields() throws {
        let data = try JSONEncoder().encode(UpdateStorageContainerRequest(name: nil, order: 3, locked: nil))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["order"] as? Int, 3)
        XCTAssertNil(object["name"])
        XCTAssertNil(object["locked"])
    }

    func testScannerCatalogRejectionDecodes() throws {
        let json = #"{"candidates":[],"meta":{"catalogDecision":{"accepted":false,"reason":"ambiguous","topConfidence":0.9,"runnerUpConfidence":0.898}}}"#
        let response = try JSONDecoder().decode(APIService.ScanImageResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.meta?.catalogDecision?.accepted, false)
        XCTAssertEqual(response.meta?.catalogDecision?.reason, "ambiguous")
    }
}

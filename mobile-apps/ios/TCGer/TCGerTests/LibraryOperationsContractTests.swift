import Foundation
import XCTest
@testable import TCGer

final class LibraryOperationsContractTests: XCTestCase {
    @MainActor
    func testStorageAuditPreviewAndCommitPreserveReviewedPhysicalObservations() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StorageAuditURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); StorageAuditURLProtocol.handler = nil }
        let input = StorageAuditRequest(containerId: "box", compartmentId: "slot-group", source: "manual", observations: [
            StorageAuditObservation(compartmentId: "slot-group", slotIndex: 0, collectionEntryId: "physical-copy", quantity: 1)
        ])
        var paths: [String] = []
        StorageAuditURLProtocol.handler = { request in
            let url = try XCTUnwrap(request.url)
            paths.append(url.path)
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer account-token")
            let body: Data
            if let data = request.httpBody { body = data }
            else {
                let stream = try XCTUnwrap(request.httpBodyStream)
                stream.open()
                defer { stream.close() }
                var bytes = Data(), buffer = [UInt8](repeating: 0, count: 1024)
                while stream.hasBytesAvailable {
                    let read = stream.read(&buffer, maxLength: buffer.count)
                    if read <= 0 { break }
                    bytes.append(buffer, count: read)
                }
                body = bytes
            }
            XCTAssertEqual(try JSONDecoder().decode(StorageAuditRequest.self, from: body), input)
            var result: [String: Any] = [
                "valid": true, "source": "manual", "containerId": "box", "containerName": "Storage box",
                "capturedAt": "2026-10-31T00:00:00Z", "summary": ["correct": 0, "missing": 0, "wrong": 1, "extra": 0],
                "issues": [], "items": [["compartmentId": "slot-group", "compartmentLabel": "Page 1", "slotIndex": 0, "status": "wrong", "expectedName": "Expected card", "observedName": "Observed card", "expectedQuantity": 1, "observedQuantity": 1]]
            ]
            if url.path == "/storage/audits" {
                result["id"] = "audit-1"
                result["status"] = "reviewed"
                result["createdAt"] = "2026-10-31T00:00:01Z"
            }
            return (try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)), try JSONSerialization.data(withJSONObject: result))
        }
        let api = APIService(session: session)
        let preview = try await api.previewStorageAudit(config: ServerConfiguration(baseURL: "https://audit.test"), token: "account-token", request: input)
        XCTAssertNil(preview.id)
        XCTAssertEqual(preview.summary["wrong"], 1)
        XCTAssertEqual(preview.items.first?.slotIndex, 0)
        let receipt = try await api.commitStorageAudit(config: ServerConfiguration(baseURL: "https://audit.test"), token: "account-token", request: input)
        XCTAssertEqual(receipt.id, "audit-1")
        XCTAssertEqual(receipt.status, "reviewed")
        XCTAssertEqual(paths, ["/storage/audits/preview", "/storage/audits"])
    }

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

private final class StorageAuditURLProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let (response, data) = try XCTUnwrap(Self.handler)(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() { }
}

import Foundation
import XCTest
@testable import TCGer

final class ServerAPIContractTests: XCTestCase {
    func testCollectionsBrowsePopulated() async throws { try await verify("collections.browse.populated") }
    func testCollectionsBrowseEmpty() async throws { try await verify("collections.browse.empty") }
    func testCollectionsBrowseUnauthorized() async throws { try await verify("collections.browse.unauthorized") }
    func testCollectionsCreateSuccess() async throws { try await verify("collections.create.success") }
    func testCollectionsCreateInvalid() async throws { try await verify("collections.create.invalid") }
    func testCollectionsCreateUnauthorized() async throws { try await verify("collections.create.unauthorized") }
    func testCardsSearchResults() async throws { try await verify("cards.search.results") }
    func testCardsSearchEmpty() async throws { try await verify("cards.search.empty") }
    func testCardsSearchUnauthorized() async throws { try await verify("cards.search.unauthorized") }
    func testCardsSearchUnavailable() async throws { try await verify("cards.search.unavailable") }
    func testCardsSearchPartial() async throws { try await verify("cards.search.partial") }

    func testCollectionsUpdateSuccess() async throws { try await verify("collections.update.success") }
    func testCollectionsUpdateInvalid() async throws { try await verify("collections.update.invalid") }
    func testCollectionsUpdateUnauthorized() async throws { try await verify("collections.update.unauthorized") }
    func testCollectionsUpdateForeign() async throws { try await verify("collections.update.foreign") }
    func testCollectionsDeleteSuccess() async throws { try await verify("collections.delete.success") }
    func testCollectionsDeleteUnauthorized() async throws { try await verify("collections.delete.unauthorized") }
    func testCollectionsDeleteForeign() async throws { try await verify("collections.delete.foreign") }
    func testDataImportSuccess() async throws { try await verify("data.import.success") }
    func testDataImportInvalid() async throws { try await verify("data.import.invalid") }
    func testDataImportUnauthorized() async throws { try await verify("data.import.unauthorized") }

    func testCollectionsCopyAddSuccess() async throws { try await verify("collections.copyAdd.success") }
    func testCollectionsCopyAddInvalid() async throws { try await verify("collections.copyAdd.invalid") }
    func testCollectionsCopyAddUnauthorized() async throws { try await verify("collections.copyAdd.unauthorized") }
    func testCollectionsCopyAddForeign() async throws { try await verify("collections.copyAdd.foreign") }
    func testScannerSaveSuccess() async throws { try await verify("scanner.save.success") }
    func testCollectionsCopyUpdateSuccess() async throws { try await verify("collections.copyUpdate.success") }
    func testCollectionsCopyUpdateClear() async throws { try await verify("collections.copyUpdate.clear") }
    func testCollectionsCopyUpdateInvalid() async throws { try await verify("collections.copyUpdate.invalid") }
    func testCollectionsCopyUpdateUnauthorized() async throws { try await verify("collections.copyUpdate.unauthorized") }
    func testCollectionsCopyUpdateForeign() async throws { try await verify("collections.copyUpdate.foreign") }
    func testCollectionsCopyRemoveSuccess() async throws { try await verify("collections.copyRemove.success") }
    func testCollectionsCopyRemoveUnauthorized() async throws { try await verify("collections.copyRemove.unauthorized") }
    func testCollectionsCopyRemoveForeign() async throws { try await verify("collections.copyRemove.foreign") }
    func testSealedOpenSuccess() async throws { try await verify("sealed.open.success") }
    func testSealedOpenInvalid() async throws { try await verify("sealed.open.invalid") }
    func testSealedOpenUnauthorized() async throws { try await verify("sealed.open.unauthorized") }
    func testSealedOpenForeign() async throws { try await verify("sealed.open.foreign") }
    func testSealedOpenExceeds() async throws { try await verify("sealed.open.exceeds") }

    func testSealedOpenLinkedCopy() async throws { try await verify("sealed.open.linkedCopy") }
    func testSealedOpenForeignCopy() async throws { try await verify("sealed.open.foreignCopy") }

    func testCollectionsCopyUpdateMove() async throws { try await verify("collections.copyUpdate.move") }
    func testScannerSaveInvalid() async throws { try await verify("scanner.save.invalid") }
    func testScannerSaveUnauthorized() async throws { try await verify("scanner.save.unauthorized") }

    private func verify(_ id: String) async throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "ApiContracts.generated", withExtension: "json"))
        let registry = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let interactions = try XCTUnwrap(registry["interactions"] as? [[String: Any]])
        let interaction = try XCTUnwrap(interactions.first { $0["id"] as? String == id })
        let request = try XCTUnwrap(interaction["request"] as? [String: Any])
        let expected = try XCTUnwrap(interaction["response"] as? [String: Any])
        let status = try XCTUnwrap(expected["status"] as? Int)
        let headers = try XCTUnwrap(request["headers"] as? [String: String])
        let token = try XCTUnwrap(headers["Authorization"]).replacingOccurrences(of: "Bearer ", with: "")
        let operation = try XCTUnwrap(interaction["operation"] as? String)
        let cacheRoot = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: cacheRoot) }
        let body = request["body"] as? [String: Any] ?? [:]
        var requestCount = 0
        ContractURLProtocol.handler = { actual in
            requestCount += 1
            XCTAssertEqual(actual.url?.path, request["path"] as? String, id)
            XCTAssertEqual(actual.httpMethod, request["method"] as? String, id)
            for (key, value) in headers { XCTAssertEqual(actual.value(forHTTPHeaderField: key), value, id) }
            let items = URLComponents(url: try XCTUnwrap(actual.url), resolvingAgainstBaseURL: false)?.queryItems ?? []
            XCTAssertEqual(items.count, (request["query"] as? [String: String] ?? [:]).count, id)
            let query = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
            XCTAssertEqual(query, request["query"] as? [String: String] ?? [:], id)
            if request["body"] != nil {
                let encoded = try Self.requestBody(actual)
                let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? NSDictionary)
                XCTAssertEqual(decoded, body as NSDictionary, id)
                XCTAssertTrue(actual.value(forHTTPHeaderField: "Content-Type")?.contains("application/json") == true)
            }
            var payload = try XCTUnwrap(expected["body"])
            if var fields = payload as? [String: Any] { fields["futureServerField"] = true; payload = fields }
            let response = try XCTUnwrap(HTTPURLResponse(url: try XCTUnwrap(actual.url), statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"]))
            return (response, status == 204 ? Data() : try JSONSerialization.data(withJSONObject: payload))
        }
        defer { ContractURLProtocol.handler = nil }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ContractURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let service = APIService(session: session, collectionCache: CacheManager(directory: cacheRoot))
        let config = ServerConfiguration(baseURL: "https://contract.test")
        do {
            switch operation {
            case "listBinders":
                let result = try await service.getCollections(config: config, token: token)
                XCTAssertLessThan(status, 400, id)
                let expectedBinders = try XCTUnwrap(expected["body"] as? [[String: Any]])
                XCTAssertEqual(result.count, expectedBinders.count, id)
                for (binder, fields) in zip(result, expectedBinders) { assertBinder(binder, fields, id) }
            case "createBinder":
                let result = try await service.createCollection(config: config, token: token, name: try XCTUnwrap(body["name"] as? String), description: body["description"] as? String, colorHex: body["colorHex"] as? String, defaultCondition: body["defaultCondition"] as? String, containerType: body["containerType"] as? String, associatedTcg: body["associatedTcg"] as? String, associatedSetCode: body["associatedSetCode"] as? String, associatedSetName: body["associatedSetName"] as? String)
                XCTAssertLessThan(status, 400, id)
                assertBinder(result, try XCTUnwrap(expected["body"] as? [String: Any]), id)
            case "updateBinder":
                let result = try await service.updateCollection(config: config, token: token, id: "contract-binder", name: body["name"] as? String)
                XCTAssertLessThan(status, 400, id)
                assertBinder(result, try XCTUnwrap(expected["body"] as? [String: Any]), id)
            case "deleteBinder":
                try await service.deleteCollection(config: config, token: token, id: "contract-binder")
                XCTAssertEqual(status, 204, id)
            case "addCopy":
                let data = try XCTUnwrap(body["cardData"] as? [String: Any])
                let card = Card(id: try XCTUnwrap(data["externalId"] as? String), name: try XCTUnwrap(data["name"] as? String), tcg: try XCTUnwrap(data["tcg"] as? String), setCode: data["setCode"] as? String, setName: nil, rarity: nil, imageUrl: nil, imageUrlSmall: nil, price: nil, collectorNumber: nil, releasedAt: nil)
                let copyID = try await service.addCardToBinder(config: config, token: token, binderId: "contract-binder", cardId: try XCTUnwrap(body["cardId"] as? String), quantity: body["quantity"] as? Int ?? 1, condition: body["condition"] as? String, language: body["language"] as? String, price: body["price"] as? Double, acquisitionPrice: body["acquisitionPrice"] as? Double, card: card)
                XCTAssertLessThan(status, 400, id)
                let fields = try XCTUnwrap(expected["body"] as? [String: Any])
                let copies = try XCTUnwrap(fields["copies"] as? [[String: Any]])
                XCTAssertEqual(copyID, copies.first?["id"] as? String)
            case "updateCopy":
                let clear = body["acquisitionPrice"] is NSNull
                let result = try await service.updateCardInBinder(config: config, token: token, binderId: "contract-binder", collectionCardId: "contract-copy", quantity: body["quantity"] as? Int, condition: body["condition"] as? String, notes: body["notes"] as? String, includeOwnedCopyDetails: clear, includeAcquisitionDetails: clear, targetBinderId: body["targetBinderId"] as? String)
                XCTAssertLessThan(status, 400, id)
                let fields = try XCTUnwrap(expected["body"] as? [String: Any])
                XCTAssertEqual(result.quantity, fields["quantity"] as? Int)
                let copies = try XCTUnwrap(fields["copies"] as? [[String: Any]])
                XCTAssertEqual(result.copies.count, copies.count)
                for (copy, data) in zip(result.copies, copies) {
                    XCTAssertEqual(copy.id, data["id"] as? String)
                    XCTAssertEqual(copy.condition, data["condition"] as? String)
                    XCTAssertEqual(copy.acquisitionPrice, data["acquisitionPrice"] as? Double)
                    XCTAssertEqual(copy.notes, data["notes"] as? String)
                    XCTAssertEqual(copy.acquiredAt, data["acquiredAt"] as? String)
                    XCTAssertEqual(copy.gradingCompany, data["gradingCompany"] as? String)
                    XCTAssertEqual(copy.gradingScore, data["gradingScore"] as? String)
                    XCTAssertEqual(copy.certNumber, data["certNumber"] as? String)
                    XCTAssertEqual(copy.storageLocation, data["storageLocation"] as? String)
                }
            case "removeCopy":
                try await service.deleteCardFromBinder(config: config, token: token, binderId: "contract-binder", collectionCardId: "contract-copy")
                XCTAssertEqual(status, 204, id)
            case "openSealed":
                let result = try await service.createSealedOpening(config: config, token: token, inventoryId: "contract-inventory", openedQuantity: try XCTUnwrap(body["openedQuantity"] as? Int), collectionIds: body["collectionIds"] as? [String] ?? [], openedAt: body["openedAt"] as? String, notes: body["notes"] as? String)
                XCTAssertLessThan(status, 400, id)
                let fields = try XCTUnwrap(expected["body"] as? [String: Any])
                XCTAssertEqual(result.id, fields["id"] as? String)
                XCTAssertEqual(result.sealedInventoryId, fields["sealedInventoryId"] as? String)
                XCTAssertEqual(result.openedQuantity, fields["openedQuantity"] as? Int)
                XCTAssertEqual(result.openedAt, fields["openedAt"] as? String)
                XCTAssertEqual(result.notes, fields["notes"] as? String)
            case "importBackup":
                let result = try await service.importServerBackup(config: config, token: token, document: JSONSerialization.data(withJSONObject: body))
                XCTAssertLessThan(status, 400, id)
                let fields = try XCTUnwrap(expected["body"] as? [String: Any])
                XCTAssertEqual(result.importedCopies, fields["importedCopies"] as? Int)
                XCTAssertEqual(result.importedBinders, fields["importedBinders"] as? Int)
                XCTAssertEqual(result.recoveryAvailable, fields["recoveryAvailable"] as? Bool)
            case "searchCards":
                let query = try XCTUnwrap(request["query"] as? [String: String])
                let cards = try await service.searchAllCards(config: config, token: token, query: try XCTUnwrap(query["query"]), game: query["tcg"].flatMap { TCGGame(rawValue: $0) } ?? .all, limit: 1000)
                XCTAssertLessThan(status, 400, id)
                let response = try XCTUnwrap(expected["body"] as? [String: Any])
                XCTAssertTrue((response["failedProviders"] as? [String] ?? []).isEmpty, "Incomplete search must fail: \(id)")
                let fields = try XCTUnwrap(response["cards"] as? [[String: Any]])
                XCTAssertEqual(cards.count, fields.count, id)
                for (card, data) in zip(cards, fields) {
                    XCTAssertEqual(card.id, data["id"] as? String, id)
                    XCTAssertEqual(card.name, data["name"] as? String, id)
                    XCTAssertEqual(card.tcg, data["tcg"] as? String, id)
                    XCTAssertEqual(card.price, data["price"] as? Double, id)
                }
            default: XCTFail("Uncovered iOS operation: \(operation)")
            }
        } catch APIService.APIError.unauthorized {
            XCTAssertEqual(status, 401, id)
        } catch APIService.APIError.serverError(let actualStatus, _) {
            let response = expected["body"] as? [String: Any]
            if let failedProviders = response?["failedProviders"] as? [String], !failedProviders.isEmpty {
                XCTAssertEqual(actualStatus, 503, id)
            } else {
                XCTAssertGreaterThanOrEqual(status, 400, id)
                XCTAssertEqual(actualStatus, status, id)
            }
        }
        XCTAssertEqual(requestCount, 1, "Must execute the remote operation: \(id)")
    }

    private func assertBinder(_ binder: Collection, _ fields: [String: Any], _ id: String) {
        XCTAssertEqual(binder.id, fields["id"] as? String, id)
        XCTAssertEqual(binder.name, fields["name"] as? String, id)
        XCTAssertEqual(binder.cards.count, (fields["cards"] as? [Any])?.count, id)
        XCTAssertEqual(binder.createdAt, fields["createdAt"] as? String, id)
        XCTAssertEqual(binder.updatedAt, fields["updatedAt"] as? String, id)
        XCTAssertEqual(binder.associatedTcg, fields["associatedTcg"] as? String, id)
        XCTAssertEqual(binder.associatedSetCode, fields["associatedSetCode"] as? String, id)
        XCTAssertEqual(binder.defaultCondition, fields["defaultCondition"] as? String, id)
    }

    private static func requestBody(_ request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeContentData) }
            if count == 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

private final class ContractURLProtocol: URLProtocol, @unchecked Sendable {
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
    override func stopLoading() {}
}

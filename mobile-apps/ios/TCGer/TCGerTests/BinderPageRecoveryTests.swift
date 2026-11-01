import Foundation
import XCTest
@testable import TCGer

@MainActor
final class BinderPageRecoveryTests: XCTestCase {
    private let config = ServerConfiguration(baseURL: "https://binder.test/api")

    func testRelaunchAfterImageFailureKeepsBytesAndExactCopiesWithoutRepeatingIntakeOrPositions() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = BinderPageSaveJournal(directory: directory)
        let attempt = makeAttempt()
        try journal.save(attempt, scope: "account-a")
        let service = BinderRecoveryTestService()
        service.imageFailure = .beforeCommit
        do {
            _ = try await coordinator(journal, service).resume(id: attempt.id, scope: "account-a", config: config, token: "a", isCurrent: { true })
            XCTFail("Expected an interrupted image upload")
        } catch { }
        let relaunched = BinderPageSaveJournal(directory: directory)
        let saved = try relaunched.attempt(id: attempt.id, scope: "account-a")
        XCTAssertEqual(saved.pages.first?.imageData, attempt.pages.first?.imageData)
        XCTAssertEqual(saved.receipt?.entryIds, ["physical-1"])
        XCTAssertEqual(saved.committedCopyIDs(on: saved.pages[0]), ["physical-1"])
        XCTAssertTrue(try relaunched.pending(scope: "account-b").isEmpty)
        let result = try await coordinator(relaunched, service).resume(id: attempt.id, scope: "account-a", config: config, token: "rotated-token", isCurrent: { true })
        XCTAssertEqual(result.receipt.entryIds, ["physical-1"])
        XCTAssertEqual(service.intakeCalls, 1)
        XCTAssertEqual(service.metadataCalls, 1)
        XCTAssertEqual(service.imageCalls, 2)
        XCTAssertEqual(service.images[1], attempt.pages[0].imageData)
        XCTAssertTrue(try relaunched.pending(scope: "account-a").isEmpty)
    }

    func testLostIntakeResponseReplaysFrozenOperationAndCreatesOnlyOnePhysicalCopy() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = BinderPageSaveJournal(directory: directory)
        let attempt = makeAttempt()
        try journal.save(attempt, scope: "account")
        let service = BinderRecoveryTestService()
        service.loseIntakeResponse = true
        do {
            _ = try await coordinator(journal, service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
            XCTFail("Expected lost receipt")
        } catch { }
        XCTAssertNil(try journal.attempt(id: attempt.id, scope: "account").receipt)
        let relaunched = BinderPageSaveJournal(directory: directory)
        let result = try await coordinator(relaunched, service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
        XCTAssertEqual(service.intakeCalls, 2)
        XCTAssertEqual(service.intakeCommits, 1)
        XCTAssertEqual(service.operationIDs, [attempt.id, attempt.id])
        XCTAssertEqual(result.receipt.entryIds, ["physical-1"])
    }

    func testRelaunchSkipsCompletedPagesAndRetainsEachPagesPhysicalCopyLinks() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = BinderPageSaveJournal(directory: directory)
        let first = makeAttempt()
        let secondRow = InventoryIntakeRow(rowId: "detection-2", card: first.intake.rows[0].card, details: BinderCardAddDetails())
        let intake = InventoryIntakeDraft(operationId: first.id, collectionId: "binder", source: "scanner", rows: first.intake.rows + [secondRow])
        let secondPage = DeferredBinderPage(pageNumber: 2, capturedAt: first.pages[0].capturedAt, placements: first.pages[0].placements, detectionRowIDs: [secondRow.rowId], imageData: Data("second scan image".utf8), expectedRevision: 0, expectedPageID: nil)
        let attempt = DeferredBinderPageSave(intake: intake, pages: first.pages + [secondPage])
        try journal.save(attempt, scope: "account")
        let service = BinderRecoveryTestService()
        service.imageFailure = .beforeCommit
        service.failingImagePage = 2
        do { _ = try await coordinator(journal, service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true }) }
        catch { }
        let saved = try journal.attempt(id: attempt.id, scope: "account")
        XCTAssertEqual(saved.progress.map(\.completed), [true, false])
        XCTAssertEqual(saved.committedCopyIDs(on: saved.pages[0]), ["physical-1"])
        XCTAssertEqual(saved.committedCopyIDs(on: saved.pages[1]), ["physical-2"])
        let result = try await coordinator(BinderPageSaveJournal(directory: directory), service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
        XCTAssertEqual(result.receipt.entryIds, ["physical-1", "physical-2"])
        XCTAssertEqual(service.intakeCalls, 1)
        XCTAssertEqual(service.metadataCalls, 2)
        XCTAssertEqual(service.imageCalls, 3)
        XCTAssertEqual(service.pageReads, 3, "The completed first page must not be revisited on relaunch")
        XCTAssertEqual(service.images[2], secondPage.imageData)
    }

    func testLostPagePutResponseIsRecognizedByFrozenContentAndSingleRevisionAdvance() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = BinderPageSaveJournal(directory: directory)
        let attempt = makeAttempt()
        try journal.save(attempt, scope: "account")
        let service = BinderRecoveryTestService()
        service.loseMetadataResponse = true
        do {
            _ = try await coordinator(journal, service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
            XCTFail("Expected lost PUT response")
        } catch { }
        let saved = try journal.attempt(id: attempt.id, scope: "account")
        XCTAssertTrue(saved.progress[0].placementAttempted)
        XCTAssertNil(saved.progress[0].savedPage)
        _ = try await coordinator(BinderPageSaveJournal(directory: directory), service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
        XCTAssertEqual(service.metadataCalls, 1, "An acknowledged-by-content PUT must not increment the revision again")
        XCTAssertEqual(service.intakeCalls, 1)
        XCTAssertEqual(service.imageCalls, 1)
    }

    func testLostImageResponseRequiresReviewAndKeepCurrentDoesNotUploadOrAddAgain() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = BinderPageSaveJournal(directory: directory)
        let attempt = makeAttempt()
        try journal.save(attempt, scope: "account")
        let service = BinderRecoveryTestService()
        service.imageFailure = .afterCommit
        do {
            _ = try await coordinator(journal, service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
            XCTFail("Expected lost image response")
        } catch { }
        let relaunched = BinderPageSaveJournal(directory: directory)
        let worker = coordinator(relaunched, service)
        let conflict: BinderPageRecoveryConflict
        do {
            _ = try await worker.resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
            XCTFail("Must review an image whose response was lost")
            return
        } catch let value as BinderPageRecoveryConflict { conflict = value }
        XCTAssertEqual(conflict.currentPage?.revision, 2)
        XCTAssertEqual(service.imageCalls, 1)
        XCTAssertEqual(try relaunched.attempt(id: attempt.id, scope: "account").pages[0].imageData, attempt.pages[0].imageData)
        try worker.resolve(conflict, keeping: .keepCurrent, scope: "account")
        _ = try await worker.resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
        XCTAssertEqual(service.imageCalls, 1)
        XCTAssertEqual(service.intakeCalls, 1)
        XCTAssertTrue(try relaunched.pending(scope: "account").isEmpty)
    }

    func testExplicitReplacementStillRejectsAnotherConcurrentEdit() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = BinderPageSaveJournal(directory: directory)
        let attempt = makeAttempt()
        try journal.save(attempt, scope: "account")
        let service = BinderRecoveryTestService()
        service.imageFailure = .beforeCommit
        let worker = coordinator(journal, service)
        do { _ = try await worker.resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true }) }
        catch { }
        service.makeConcurrentEdit(pageNumber: 1)
        let first = try await conflictFrom(worker, attempt: attempt)
        try worker.resolve(first, keeping: .replaceWithSavedScan, scope: "account")
        service.makeConcurrentEdit(pageNumber: 1)
        let second = try await conflictFrom(worker, attempt: attempt)
        XCTAssertEqual(second.currentPage?.revision, 3)
        XCTAssertEqual(service.metadataCalls, 1)
        XCTAssertEqual(service.imageCalls, 1)
        try worker.resolve(second, keeping: .replaceWithSavedScan, scope: "account")
        let result = try await worker.resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
        XCTAssertEqual(result.pages.first?.revision, 5)
        XCTAssertEqual(service.intakeCalls, 1)
        XCTAssertEqual(service.metadataCalls, 2)
        XCTAssertEqual(service.imageCalls, 2)
    }

    func testReceiptJournalWriteFailureKeepsFrozenIntentForIdempotentReplay() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        var failWrites = false
        let journal = BinderPageSaveJournal(directory: directory, writer: { data, url in
            if failWrites { throw CocoaError(.fileWriteNoPermission) }
            try data.write(to: url, options: .atomic)
        })
        let attempt = makeAttempt()
        try journal.save(attempt, scope: "account")
        let service = BinderRecoveryTestService()
        service.didReturnIntake = { failWrites = true }
        do {
            _ = try await coordinator(journal, service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
            XCTFail("Expected receipt persistence failure")
        } catch { }
        XCTAssertNil(try journal.attempt(id: attempt.id, scope: "account").receipt)
        XCTAssertEqual(service.metadataCalls, 0)
        service.didReturnIntake = nil
        let result = try await coordinator(BinderPageSaveJournal(directory: directory), service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
        XCTAssertEqual(result.receipt.entryIds, ["physical-1"])
        XCTAssertEqual(service.intakeCommits, 1)
        XCTAssertEqual(service.intakeCalls, 2)
    }

    func testInitialJournalFailureAndSessionChangeNeverContinuePageMutations() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let rejected = BinderPageSaveJournal(directory: directory, writer: { _, _ in throw CocoaError(.fileWriteNoPermission) })
        let attempt = makeAttempt()
        XCTAssertThrowsError(try rejected.save(attempt, scope: "account"))
        XCTAssertTrue(try rejected.pending(scope: "account").isEmpty)
        let journal = BinderPageSaveJournal(directory: directory)
        try journal.save(attempt, scope: "account")
        let service = BinderRecoveryTestService()
        var current = true
        service.didReturnIntake = { current = false }
        do {
            _ = try await coordinator(journal, service).resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { current })
            XCTFail("Expected cancellation after session change")
        } catch is CancellationError { }
        XCTAssertEqual(service.pageReads, 0)
        XCTAssertEqual(service.metadataCalls, 0)
        XCTAssertEqual(service.imageCalls, 0)
        XCTAssertEqual(try journal.pending(scope: "account").count, 1)
    }

    func testJournalRejectsChangedImagesAndCannotDiscardAnUnconfirmedSave() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = BinderPageSaveJournal(directory: directory)
        let original = makeAttempt()
        try journal.save(original, scope: "account")
        let page = original.pages[0]
        let changed = DeferredBinderPage(pageNumber: page.pageNumber, capturedAt: page.capturedAt, placements: page.placements, detectionRowIDs: page.detectionRowIDs, imageData: Data("different image".utf8), expectedRevision: 0, expectedPageID: nil)
        XCTAssertThrowsError(try journal.save(DeferredBinderPageSave(intake: original.intake, pages: [changed]), scope: "account"))
        XCTAssertThrowsError(try journal.complete(id: original.id, scope: "account"))
        XCTAssertEqual(try journal.attempt(id: original.id, scope: "account").pages[0].imageData, page.imageData)
    }

    func testLocalPageAndImageRevisionGuardsPreserveNewerContent() throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: directory))
        let binder = store.createCollection(name: "Revision guard", description: nil, colorHex: nil)
        let first = try store.upsertBinderPageIfCurrent(binderId: binder.id, pageNumber: 1, capturedAt: Date(), placements: [], expectedRevision: 0)
        XCTAssertEqual(first.revision, 1)
        XCTAssertThrowsError(try store.upsertBinderPageIfCurrent(binderId: binder.id, pageNumber: 1, capturedAt: Date(), placements: [], expectedRevision: 0))
        let image = try store.replaceBinderPageImage(binderId: binder.id, pageNumber: 1, imageData: Data("original".utf8), expectedRevision: 1)
        XCTAssertEqual(image.revision, 2)
        XCTAssertThrowsError(try store.replaceBinderPageImage(binderId: binder.id, pageNumber: 1, imageData: Data("stale".utf8), expectedRevision: 1))
        XCTAssertEqual(store.getBinderPages(binderId: binder.id), [image])
        store.removeBinderPageImage(binderId: binder.id, pageNumber: 1)
        XCTAssertEqual(store.getBinderPages(binderId: binder.id).first?.revision, 3)
        XCTAssertNil(store.getBinderPages(binderId: binder.id).first?.imageUrl)
    }

    func testProductionPageTransportSendsMetadataAndMultipartRevisionPreconditions() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [BinderRecoveryURLProtocol.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel(); BinderRecoveryURLProtocol.handler = nil }
        let planned = makeAttempt().pages[0]
        let imageBytes = Data("protected scan bytes".utf8)
        var calls = 0
        BinderRecoveryURLProtocol.handler = { request in
            calls += 1
            let url = try XCTUnwrap(request.url)
            let body = try Self.requestBody(request)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer account-token")
            if request.httpMethod == "PUT" {
                XCTAssertEqual(url.path, "/api/collections/binder/pages/1")
                let json = try XCTUnwrap(JSONSerialization.jsonObject(with: body) as? [String: Any])
                XCTAssertEqual(json["expectedRevision"] as? Int, 0)
                XCTAssertEqual(json["capturedAt"] as? String, planned.capturedAt)
                XCTAssertEqual((json["placements"] as? [[String: Any]])?.first?["cardId"] as? String, "printing-a")
            } else {
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertEqual(url.path, "/api/collections/binder/pages/1/image")
                let multipart = try XCTUnwrap(String(data: body, encoding: .utf8))
                XCTAssertTrue(multipart.contains("name=\"expectedRevision\"\r\n\r\n1\r\n"))
                XCTAssertTrue(multipart.contains("name=\"image\"; filename=\"binder-page-1.jpg\""))
                XCTAssertNotNil(body.range(of: imageBytes))
            }
            let page = SavedBinderPage(id: "page-1", binderId: "binder", pageNumber: 1, revision: calls, capturedAt: planned.capturedAt, imageUrl: calls == 2 ? "https://images.test/scan.jpg" : nil, placements: planned.placements, createdAt: "created", updatedAt: "updated")
            return (try XCTUnwrap(HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)), try JSONEncoder().encode(page))
        }
        let api = APIService(session: session)
        let page = try await api.upsertBinderPage(config: config, token: "account-token", binderId: "binder", pageNumber: 1, capturedAt: XCTUnwrap(DeferredBinderPage.date(planned.capturedAt)), placements: planned.placements, expectedRevision: 0)
        let image = try await api.replaceBinderPageImage(config: config, token: "account-token", binderId: "binder", pageNumber: 1, imageData: imageBytes, expectedRevision: page.revision)
        XCTAssertEqual(image.revision, 2)
        XCTAssertEqual(calls, 2)
    }

    private static func requestBody(_ request: URLRequest) throws -> Data {
        if let body = request.httpBody { return body }
        let stream = try XCTUnwrap(request.httpBodyStream)
        stream.open()
        defer { stream.close() }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { throw stream.streamError ?? URLError(.cannotDecodeContentData) }
            if count == 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }

    private func temporaryDirectory() -> URL { FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true) }

    private func coordinator(_ journal: BinderPageSaveJournal, _ service: BinderRecoveryTestService) -> BinderPageRecoveryCoordinator {
        BinderPageRecoveryCoordinator(journal: journal, service: service)
    }

    private func conflictFrom(_ worker: BinderPageRecoveryCoordinator, attempt: DeferredBinderPageSave) async throws -> BinderPageRecoveryConflict {
        do {
            _ = try await worker.resume(id: attempt.id, scope: "account", config: config, token: "token", isCurrent: { true })
            XCTFail("Expected a newer-page conflict")
            throw APIService.APIError.decodingError
        } catch let conflict as BinderPageRecoveryConflict { return conflict }
    }

    private func makeAttempt() -> DeferredBinderPageSave {
        let card = Card(id: "printing-a", name: "Reviewed card", tcg: "pokemon", setCode: "S1", setName: "Set", rarity: "Rare", imageUrl: nil, imageUrlSmall: nil, price: nil, collectorNumber: "1", releasedAt: nil)
        let draft = InventoryIntakeDraft(operationId: "binder-attempt", collectionId: "binder", source: "scanner", rows: [InventoryIntakeRow(rowId: "detection-1", card: card, details: BinderCardAddDetails())])
        let point = BinderPagePoint(x: 0, y: 0)
        let quad = BinderPageQuad(topLeft: point, topRight: BinderPagePoint(x: 1, y: 0), bottomRight: BinderPagePoint(x: 1, y: 1), bottomLeft: BinderPagePoint(x: 0, y: 1))
        let placement = BinderPagePlacement(slotIndex: 0, cardId: card.id, name: card.name, tcg: card.tcg, setCode: card.setCode, confidence: 0.99, status: "matched", quad: quad)
        let page = DeferredBinderPage(pageNumber: 1, capturedAt: "2026-10-31T21:00:00Z", placements: [placement], detectionRowIDs: ["detection-1"], imageData: Data([0xff, 0xd8, 0x04, 0xff, 0xd9]), expectedRevision: 0, expectedPageID: nil)
        return DeferredBinderPageSave(intake: draft, pages: [page])
    }
}

@MainActor
private final class BinderRecoveryTestService: BinderPageRecoveryService {
    enum ImageFailure: Equatable { case beforeCommit, afterCommit }
    var imageFailure: ImageFailure?
    var failingImagePage: Int?
    var loseIntakeResponse = false
    var loseMetadataResponse = false
    var didReturnIntake: (() -> Void)?
    private(set) var intakeCalls = 0
    private(set) var intakeCommits = 0
    private(set) var metadataCalls = 0
    private(set) var imageCalls = 0
    private(set) var pageReads = 0
    private(set) var operationIDs: [String] = []
    private(set) var images: [Int: Data] = [:]
    private var receipts: [String: InventoryIntakeReceipt] = [:]
    private var pages: [Int: SavedBinderPage] = [:]

    func commitInventoryIntake(config: ServerConfiguration, token: String, draft: InventoryIntakeDraft) async throws -> InventoryIntakeReceipt {
        intakeCalls += 1
        operationIDs.append(draft.operationId)
        let receipt: InventoryIntakeReceipt
        if let existing = receipts[draft.operationId] { receipt = existing }
        else {
            intakeCommits += 1
            let rows = draft.rows.enumerated().map { InventoryIntakeReceipt.Row(rowId: $0.element.rowId, entryIds: ["physical-\($0.offset + 1)"]) }
            receipt = InventoryIntakeReceipt(operationId: draft.operationId, entryIds: rows.flatMap(\.entryIds), rows: rows)
            receipts[draft.operationId] = receipt
        }
        if loseIntakeResponse { loseIntakeResponse = false; throw URLError(.networkConnectionLost) }
        didReturnIntake?()
        return receipt
    }

    func getBinderPages(config: ServerConfiguration, token: String?, binderId: String) async throws -> [SavedBinderPage] {
        pageReads += 1
        return Array(pages.values)
    }

    func upsertBinderPage(config: ServerConfiguration, token: String?, binderId: String, pageNumber: Int, capturedAt: Date, placements: [BinderPagePlacement], expectedRevision: Int?) async throws -> SavedBinderPage {
        metadataCalls += 1
        let existing = pages[pageNumber]
        guard expectedRevision == (existing?.revision ?? 0) else { throw APIService.APIError.serverError(status: 409) }
        let page = SavedBinderPage(id: existing?.id ?? "page-\(pageNumber)", binderId: binderId, pageNumber: pageNumber, revision: (existing?.revision ?? 0) + 1, capturedAt: ISO8601DateFormatter().string(from: capturedAt), imageUrl: existing?.imageUrl, placements: placements, createdAt: "created", updatedAt: "metadata")
        pages[pageNumber] = page
        if loseMetadataResponse { loseMetadataResponse = false; throw URLError(.networkConnectionLost) }
        return page
    }

    func replaceBinderPageImage(config: ServerConfiguration, token: String?, binderId: String, pageNumber: Int, imageData: Data, expectedRevision: Int?) async throws -> SavedBinderPage {
        imageCalls += 1
        let shouldFail = failingImagePage == nil || failingImagePage == pageNumber
        if shouldFail && imageFailure == .beforeCommit { imageFailure = nil; throw URLError(.networkConnectionLost) }
        let existing = try XCTUnwrap(pages[pageNumber])
        guard expectedRevision == existing.revision else { throw APIService.APIError.serverError(status: 409) }
        let page = SavedBinderPage(id: existing.id, binderId: binderId, pageNumber: pageNumber, revision: existing.revision + 1, capturedAt: existing.capturedAt, imageUrl: "https://images.test/page-\(pageNumber)-\(existing.revision + 1).jpg", placements: existing.placements, createdAt: existing.createdAt, updatedAt: "image")
        pages[pageNumber] = page
        images[pageNumber] = imageData
        if shouldFail && imageFailure == .afterCommit { imageFailure = nil; throw URLError(.networkConnectionLost) }
        return page
    }

    func makeConcurrentEdit(pageNumber: Int) {
        guard let existing = pages[pageNumber] else { return }
        pages[pageNumber] = SavedBinderPage(id: existing.id, binderId: existing.binderId, pageNumber: pageNumber, revision: existing.revision + 1, capturedAt: existing.capturedAt, imageUrl: "https://images.test/newer-\(existing.revision + 1).jpg", placements: existing.placements, createdAt: existing.createdAt, updatedAt: "another device")
    }
}

private final class BinderRecoveryURLProtocol: URLProtocol, @unchecked Sendable {
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

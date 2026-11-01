import Foundation
import XCTest
@testable import TCGer

@MainActor
final class InventoryOperationTests: XCTestCase {
    func testSingleCopyPrintingCorrectionAndDeletionPreserveEverySiblingField() async throws {
        let repository = InventoryTestRepository()
        let store = LocalStore(persistenceRepository: repository)
        let binder = store.createCollection(name: "Copies", description: nil, colorHex: nil)
        let receipt = try store.commitInventoryIntake(intake(binder: binder.id, quantity: 2))
        let api = APIService(localStore: store)
        _ = try await api.updateCardInBinder(config: .onDevice, token: "local", binderId: binder.id, collectionCardId: receipt.entryIds[1], notes: "second copy", acquisitionPrice: 40, acquisitionCurrency: "CAD", acquiredAt: "2026-10-30T12:00:00Z", includeAcquisitionDetails: true)
        let before = try XCTUnwrap(store.getCollections().first(where: { $0.id == binder.id }))
        let sibling = try XCTUnwrap(before.cards.first?.copies.first)
        let selected = try XCTUnwrap(before.cards.first?.copies.last)
        _ = try await api.updateCardInBinder(config: .onDevice, token: "local", binderId: binder.id, collectionCardId: selected.id, newPrint: card(id: "printing-b"))
        let corrected = try XCTUnwrap(store.getCollections().first(where: { $0.id == binder.id }))
        XCTAssertEqual(corrected.cards.first(where: { $0.cardId == "printing-a" })?.copies, [sibling])
        XCTAssertEqual(corrected.cards.first(where: { $0.cardId == "printing-b" })?.copies, [selected])
        try await api.deleteCopyFromBinder(config: .onDevice, token: "local", binderId: binder.id, copyId: selected.id)
        let surviving = try XCTUnwrap(store.getCollections().first(where: { $0.id == binder.id }))
        XCTAssertEqual(surviving.cards.count, 1)
        XCTAssertEqual(surviving.cards[0].copies, [sibling])
        XCTAssertEqual(LocalStore(persistenceRepository: repository).getCollections(), store.getCollections())
    }

    func testSaleCommitsReceiptLedgerAndOnlySelectedCopyInOneWriteThenReplaysAfterRelaunch() throws {
        let repository = InventoryTestRepository()
        let store = LocalStore(persistenceRepository: repository)
        let binder = store.createCollection(name: "Sales", description: nil, colorHex: nil)
        let copies = try store.commitInventoryIntake(intake(binder: binder.id, quantity: 2)).entryIds
        let request = InventorySaleRequest(operationId: "sale-1", collectionId: binder.id, copyIds: [copies[1]], amount: 100, currency: "CAD", removeFromInventory: true, costBasis: 30, fees: 4, shippingCost: 6)
        let writes = repository.writes
        let receipt = try store.recordInventorySale(request)
        XCTAssertEqual(repository.writes, writes + 1)
        XCTAssertEqual(receipt.removedCopyIds, [copies[1]])
        XCTAssertEqual(store.getCollections().first(where: { $0.id == binder.id })?.cards.flatMap(\.copies).map(\.id), [copies[0]])
        XCTAssertEqual(store.getTransactions().first?.realizedProfit, 60)
        XCTAssertEqual(store.getTransactions().first?.currency, "CAD")
        let relaunched = LocalStore(persistenceRepository: repository)
        XCTAssertEqual(try relaunched.recordInventorySale(request), receipt)
        XCTAssertEqual(repository.writes, writes + 1)
        XCTAssertEqual(relaunched.getTransactions().count, 1)
        let changed = InventorySaleRequest(operationId: "sale-1", collectionId: binder.id, copyIds: [copies[1]], amount: 101, currency: "CAD", removeFromInventory: true)
        XCTAssertThrowsError(try relaunched.recordInventorySale(changed))
    }

    func testFailedSaleWriteRollsBackInventoryLedgerReceiptAndCounters() throws {
        let repository = InventoryTestRepository()
        let store = LocalStore(persistenceRepository: repository)
        let binder = store.createCollection(name: "Failure", description: nil, colorHex: nil)
        let copies = try store.commitInventoryIntake(intake(binder: binder.id, quantity: 2)).entryIds
        let before = try repository.load()
        let snapshot = store.getCollections()
        let request = InventorySaleRequest(operationId: "retry-sale", collectionId: binder.id, copyIds: copies, amount: 10, currency: "USD", removeFromInventory: true)
        repository.failWrites = true
        XCTAssertThrowsError(try store.recordInventorySale(request))
        XCTAssertEqual(store.getCollections(), snapshot)
        XCTAssertTrue(store.getTransactions().isEmpty)
        XCTAssertEqual(try repository.load(), before)
        repository.failWrites = false
        let receipt = try store.recordInventorySale(request)
        XCTAssertEqual(store.getTransactions().map(\.id), [receipt.transactionId])
        XCTAssertEqual(try LocalStore(persistenceRepository: repository).recordInventorySale(request), receipt)
    }

    func testIntakeFailureAndLostResponseRecoveryDoNotDuplicateCopies() throws {
        let repository = InventoryTestRepository()
        let store = LocalStore(persistenceRepository: repository)
        let binder = store.createCollection(name: "Intake", description: nil, colorHex: nil)
        let draft = InventoryIntakeDraft(operationId: "intake-metadata", collectionId: binder.id, source: "scanner", rows: [
            InventoryIntakeRow(rowId: "row-1", card: card(id: "printing-a"), details: BinderCardAddDetails(
                quantity: 3, condition: "LP", language: "EN", notes: "Reviewed copy", isFoil: true,
                isSigned: true, gradingCompany: "PSA", gradingScore: "9", certNumber: "certificate", storageLocation: "Box A"
            ))
        ])
        let before = try repository.load()
        repository.failWrites = true
        XCTAssertThrowsError(try store.commitInventoryIntake(draft))
        XCTAssertEqual(try repository.load(), before)
        XCTAssertTrue(store.getCollections().first(where: { $0.id == binder.id })!.cards.isEmpty)
        repository.failWrites = false
        let first = try store.commitInventoryIntake(draft)
        XCTAssertEqual(Set(first.entryIds).count, 3)
        let writes = repository.writes
        let restored = LocalStore(persistenceRepository: repository)
        XCTAssertEqual(try restored.commitInventoryIntake(draft), first)
        XCTAssertEqual(repository.writes, writes)
        let copies = try XCTUnwrap(restored.getCollections().first(where: { $0.id == binder.id })?.cards.flatMap(\.copies))
        XCTAssertEqual(copies.count, 3)
        XCTAssertTrue(copies.allSatisfy { $0.isFoil == true && $0.isSigned == true })
        XCTAssertTrue(copies.allSatisfy { $0.condition == "LP" && $0.language == "EN" && $0.notes == "Reviewed copy" })
        XCTAssertTrue(copies.allSatisfy { $0.gradingCompany == "PSA" && $0.gradingScore == "9" && $0.certNumber == "certificate" && $0.storageLocation == "Box A" })
    }

    func testLinkedPurchaseCurrencyAndUndoAreAtomicAndSeparateCurrencyTotals() async throws {
        let repository = InventoryTestRepository()
        let store = LocalStore(persistenceRepository: repository)
        let binder = store.createCollection(name: "Purchases", description: nil, colorHex: nil)
        let copyID = try XCTUnwrap(store.commitInventoryIntake(intake(binder: binder.id, quantity: 1)).entryIds.first)
        let api = APIService(localStore: store)
        let writes = repository.writes
        let purchase = try await api.createTransaction(config: .onDevice, token: "local", type: "purchase", collectionEntryId: copyID, cardId: "printing-a", quantity: 1, amount: 45, currency: "CAD", date: "2026-10-30T12:00:00Z")
        XCTAssertEqual(repository.writes, writes + 1)
        let replay = try await api.createTransaction(config: .onDevice, token: "local", type: "purchase", collectionEntryId: copyID, cardId: "printing-a", quantity: 1, amount: 45, currency: "CAD", date: "2026-10-30T12:00:00Z")
        XCTAssertEqual(replay.id, purchase.id)
        XCTAssertEqual(repository.writes, writes + 1)
        let copy = try XCTUnwrap(store.getCollections().first(where: { $0.id == binder.id })?.cards.first?.copies.first)
        XCTAssertEqual(copy.acquisitionPrice, 45)
        XCTAssertEqual(copy.acquisitionCurrency, "CAD")
        XCTAssertEqual(store.getRealizedPerformance().inventoryCost, 0)
        XCTAssertEqual(store.getRealizedPerformance().inventoryCostsByCurrency?.first?.currency, "CAD")
        XCTAssertEqual(store.getRealizedPerformance().inventoryCostsByCurrency?.first?.cost, 45)
        XCTAssertEqual(store.getFinanceSummary().totalSpent, 0, "The compatibility scalar contains only USD")
        let cadSummary = try XCTUnwrap(store.getFinanceSummaryByCurrency().byCurrency.first)
        XCTAssertEqual(cadSummary.currency, "CAD")
        XCTAssertEqual(cadSummary.totalSpent, 45)
        XCTAssertEqual(cadSummary.profitLoss, -45)
        let before = try repository.load()
        repository.failWrites = true
        do { try await api.deleteTransaction(config: .onDevice, token: "local", transactionId: purchase.id); XCTFail("Expected failure") }
        catch { }
        XCTAssertEqual(try repository.load(), before)
        XCTAssertEqual(store.getTransactions().count, 1)
        repository.failWrites = false
        try await api.deleteTransaction(config: .onDevice, token: "local", transactionId: purchase.id)
        let cleared = try XCTUnwrap(store.getCollections().first(where: { $0.id == binder.id })?.cards.first?.copies.first)
        XCTAssertNil(cleared.acquisitionPrice)
        XCTAssertNil(cleared.acquisitionCurrency)
        XCTAssertTrue(store.getTransactions().isEmpty)
    }

    func testJournalScopesAccountsAndFreezesRetryPayload() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let journal = InventoryOperationJournal(directory: directory)
        let config = ServerConfiguration(baseURL: "https://example.test/api")
        let a = InventoryOperationJournal.scope(config: config, userID: "a", token: "secret-a")
        let b = InventoryOperationJournal.scope(config: config, userID: "b", token: "secret-b")
        let draft = intake(binder: "binder", quantity: 2)
        try journal.save(.intake(draft), scope: a)
        try journal.save(.intake(draft), scope: a)
        XCTAssertEqual(try journal.pending(scope: a).count, 1)
        XCTAssertTrue(try journal.pending(scope: b).isEmpty)
        let changed = InventoryIntakeDraft(operationId: draft.operationId, collectionId: "other", source: draft.source, rows: draft.rows)
        XCTAssertThrowsError(try journal.save(.intake(changed), scope: a))
        let restored = InventoryOperationJournal(directory: directory)
        XCTAssertEqual(try restored.pending(scope: a).first?.id, draft.operationId)
        XCTAssertFalse(a.contains("secret"))
        XCTAssertEqual(a, InventoryOperationJournal.scope(config: ServerConfiguration(baseURL: "https://EXAMPLE.test:443/api/"), userID: "a", token: "rotated-token"))
    }

    func testAcquisitionCurrencyAndPhysicalMetadataSurviveCSVAndPortableRelaunch() throws {
        let csv = """
        tcg,external_id,card_name,binder_name,quantity,acquisition_price,acquisition_currency,serial_number,acquired_at,notes
        pokemon,printing-a,Test Card,Import,1,40,CAD,serial-A,2026-10-29T00:00:00Z,First copy
        pokemon,printing-a,Test Card,Import,1,40,USD,serial-B,2026-10-30T00:00:00Z,Second copy
        """
        let repository = InventoryTestRepository()
        let store = LocalStore(persistenceRepository: repository)
        let options = APIService.CollectionImportOptions(defaultBinderId: nil, createMissingBinders: true)
        let result = store.commitImport(csv: csv, options: options)
        XCTAssertTrue(result.valid)
        XCTAssertEqual(result.importedRows, 2, "Distinct acquisition currencies and metadata must not merge")
        let copies = store.getCollections().flatMap(\.cards).flatMap(\.copies)
        XCTAssertEqual(Set(copies.compactMap(\.acquisitionCurrency)), Set(["CAD", "USD"]))
        XCTAssertEqual(Set(copies.compactMap(\.serialNumber)), Set(["serial-A", "serial-B"]))
        XCTAssertEqual(Set(copies.compactMap(\.notes)), Set(["First copy", "Second copy"]))
        let restoredRepository = InventoryTestRepository()
        let restored = LocalStore(persistenceRepository: restoredRepository)
        let backup = try store.exportPortableBackup()
        let document = try XCTUnwrap(JSONSerialization.jsonObject(with: backup) as? [String: Any])
        let exportedBinders = try XCTUnwrap(document["binders"] as? [[String: Any]])
        let exportedRows = exportedBinders.flatMap { $0["cards"] as? [[String: Any]] ?? [] }
        XCTAssertEqual(Set(exportedRows.compactMap { $0["acquisitionCurrency"] as? String }), Set(["CAD", "USD"]))
        try restored.importPortableBackup(backup)
        try restored.importPortableBackup(backup)
        XCTAssertEqual(LocalStore(persistenceRepository: restoredRepository).getCollections().flatMap(\.cards).flatMap(\.copies), copies)
        let csvRestored = LocalStore(persistenceRepository: InventoryTestRepository())
        let exportedCSV = try XCTUnwrap(String(data: store.exportCollections(format: "csv"), encoding: .utf8))
        XCTAssertTrue(csvRestored.commitImport(csv: exportedCSV, options: options).valid)
        let recaptured = csvRestored.getCollections().flatMap(\.cards).flatMap(\.copies)
        XCTAssertEqual(Set(recaptured.compactMap(\.acquisitionCurrency)), Set(["CAD", "USD"]))
        XCTAssertEqual(Set(recaptured.compactMap(\.acquiredAt)), Set(copies.compactMap(\.acquiredAt)))
        XCTAssertEqual(Set(recaptured.compactMap(\.serialNumber)), Set(copies.compactMap(\.serialNumber)))
    }

    func testLegacyUnknownCurrencyIsRetainedAndCannotBecomeAnInferredUSDCost() throws {
        let store = LocalStore(persistenceRepository: InventoryTestRepository())
        let binder = store.createCollection(name: "Unknown cost", description: nil, colorHex: nil)
        try store.addCardToBinder(binderId: binder.id, cardId: "printing-a", quantity: 1, condition: nil, language: nil, notes: nil, price: 50, acquisitionPrice: 40, isSigned: nil, isAltered: nil, tagIds: nil, newTags: nil, card: card(id: "printing-a"))
        let copy = try XCTUnwrap(store.getCollections().first(where: { $0.id == binder.id })?.cards.first?.copies.first)
        XCTAssertNil(copy.acquisitionCurrency)
        XCTAssertEqual(store.getRealizedPerformance().inventoryCost, 0)
        XCTAssertEqual(store.getRealizedPerformance().inventoryCostsByCurrency?.first?.currency, "UNKNOWN")
        let restored = LocalStore(persistenceRepository: InventoryTestRepository())
        try restored.importPortableBackup(store.exportPortableBackup())
        XCTAssertNil(restored.getCollections().first(where: { $0.id == binder.id })?.cards.first?.copies.first?.acquisitionCurrency)
        _ = try store.recordInventorySale(InventorySaleRequest(operationId: "unknown-sale", collectionId: binder.id, copyIds: [copy.id], amount: 60, currency: "USD", removeFromInventory: false))
        XCTAssertNil(store.getTransactions().first?.costBasis)
        XCTAssertNil(store.getTransactions().first?.realizedProfit)
    }

    func testSimulationHistoryCannotChangeOwnedInventory() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let repository = InventoryTestRepository()
        let store = LocalStore(persistenceRepository: repository)
        _ = store.createCollection(name: "Owned", description: nil, colorHex: nil)
        let before = try repository.load()
        let simulations = PackSimulationStore(file: directory.appendingPathComponent("history.json"))
        let session = PackOpeningPullSession(id: "simulation", packLabel: "Test pack", openedAt: "2026-10-30", packs: [[]], packClasses: nil, recap: nil)
        try simulations.save(session)
        try simulations.save(session)
        try simulations.favorite(card(id: "printing-a"))
        XCTAssertEqual(try simulations.history().sessions.count, 1)
        XCTAssertEqual(try simulations.history().favorites.count, 1)
        XCTAssertEqual(try repository.load(), before)
        XCTAssertTrue(store.getTransactions().isEmpty)
    }

    private func intake(binder: String, quantity: Int) -> InventoryIntakeDraft {
        InventoryIntakeDraft(operationId: "intake-1", collectionId: binder, source: "scanner", rows: [InventoryIntakeRow(rowId: "row-1", card: card(id: "printing-a"), details: BinderCardAddDetails(quantity: quantity, condition: "Near Mint", language: "English", notes: "Original note"))])
    }

    private func card(id: String) -> Card {
        Card(id: id, name: "Card \(id)", tcg: "pokemon", setCode: "S1", setName: "Set", rarity: "Rare", imageUrl: nil, imageUrlSmall: nil, price: 10, collectorNumber: "1", releasedAt: nil)
    }
}

private final class InventoryTestRepository: LocalStorePersistenceRepository {
    var failWrites = false
    private(set) var writes = 0
    private var payload: Data?
    func load() throws -> Data? { payload }
    func save(_ payload: Data) throws {
        if failWrites { throw CocoaError(.fileWriteNoPermission) }
        writes += 1
        self.payload = payload
    }
    func remove() throws { payload = nil }
    func availableBackups() throws -> [URL] { [] }
    func createBackup(_ payload: Data) throws -> URL { throw CocoaError(.fileWriteUnsupportedScheme) }
    func loadBackup(at url: URL) throws -> Data { throw CocoaError(.fileReadNoSuchFile) }
    func removeBackup(at url: URL) throws { }
}

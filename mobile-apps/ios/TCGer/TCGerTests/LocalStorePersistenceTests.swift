import XCTest
@testable import TCGer

@MainActor
final class LocalStorePersistenceTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TCGerPersistenceTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        if let root, FileManager.default.fileExists(atPath: root.path) {
            try FileManager.default.removeItem(at: root)
        }
        root = nil
    }

    func testRepositoryWritesAtomicallyAndRotatesVersionedBackups() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 2)
        let first = Data(#"{"revision":1}"#.utf8)
        let second = Data(#"{"revision":2}"#.utf8)
        let third = Data(#"{"revision":3}"#.utf8)
        let fourth = Data(#"{"revision":4}"#.utf8)

        try repository.save(first)
        XCTAssertEqual(try repository.load(), first)

        try repository.save(second)
        try repository.save(third)
        try repository.save(fourth)

        XCTAssertEqual(try repository.load(), fourth)
        let backups = try repository.availableBackups()
        XCTAssertEqual(backups.count, 2)
        let payloads = try backups.map { try repository.loadBackup(at: $0) }
        XCTAssertTrue(payloads.contains(second))
        XCTAssertTrue(payloads.contains(third))
    }

    func testLocalStoreRestoreValidatesThenReplacesCurrentState() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 3)
        let store = LocalStore(persistenceRepository: repository)

        _ = store.createCollection(name: "Before backup", description: nil, colorHex: nil)
        _ = store.createCollection(name: "After backup", description: nil, colorHex: nil)
        let backup = try XCTUnwrap(store.availableLocalBackups().first)

        try store.restoreLocalBackup(from: backup)

        let names = Set(store.getCollections().map(\.name))
        XCTAssertTrue(names.contains("Before backup"))
        XCTAssertFalse(names.contains("After backup"))
        XCTAssertNil(store.persistenceFailure)
    }

    func testInvalidRestoreLeavesCurrentStateUntouchedAndSurfacesFailure() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 3)
        let store = LocalStore(persistenceRepository: repository)
        _ = store.createCollection(name: "Keep me", description: nil, colorHex: nil)

        let backupDirectory = root.appendingPathComponent("TCGerLocalStoreBackups", isDirectory: true)
        try FileManager.default.createDirectory(at: backupDirectory, withIntermediateDirectories: true)
        let invalidBackup = backupDirectory.appendingPathComponent("invalid.json")
        try Data("not-json".utf8).write(to: invalidBackup, options: [.atomic])

        XCTAssertThrowsError(try store.restoreLocalBackup(from: invalidBackup))
        XCTAssertTrue(store.getCollections().contains { $0.name == "Keep me" })
        XCTAssertEqual(store.persistenceFailure?.operation, .restore)
    }

    func testPortableBackupRestoresCollectionWishlistAndCodeVault() throws {
        let sourceRoot = root.appendingPathComponent("source", isDirectory: true)
        let destinationRoot = root.appendingPathComponent("destination", isDirectory: true)
        let source = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: sourceRoot))
        let destination = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: destinationRoot))

        _ = source.createCollection(name: "Travel Binder", description: nil, colorHex: nil)
        _ = source.createWishlist(name: "Chase Cards", description: nil, colorHex: nil)
        _ = try source.createOnlineCodes(
            tcg: "pokemon",
            codes: ["ABCD-1234-EFGH"],
            source: .manual,
            productName: "Booster Box",
            notes: "Keep safe"
        )
        _ = destination.createCollection(name: "Replace Me", description: nil, colorHex: nil)

        let backup = try source.exportPortableBackup()
        let summary = try destination.portableBackupSummary(from: backup)
        XCTAssertEqual(summary.binderCount, 1)
        XCTAssertEqual(summary.wishlistCount, 1)
        XCTAssertEqual(summary.onlineCodeCount, 1)

        try destination.importPortableBackup(backup)

        XCTAssertTrue(destination.getCollections().contains { $0.name == "Travel Binder" })
        XCTAssertFalse(destination.getCollections().contains { $0.name == "Replace Me" })
        XCTAssertEqual(destination.getWishlists().map(\.name), ["Chase Cards"])
        XCTAssertEqual(destination.getOnlineCodes().map(\.code), ["ABCD-1234-EFGH"])
        XCTAssertEqual(try destination.availableLocalBackups().count, 1)
        XCTAssertNil(destination.persistenceFailure)
    }

    func testPortableBackupRejectsInvalidDataWithoutReplacingCurrentLibrary() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 3)
        let store = LocalStore(persistenceRepository: repository)
        _ = store.createCollection(name: "Keep Me", description: nil, colorHex: nil)

        XCTAssertThrowsError(try store.importPortableBackup(Data(#"{"not":"a backup"}"#.utf8))) { error in
            XCTAssertEqual(error as? LocalDataTransferError, .invalidBackup)
        }
        XCTAssertTrue(store.getCollections().contains { $0.name == "Keep Me" })
        XCTAssertEqual(store.persistenceFailure?.operation, .restore)
    }

    func testWriteFailureRollsBackInMemoryStateAndIsObservable() {
        let store = LocalStore(persistenceRepository: FailingPersistenceRepository())

        let returnedCollection = store.createCollection(name: "Unsaved", description: nil, colorHex: nil)

        XCTAssertEqual(store.persistenceFailure?.operation, .save)
        XCTAssertEqual(store.persistenceFailure?.message, "The test write failed.")
        XCTAssertEqual(returnedCollection.name, "Unsaved", "Legacy direct calls still receive their optimistic value")
        XCTAssertFalse(store.getCollections().contains { $0.name == "Unsaved" })
        XCTAssertThrowsError(try store.requireLatestMutationPersisted()) { error in
            XCTAssertEqual(
                error as? LocalStorePersistenceError,
                .saveFailed("The test write failed.")
            )
        }
    }

    func testFailedUpdateRestoresLastSuccessfullySavedSnapshot() throws {
        let repository = ToggleablePersistenceRepository()
        let store = LocalStore(persistenceRepository: repository)
        let saved = store.createCollection(name: "Durable", description: nil, colorHex: nil)
        XCTAssertNoThrow(try store.requireLatestMutationPersisted())

        repository.shouldFail = true
        XCTAssertThrowsError(try store.updateCollection(
            id: saved.id,
            name: "Unsaved rename",
            description: nil,
            colorHex: nil
        ))

        XCTAssertEqual(try store.getCollection(id: saved.id).name, "Durable")
        XCTAssertEqual(store.persistenceFailure?.operation, .save)
    }

    func testPhoneOnlyImportPersistsBindersTagsAndRowsWithOneWrite() throws {
        let repository = CountingPersistenceRepository()
        let store = LocalStore(persistenceRepository: repository)
        let csv = """
        tcg,external_id,card_name,binder_name,quantity,tags
        pokemon,poke-1,Pikachu,Imported Binder,2,Favorite
        magic,mtg-1,Black Lotus,Imported Binder,1,Valuable
        """

        let result = store.commitImport(
            csv: csv,
            options: APIService.CollectionImportOptions(
                defaultBinderId: nil,
                createMissingBinders: true
            )
        )

        XCTAssertTrue(result.valid)
        XCTAssertEqual(result.importedRows, 2)
        XCTAssertEqual(result.importedCopies, 3)
        XCTAssertEqual(result.createdBinders, ["Imported Binder"])
        XCTAssertEqual(repository.saveAttempts, 1)

        let importedBinder = try XCTUnwrap(
            store.getCollections().first { $0.name == "Imported Binder" }
        )
        XCTAssertEqual(importedBinder.cards.count, 2)
        XCTAssertEqual(importedBinder.cards.reduce(0) { $0 + $1.quantity }, 3)
        XCTAssertTrue(store.getTags().contains { $0.label == "Favorite" })
        XCTAssertTrue(store.getTags().contains { $0.label == "Valuable" })
    }

    func testPhoneOnlyImportWriteFailureRollsBackWholeBatch() throws {
        let repository = CountingPersistenceRepository()
        let store = LocalStore(persistenceRepository: repository)
        _ = store.createCollection(name: "Already Durable", description: nil, colorHex: nil)
        XCTAssertEqual(repository.saveAttempts, 1)
        repository.shouldFail = true

        let result = store.commitImport(
            csv: """
            tcg,external_id,card_name,binder_name,quantity,tags
            pokemon,poke-1,Pikachu,Must Roll Back,2,Temporary Tag
            magic,mtg-1,Black Lotus,Must Roll Back,1,Another Tag
            """,
            options: APIService.CollectionImportOptions(
                defaultBinderId: nil,
                createMissingBinders: true
            )
        )

        XCTAssertFalse(result.valid)
        XCTAssertEqual(result.importedRows, 0)
        XCTAssertEqual(result.importedCopies, 0)
        XCTAssertTrue(result.createdBinders.isEmpty)
        XCTAssertEqual(repository.saveAttempts, 2, "The batch should make only one failing write attempt")
        XCTAssertTrue(store.getCollections().contains { $0.name == "Already Durable" })
        XCTAssertFalse(store.getCollections().contains { $0.name == "Must Roll Back" })
        XCTAssertFalse(store.getTags().contains { $0.label == "Temporary Tag" })
        XCTAssertFalse(store.getTags().contains { $0.label == "Another Tag" })
        XCTAssertThrowsError(try store.requireLatestMutationPersisted())
    }

    func testBackupsAreOrderedByModificationDateRatherThanProcessUptime() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 3)
        try repository.save(Data(#"{"revision":1}"#.utf8))
        try repository.save(Data(#"{"revision":2}"#.utf8))
        try repository.save(Data(#"{"revision":3}"#.utf8))

        var backups = try repository.availableBackups()
        XCTAssertEqual(backups.count, 2)
        let olderByName = backups[1]
        try FileManager.default.setAttributes(
            [.modificationDate: Date().addingTimeInterval(60)],
            ofItemAtPath: olderByName.path
        )

        backups = try repository.availableBackups()
        XCTAssertEqual(backups.first, olderByName)
    }

    func testManualRecoveryPointCanBeCreatedAndRemoved() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 2)
        let payload = Data(#"{"revision":1}"#.utf8)

        let recoveryPoint = try repository.createBackup(payload)

        XCTAssertEqual(try repository.availableBackups(), [recoveryPoint])
        XCTAssertEqual(try repository.loadBackup(at: recoveryPoint), payload)

        try repository.removeBackup(at: recoveryPoint)
        XCTAssertTrue(try repository.availableBackups().isEmpty)
    }

    func testRecoveryPointDeletionRejectsFilesOutsideBackupDirectory() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 2)
        let outsideFile = root.appendingPathComponent("snapshot-outside.json")
        try Data("keep".utf8).write(to: outsideFile)

        XCTAssertThrowsError(try repository.removeBackup(at: outsideFile)) { error in
            XCTAssertEqual(error as? LocalStorePersistenceError, .backupOutsideRepository)
        }
        XCTAssertTrue(FileManager.default.fileExists(atPath: outsideFile.path))
    }

    func testPersistableCredentialsNeverContainThePassword() throws {
        let credentials = LoginCredentials(username: "collector", password: "secret")
        let data = try JSONEncoder().encode(credentials.withoutPassword)
        let decoded = try JSONDecoder().decode(LoginCredentials.self, from: data)

        XCTAssertEqual(decoded.username, "collector")
        XCTAssertEqual(decoded.password, "")
    }

    func testPhoneOnlyAnalyticsNeverFabricateHistoryOrMovers() async throws {
        // The shared store can retain optional sample data in the simulator
        // between test runs. Normalize that state so this test exercises the
        // real phone-only analytics path regardless of run order or device
        // contents, then put the sample data back for any later tests.
        let store = LocalStore.shared
        let wasSampleDataLoaded = store.isSampleDataLoaded
        if wasSampleDataLoaded {
            store.removeSampleData()
        }
        defer {
            if wasSampleDataLoaded {
                store.loadSampleData()
            }
        }

        let service = APIService()
        let configuration = ServerConfiguration(baseURL: ServerConfiguration.onDeviceBaseURL)

        let history = try await service.getCollectionValueHistory(
            config: configuration,
            token: "local",
            period: "30d"
        )
        let movers = try await service.getPriceMovers(
            config: configuration,
            token: "local",
            period: 30
        )

        XCTAssertTrue(history.history.isEmpty)
        XCTAssertEqual(history.changePercent, 0)
        XCTAssertTrue(movers.gainers.isEmpty)
        XCTAssertTrue(movers.losers.isEmpty)
    }

    func testSealedInventoryUpdateCanClearOptionalPurchaseFields() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 2)
        let store = LocalStore(persistenceRepository: repository)
        store.loadSampleData()
        let item = try XCTUnwrap(store.getSealedInventory().first { $0.purchasePrice != nil })

        let updated = try store.updateSealedInventory(
            itemId: item.id,
            quantity: item.quantity + 1,
            purchasePrice: nil,
            purchaseDate: nil,
            notes: nil,
            clearPurchasePrice: true,
            clearPurchaseDate: true,
            clearNotes: true
        )

        XCTAssertEqual(updated.quantity, item.quantity + 1)
        XCTAssertNil(updated.purchasePrice)
        XCTAssertNil(updated.purchaseDate)
        XCTAssertNil(updated.notes)
        XCTAssertEqual(store.getSealedInventory().first { $0.id == item.id }, updated)
        XCTAssertNoThrow(try store.requireLatestMutationPersisted())
    }
}

private struct FailingPersistenceRepository: LocalStorePersistenceRepository {
    private struct WriteFailure: LocalizedError {
        var errorDescription: String? { "The test write failed." }
    }

    func load() throws -> Data? { nil }
    func save(_ payload: Data) throws { throw WriteFailure() }
    func remove() throws {}
    func availableBackups() throws -> [URL] { [] }
    func createBackup(_ payload: Data) throws -> URL { throw WriteFailure() }
    func loadBackup(at url: URL) throws -> Data { throw WriteFailure() }
    func removeBackup(at url: URL) throws { throw WriteFailure() }
}

private final class ToggleablePersistenceRepository: LocalStorePersistenceRepository {
    private struct WriteFailure: LocalizedError {
        var errorDescription: String? { "The test write failed." }
    }

    var shouldFail = false
    private var payload: Data?

    func load() throws -> Data? { payload }

    func save(_ payload: Data) throws {
        if shouldFail { throw WriteFailure() }
        self.payload = payload
    }

    func remove() throws { payload = nil }
    func availableBackups() throws -> [URL] { [] }
    func createBackup(_ payload: Data) throws -> URL { throw WriteFailure() }
    func loadBackup(at url: URL) throws -> Data { throw WriteFailure() }
    func removeBackup(at url: URL) throws { throw WriteFailure() }
}

private final class CountingPersistenceRepository: LocalStorePersistenceRepository {
    private struct WriteFailure: LocalizedError {
        var errorDescription: String? { "The counted write failed." }
    }

    var shouldFail = false
    private(set) var saveAttempts = 0
    private var payload: Data?

    func load() throws -> Data? { payload }

    func save(_ payload: Data) throws {
        saveAttempts += 1
        if shouldFail { throw WriteFailure() }
        self.payload = payload
    }

    func remove() throws { payload = nil }
    func availableBackups() throws -> [URL] { [] }
    func createBackup(_ payload: Data) throws -> URL { throw WriteFailure() }
    func loadBackup(at url: URL) throws -> Data { throw WriteFailure() }
    func removeBackup(at url: URL) throws { throw WriteFailure() }
}

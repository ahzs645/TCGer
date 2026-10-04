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

    func testBackupRotationFailurePrecedesLiveCommitAndKeepsMemoryConsistent() throws {
        let manager = RotationFailureFileManager()
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 1, fileManager: manager)
        let store = LocalStore(persistenceRepository: repository)
        _ = store.createCollection(name: "First", description: nil, colorHex: nil)
        _ = store.createCollection(name: "Second", description: nil, colorHex: nil)
        let before = try repository.load()
        manager.failRemoval = true
        _ = store.createCollection(name: "Rejected", description: nil, colorHex: nil)
        XCTAssertThrowsError(try store.requireLatestMutationPersisted())
        XCTAssertEqual(try repository.load(), before)
        XCTAssertFalse(store.getCollections().contains { $0.name == "Rejected" })
        let relaunched = LocalStore(persistenceRepository: repository)
        XCTAssertEqual(store.getCollections(), relaunched.getCollections())
    }

    func testRemovingExpiredRecoveryPointsReleasesOnlyUnreferencedPhotoFiles() throws {
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root, maxBackups: 10)
        let store = LocalStore(persistenceRepository: repository)
        let binder = store.createCollection(name: "Photos", description: nil, colorHex: nil)
        _ = store.upsertBinderPage(binderId: binder.id, pageNumber: 1, capturedAt: Date(), placements: [])
        let first = try store.replaceBinderPageImage(binderId: binder.id, pageNumber: 1, imageData: Data("A".utf8))
        _ = try store.createLocalBackup()
        let second = try store.replaceBinderPageImage(binderId: binder.id, pageNumber: 1, imageData: Data("B".utf8))
        let a = try XCTUnwrap(URL(string: try XCTUnwrap(first.imageUrl)))
        let b = try XCTUnwrap(URL(string: try XCTUnwrap(second.imageUrl)))
        XCTAssertTrue(FileManager.default.fileExists(atPath: a.path))
        for backup in try store.availableLocalBackups() { try store.removeLocalBackup(at: backup) }
        XCTAssertFalse(FileManager.default.fileExists(atPath: a.path))
        XCTAssertEqual(try Data(contentsOf: b), Data("B".utf8))
    }

    func testRecoveryRetainsPhotoBytesAfterReplaceRemoveAndBinderDeletion() throws {
        for operation in ["replace", "remove", "delete"] {
            let repository = FileLocalStorePersistenceRepository(rootDirectory: root.appendingPathComponent(operation), maxBackups: 10)
            let store = LocalStore(persistenceRepository: repository)
            let binder = store.createCollection(name: "Photos", description: nil, colorHex: nil)
            _ = store.upsertBinderPage(binderId: binder.id, pageNumber: 1, capturedAt: Date(), placements: [])
            let original = Data("immutable photo A".utf8)
            let page = try store.replaceBinderPageImage(binderId: binder.id, pageNumber: 1, imageData: original)
            let imageURL = try XCTUnwrap(URL(string: try XCTUnwrap(page.imageUrl)))
            defer { try? FileManager.default.removeItem(at: imageURL) }
            let backup = try store.createLocalBackup()
            switch operation {
            case "replace":
                _ = try store.replaceBinderPageImage(binderId: binder.id, pageNumber: 1, imageData: Data("B".utf8))
            case "remove": store.removeBinderPageImage(binderId: binder.id, pageNumber: 1)
            default: try store.deleteCollection(id: binder.id)
            }
            try store.restoreLocalBackup(from: backup)
            let relaunched = LocalStore(persistenceRepository: repository)
            let restored = try XCTUnwrap(relaunched.getBinderPages(binderId: binder.id).first?.imageUrl)
            XCTAssertEqual(try Data(contentsOf: XCTUnwrap(URL(string: restored))), original)
        }
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

        try destination.importPortableBackup(backup, mode: .replace)

        XCTAssertTrue(destination.getCollections().contains { $0.name == "Travel Binder" })
        XCTAssertFalse(destination.getCollections().contains { $0.name == "Replace Me" })
        XCTAssertEqual(destination.getWishlists().map(\.name), ["Chase Cards"])
        XCTAssertEqual(destination.getOnlineCodes().map(\.code), ["ABCD-1234-EFGH"])
        XCTAssertEqual(try destination.availableLocalBackups().count, 1)
        XCTAssertNil(destination.persistenceFailure)
    }

    func testSharedMergeFixturePreservesMovesAndUpdatesPhysicalCopies() throws {
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: directory.appendingPathComponent("mobile-parity").path), directory.path != "/" { directory.deleteLastPathComponent() }
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("mobile-parity/fixtures/portable-backup-merge-v2.json"))) as? [String: Any])
        let before = try XCTUnwrap(fixture["before"] as? [String: Any])
        let incoming = try XCTUnwrap(fixture["incoming"] as? [String: Any])
        let expected = try XCTUnwrap(fixture["expected"] as? [String: Any])
        let store = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root))
        try store.importPortableBackup(JSONSerialization.data(withJSONObject: before), mode: .replace)
        try store.importPortableBackup(JSONSerialization.data(withJSONObject: incoming))
        try store.importPortableBackup(JSONSerialization.data(withJSONObject: incoming))
        let output = try XCTUnwrap(JSONSerialization.jsonObject(with: store.exportPortableBackup()) as? [String: Any])
        let binders = try XCTUnwrap(output["binders"] as? [[String: Any]])
        XCTAssertEqual(binders.compactMap { $0["id"] as? String }, expected["binderIDs"] as? [String])
        let copies = binders.flatMap { $0["cards"] as? [[String: Any]] ?? [] }
        XCTAssertEqual(copies.count, 4)
        XCTAssertEqual(Set(copies.compactMap { $0["id"] as? String }), Set(expected["copyIDs"] as? [String] ?? []))
        XCTAssertEqual(copies.first { $0["id"] as? String == expected["updatedCopyID"] as? String }?["price"] as? Int, 77)
    }

    func testExplicitReplacementDoesNotRetainOldUnsortedCards() throws {
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: directory.appendingPathComponent("mobile-parity").path), directory.path != "/" { directory.deleteLastPathComponent() }
        let fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent("mobile-parity/fixtures/portable-backup-merge-v2.json"))) as? [String: Any])
        var before = try XCTUnwrap(fixture["before"] as? [String: Any])
        var library = try XCTUnwrap((before["binders"] as? [[String: Any]])?.first)
        library["id"] = "__library__"
        before["binders"] = [library]
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root)
        let store = LocalStore(persistenceRepository: repository)
        try store.importPortableBackup(JSONSerialization.data(withJSONObject: before), mode: .replace)
        XCTAssertFalse(store.getCollections().first { $0.isUnsortedBinder }!.cards.isEmpty)
        let empty = Data(#"{"format":"com.tcger.portable-backup","formatVersion":2,"binders":[],"wishlists":[],"sealedInventory":[],"sections":{}}"#.utf8)
        try store.importPortableBackup(empty, mode: .replace)
        XCTAssertTrue(store.getCollections().allSatisfy { $0.cards.isEmpty })
        XCTAssertEqual(store.getCollections(), LocalStore(persistenceRepository: repository).getCollections())
    }

    func testDefaultImportMergesUnrelatedRecordsAndRepeatedImportIsIdempotent() throws {
        let source = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root.appendingPathComponent("source")))
        _ = source.createCollection(name: "Imported", description: nil, colorHex: nil)
        let target = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root.appendingPathComponent("target")))
        _ = target.createCollection(name: "Collision", description: nil, colorHex: nil)
        _ = target.createCollection(name: "Unrelated", description: nil, colorHex: nil)
        _ = source.createWishlist(name: "Imported list", description: nil, colorHex: nil)
        _ = target.createWishlist(name: "Collision list", description: nil, colorHex: nil)
        _ = target.createWishlist(name: "Unrelated list", description: nil, colorHex: nil)
        let backup = try source.exportPortableBackup()
        try target.importPortableBackup(backup)
        try target.importPortableBackup(backup)
        XCTAssertEqual(Set(target.getCollections().filter { !$0.isUnsortedBinder }.map(\.name)), ["Imported", "Unrelated"])
        XCTAssertEqual(target.getCollections().filter { !$0.isUnsortedBinder }.count, 2)
        let newList = target.createWishlist(name: "After import", description: nil, colorHex: nil)
        XCTAssertEqual(newList.id, "local-wishlist-3")
        XCTAssertEqual(target.getWishlists().count, 3)
        let relaunched = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root.appendingPathComponent("target")))
        XCTAssertEqual(target.getCollections(), relaunched.getCollections())
        let disk = try XCTUnwrap(FileLocalStorePersistenceRepository(rootDirectory: root.appendingPathComponent("target")).load())
        let state = try XCTUnwrap(JSONSerialization.jsonObject(with: disk) as? [String: Any])
        XCTAssertTrue((state["collections"] as? [[String: Any]] ?? []).contains { $0["id"] as? String == "__library__" })
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

    func testSharedPortableFixtureRetainsCopiesGamesAndUnknownSections() throws {
        var directory = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        while !FileManager.default.fileExists(atPath: directory.appendingPathComponent("mobile-parity").path), directory.path != "/" {
            directory.deleteLastPathComponent()
        }
        let fixture = try Data(contentsOf: directory.appendingPathComponent("mobile-parity/fixtures/portable-backup-v2.json"))
        let store = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root))
        try store.importPortableBackup(fixture)
        try store.importPortableBackup(fixture)
        let exported = try XCTUnwrap(JSONSerialization.jsonObject(with: store.exportPortableBackup()) as? [String: Any])
        let binders = try XCTUnwrap(exported["binders"] as? [[String: Any]])
        let copies = try XCTUnwrap(binders.first?["cards"] as? [[String: Any]])
        XCTAssertEqual(copies.count, 3)
        XCTAssertEqual(Set(copies.compactMap { $0["id"] as? String }).count, 3)
        XCTAssertEqual(Set(copies.compactMap { ($0["card"] as? [String: Any])?["tcg"] as? String }), ["pokemon", "magic"])
        XCTAssertNotNil((exported["sections"] as? [String: Any])?["futureFeature"])
        let pokemon = try XCTUnwrap(store.getCollections().first?.cards.first { $0.tcg == "pokemon" })
        let unconditionedCopy = try XCTUnwrap(pokemon.copies.first { $0.condition == nil })
        XCTAssertFalse(SmartFolderRule(id: UUID(), type: .condition, value: "LP").matches(card: pokemon, copy: unconditionedCopy))
    }

    func testMalformedSmartFolderIsRejectedBeforeImportChangesState() throws {
        let store = LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: root))
        _ = store.createCollection(name: "Keep me", description: nil, colorHex: nil)
        var document = try XCTUnwrap(JSONSerialization.jsonObject(with: store.exportPortableBackup()) as? [String: Any])
        document["binders"] = []
        document["sections"] = ["smartFolders": [["name": "Missing rules"]]]
        XCTAssertThrowsError(try store.importPortableBackup(JSONSerialization.data(withJSONObject: document)))
        XCTAssertTrue(store.getCollections().contains { $0.name == "Keep me" })
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

private final class RotationFailureFileManager: FileManager, @unchecked Sendable {
    var failRemoval = false
    override func removeItem(at url: URL) throws {
        if failRemoval && url.lastPathComponent.hasPrefix("snapshot-") { throw CocoaError(.fileWriteNoPermission) }
        try super.removeItem(at: url)
    }
}

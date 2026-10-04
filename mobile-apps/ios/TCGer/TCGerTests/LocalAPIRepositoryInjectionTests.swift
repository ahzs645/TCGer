import XCTest
@testable import TCGer

@MainActor
final class LocalAPIRepositoryInjectionTests: XCTestCase {
    func testLocalDetailOperationsUseInjectedStoreAndSurviveRelaunch() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let repository = FileLocalStorePersistenceRepository(rootDirectory: root)
        let store = LocalStore(persistenceRepository: repository)
        let api = APIService(localStore: store)
        let binder = try await api.createCollection(config: .onDevice, token: "local", name: "Injected Detail", description: nil)
        let updated = try await api.updateCollection(config: .onDevice, token: "local", id: binder.id, name: "Edited Detail", description: nil)
        XCTAssertEqual(updated.name, "Edited Detail")
        let loaded = try await api.getCollection(config: .onDevice, id: binder.id)
        XCTAssertEqual(loaded.name, "Edited Detail")
        XCTAssertEqual(try LocalStore(persistenceRepository: repository).getCollection(id: binder.id).name, "Edited Detail")
        try await api.deleteCollection(config: .onDevice, token: "local", id: binder.id)
        XCTAssertFalse(store.getCollections().contains { $0.id == binder.id })
    }
    func testDistinctAPIInstancesNeverShareLocalRecords() async throws {
        let roots = (0..<2).map { _ in FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString) }
        defer { roots.forEach { try? FileManager.default.removeItem(at: $0) } }
        let stores = roots.map { LocalStore(persistenceRepository: FileLocalStorePersistenceRepository(rootDirectory: $0)) }
        let apiA = APIService(localStore: stores[0]); let apiB = APIService(localStore: stores[1])
        _ = try await apiA.createCollection(config: .onDevice, token: "local", name: "Account A", description: nil)
        let b = try await apiB.getCollections(config: .onDevice)
        XCTAssertFalse(b.contains { $0.name == "Account A" })
    }
}

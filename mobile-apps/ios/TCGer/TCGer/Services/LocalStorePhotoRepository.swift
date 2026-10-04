import Foundation

/// Owns immutable photo files and their recovery-point lifetime. Read failures
/// conservatively preserve bytes; garbage collection never changes save results.
final class LocalStorePhotoRepository {
    private let persistence: LocalStorePersistenceRepository
    private let directory: URL?
    private let fileManager: FileManager
    init(persistence: LocalStorePersistenceRepository, fileManager: FileManager = .default) {
        self.persistence = persistence
        self.fileManager = fileManager
        directory = persistence.imageDirectory ?? fileManager.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("BinderPageImages", isDirectory: true)
    }
    func store(_ data: Data) throws -> URL {
        guard let directory else { throw CocoaError(.fileNoSuchFile) }
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        let url = directory.appendingPathComponent("\(UUID().uuidString).jpg")
        try data.write(to: url, options: [.atomic])
        return url
    }
    func discardStaged(_ url: URL) { try? fileManager.removeItem(at: url) }
    func data(at value: String?) -> Data? {
        guard let value, let url = URL(string: value), url.isFileURL else { return nil }
        return try? Data(contentsOf: url)
    }
    func removeIfUnreferenced(_ value: String?, liveReferences: [String]) {
        guard let value, let url = URL(string: value), url.isFileURL,
              let retained = try? retainedReferences(liveReferences), !retained.contains(value) else { return }
        try? fileManager.removeItem(at: url)
    }
    func prune(liveReferences: [String]) {
        guard let directory, let files = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil),
              let retained = try? retainedReferences(liveReferences) else { return }
        for url in files where url.pathExtension == "jpg" && !retained.contains(url.absoluteString) {
            try? fileManager.removeItem(at: url)
        }
    }
    private struct PhotoReference: Decodable { let imageUrl: String? }
    private struct SnapshotReferences: Decodable { let binderPages: [PhotoReference]? }
    private func retainedReferences(_ liveReferences: [String]) throws -> Set<String> {
        var retained = Set(liveReferences)
        for backup in try persistence.availableBackups() {
            let state = try JSONDecoder().decode(SnapshotReferences.self, from: persistence.loadBackup(at: backup))
            retained.formUnion((state.binderPages ?? []).compactMap(\.imageUrl))
        }
        return retained
    }
}

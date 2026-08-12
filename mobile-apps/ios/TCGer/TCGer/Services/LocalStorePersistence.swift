import Foundation

protocol LocalStorePersistenceRepository {
    func load() throws -> Data?
    func save(_ payload: Data) throws
    func remove() throws
    func availableBackups() throws -> [URL]
    func loadBackup(at url: URL) throws -> Data
}

enum LocalStorePersistenceError: LocalizedError, Equatable {
    case unsupportedSchemaVersion(Int)
    case invalidSnapshot
    case backupOutsideRepository
    case saveFailed(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedSchemaVersion(let version):
            return "This local-data snapshot uses unsupported schema version \(version)."
        case .invalidSnapshot:
            return "The local-data snapshot is damaged or incomplete."
        case .backupOutsideRepository:
            return "The selected backup is not managed by this local-data repository."
        case .saveFailed(let message):
            return "The local change could not be saved: \(message)"
        }
    }
}

struct LocalStorePersistenceFailure: Equatable, Sendable {
    enum Operation: String, Equatable, Sendable {
        case load
        case save
        case reset
        case restore
    }

    let operation: Operation
    let message: String
}

extension Notification.Name {
    static let localStorePersistenceFailed = Notification.Name("LocalStorePersistenceFailed")
}

/// Owns durable snapshot I/O while `LocalStore` continues to own domain state.
/// The envelope can evolve independently from the encoded domain payload and
/// legacy unwrapped payloads remain readable.
final class FileLocalStorePersistenceRepository: LocalStorePersistenceRepository {
    private struct Envelope: Codable {
        let schemaVersion: Int
        let createdAt: Date
        let payload: Data
    }

    static let currentSchemaVersion = 1

    private let fileManager: FileManager
    private let storeURL: URL
    private let backupDirectory: URL
    private let maxBackups: Int

    convenience init() {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        self.init(rootDirectory: documents)
    }

    init(
        rootDirectory: URL,
        filename: String = "TCGerLocalStore.json",
        maxBackups: Int = 5,
        fileManager: FileManager = .default
    ) {
        self.fileManager = fileManager
        self.storeURL = rootDirectory.appendingPathComponent(filename)
        self.backupDirectory = rootDirectory.appendingPathComponent("TCGerLocalStoreBackups", isDirectory: true)
        self.maxBackups = max(0, maxBackups)
    }

    func load() throws -> Data? {
        guard fileManager.fileExists(atPath: storeURL.path) else { return nil }
        return try decodeSnapshot(Data(contentsOf: storeURL), allowLegacyPayload: true)
    }

    func save(_ payload: Data) throws {
        try fileManager.createDirectory(
            at: storeURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if fileManager.fileExists(atPath: storeURL.path), maxBackups > 0 {
            try archiveCurrentSnapshot()
        }
        try encodedEnvelope(for: payload).write(to: storeURL, options: [.atomic])
        try rotateBackupsIfNeeded()
    }

    func remove() throws {
        guard fileManager.fileExists(atPath: storeURL.path) else { return }
        try fileManager.removeItem(at: storeURL)
    }

    func availableBackups() throws -> [URL] {
        guard fileManager.fileExists(atPath: backupDirectory.path) else { return [] }
        let urls = try fileManager.contentsOfDirectory(
            at: backupDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        )
        .filter { $0.lastPathComponent.hasPrefix("snapshot-") && $0.pathExtension == "json" }
        return urls.sorted(by: backupIsNewer)
    }

    func loadBackup(at url: URL) throws -> Data {
        let allowedRoot = backupDirectory.standardizedFileURL.path + "/"
        guard url.standardizedFileURL.path.hasPrefix(allowedRoot) else {
            throw LocalStorePersistenceError.backupOutsideRepository
        }
        return try decodeSnapshot(Data(contentsOf: url), allowLegacyPayload: false)
    }

    private func archiveCurrentSnapshot() throws {
        let currentData = try Data(contentsOf: storeURL)
        try fileManager.createDirectory(at: backupDirectory, withIntermediateDirectories: true)
        var prefix: String
        var archivedData: Data
        do {
            let payload = try decodeSnapshot(currentData, allowLegacyPayload: true)
            prefix = "snapshot"
            archivedData = try encodedEnvelope(for: payload)
        } catch {
            // Quarantine unreadable live data for diagnosis, but do not let it
            // prevent a subsequent valid save from repairing the active file.
            prefix = "corrupt"
            archivedData = currentData
        }
        // Wall-clock microseconds continue increasing across device reboots;
        // uptime-based names could make a fresh backup look older than one
        // written before the reboot.
        let sequence = String(format: "%020lld", Int64(Date().timeIntervalSince1970 * 1_000_000))
        let name = "\(prefix)-\(sequence)-\(UUID().uuidString).json"
        try archivedData.write(to: backupDirectory.appendingPathComponent(name), options: [.atomic])
    }

    private func rotateBackupsIfNeeded() throws {
        let backups = try availableBackups()
        for expired in backups.dropFirst(maxBackups) {
            try fileManager.removeItem(at: expired)
        }

        guard fileManager.fileExists(atPath: backupDirectory.path) else { return }
        let allArchives = try fileManager.contentsOfDirectory(
            at: backupDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        )
        let corruptArchives = allArchives
            .filter { $0.lastPathComponent.hasPrefix("corrupt-") && $0.pathExtension == "json" }
            .sorted(by: backupIsNewer)
        for expired in corruptArchives.dropFirst(max(1, min(maxBackups, 2))) {
            try fileManager.removeItem(at: expired)
        }
    }

    private func backupIsNewer(_ lhs: URL, _ rhs: URL) -> Bool {
        let lhsDate = try? lhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
        let rhsDate = try? rhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
        if lhsDate != rhsDate {
            return (lhsDate ?? .distantPast) > (rhsDate ?? .distantPast)
        }
        return lhs.lastPathComponent > rhs.lastPathComponent
    }

    private func encodedEnvelope(for payload: Data) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(Envelope(
            schemaVersion: Self.currentSchemaVersion,
            createdAt: Date(),
            payload: payload
        ))
    }

    private func decodeSnapshot(_ data: Data, allowLegacyPayload: Bool) throws -> Data {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let envelope = try? decoder.decode(Envelope.self, from: data) {
            guard envelope.schemaVersion == Self.currentSchemaVersion else {
                throw LocalStorePersistenceError.unsupportedSchemaVersion(envelope.schemaVersion)
            }
            guard !envelope.payload.isEmpty else {
                throw LocalStorePersistenceError.invalidSnapshot
            }
            return envelope.payload
        }
        guard allowLegacyPayload,
              (try? JSONSerialization.jsonObject(with: data)) != nil else {
            throw LocalStorePersistenceError.invalidSnapshot
        }
        return data
    }
}

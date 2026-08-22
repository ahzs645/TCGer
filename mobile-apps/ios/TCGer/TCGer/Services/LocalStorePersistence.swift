import Foundation

protocol LocalStorePersistenceRepository {
    func load() throws -> Data?
    func save(_ payload: Data) throws
    func remove() throws
    func availableBackups() throws -> [URL]
    func createBackup(_ payload: Data) throws -> URL
    func loadBackup(at url: URL) throws -> Data
    func removeBackup(at url: URL) throws
}

enum LocalStorePersistenceError: LocalizedError, Equatable {
    case unsupportedSchemaVersion(Int)
    case invalidSnapshot
    case backupOutsideRepository
    case recoveryPointsDisabled
    case saveFailed(String)

    var errorDescription: String? {
        switch self {
        case .unsupportedSchemaVersion(let version):
            return "This local-data snapshot uses unsupported schema version \(version)."
        case .invalidSnapshot:
            return "The local-data snapshot is damaged or incomplete."
        case .backupOutsideRepository:
            return "The selected backup is not managed by this local-data repository."
        case .recoveryPointsDisabled:
            return "Local recovery points are disabled."
        case .saveFailed(let message):
            return "The local change could not be saved: \(message)"
        }
    }
}

enum LocalDataTransferError: LocalizedError, Equatable {
    case invalidBackup
    case unsupportedSchemaVersion(Int)
    case emptyBackup

    var errorDescription: String? {
        switch self {
        case .invalidBackup:
            return "This file is not a valid TCGer data backup."
        case .unsupportedSchemaVersion(let version):
            return "This backup uses unsupported schema version \(version). Update TCGer and try again."
        case .emptyBackup:
            return "The selected backup file is empty."
        }
    }
}

struct LocalDataBackupSummary: Equatable, Sendable {
    let exportedAt: Date?
    let binderCount: Int
    let cardCopyCount: Int
    let binderPageCount: Int
    let wishlistCount: Int
    let sealedItemCount: Int
    let onlineCodeCount: Int
    let transactionCount: Int
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
        let canonicalRoot = rootDirectory.standardizedFileURL.resolvingSymlinksInPath()
        self.fileManager = fileManager
        self.storeURL = canonicalRoot.appendingPathComponent(filename)
        self.backupDirectory = canonicalRoot.appendingPathComponent("TCGerLocalStoreBackups", isDirectory: true)
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

    func createBackup(_ payload: Data) throws -> URL {
        guard maxBackups > 0 else {
            throw LocalStorePersistenceError.recoveryPointsDisabled
        }
        try fileManager.createDirectory(at: backupDirectory, withIntermediateDirectories: true)
        let url = nextArchiveURL(prefix: "snapshot")
        try encodedEnvelope(for: payload).write(to: url, options: [.atomic])
        try rotateBackupsIfNeeded()
        return try availableBackups().first {
            $0.lastPathComponent == url.lastPathComponent
        } ?? url
    }

    func loadBackup(at url: URL) throws -> Data {
        let managedURL = try managedBackupURL(for: url)
        return try decodeSnapshot(Data(contentsOf: managedURL), allowLegacyPayload: false)
    }

    func removeBackup(at url: URL) throws {
        let managedURL = try managedBackupURL(for: url)
        guard fileManager.fileExists(atPath: managedURL.path) else { return }
        try fileManager.removeItem(at: managedURL)
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
        try archivedData.write(to: nextArchiveURL(prefix: prefix), options: [.atomic])
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

    private func nextArchiveURL(prefix: String) -> URL {
        // Wall-clock microseconds continue increasing across device reboots;
        // uptime-based names could make a fresh backup look older than one
        // written before the reboot.
        let sequence = String(format: "%020lld", Int64(Date().timeIntervalSince1970 * 1_000_000))
        let name = "\(prefix)-\(sequence)-\(UUID().uuidString).json"
        return backupDirectory.appendingPathComponent(name)
    }

    private func managedBackupURL(for url: URL) throws -> URL {
        let candidate = url.standardizedFileURL
        let candidateDirectoryID = try? candidate.deletingLastPathComponent()
            .resourceValues(forKeys: [.fileResourceIdentifierKey])
            .fileResourceIdentifier as? AnyHashable
        let managedDirectoryID = try? backupDirectory
            .resourceValues(forKeys: [.fileResourceIdentifierKey])
            .fileResourceIdentifier as? AnyHashable
        guard let candidateDirectoryID,
              let managedDirectoryID,
              candidateDirectoryID == managedDirectoryID,
              candidate.lastPathComponent.hasPrefix("snapshot-"),
              candidate.pathExtension == "json" else {
            throw LocalStorePersistenceError.backupOutsideRepository
        }
        return backupDirectory.appendingPathComponent(candidate.lastPathComponent)
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

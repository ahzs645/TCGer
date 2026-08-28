import Combine
import Foundation
import UIKit

nonisolated struct PackOfflineSetDefinition: Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let metadataSetCode: String
    let packPool: String

    static let available: [Self] = [
        .init(id: "base1", name: "Base Set", metadataSetCode: "base1", packPool: "base1"),
        .init(id: "me5", name: "Pitch Black", metadataSetCode: "me05", packPool: "me5"),
    ]

    static func matching(_ setID: String) -> Self? {
        available.first {
            $0.id.caseInsensitiveCompare(setID) == .orderedSame ||
                $0.metadataSetCode.caseInsensitiveCompare(setID) == .orderedSame
        }
    }
}

nonisolated struct PackOfflineDownloadRecord: Codable, Equatable, Sendable {
    let setID: String
    let downloadedAt: Date
    let cardCount: Int
    let byteCount: Int64
    let removableURLs: [String]
}

@MainActor
final class PackOfflineDownloadManager: ObservableObject {
    enum Status {
        case notDownloaded
        case downloading(Double)
        case downloaded(PackOfflineDownloadRecord)
        case failed(String)
    }

    enum DownloadError: LocalizedError {
        case noConnection
        case emptySet(String)
        case invalidResponse(URL)
        case invalidManifest

        var errorDescription: String? {
            switch self {
            case .noConnection:
                "Connect to the internet to download this set."
            case .emptySet(let name):
                "No downloadable card art was found for \(name)."
            case .invalidResponse(let url):
                "The download server did not return \(url.lastPathComponent)."
            case .invalidManifest:
                "The pack artwork manifest could not be read."
            }
        }
    }

    private struct PackManifest: Decodable {
        struct Cover: Decodable {
            let packPool: String?
            let plain: String?
            let decaled: String?
        }

        let mesh: String?
        let covers: [String: Cover]?
    }

    private struct DownloadedAsset: @unchecked Sendable {
        let url: URL
        let data: Data
    }

    static let shared = PackOfflineDownloadManager()

    @Published private(set) var records: [String: PackOfflineDownloadRecord] = [:]
    @Published private(set) var progress: [String: Double] = [:]
    @Published private(set) var errors: [String: String] = [:]
    @Published private(set) var revision = 0

    let definitions = PackOfflineSetDefinition.available

    private let fileManager: FileManager
    private let recordsDirectory: URL
    private let session: URLSession
    private let assetCache: PackOpeningAssetCache
    private let imageCache: ImageCache
    private let remoteBaseURL: URL
    private var activeDownloads: [String: Task<Void, Never>] = [:]

    init(
        directory: URL? = nil,
        fileManager: FileManager = .default,
        session: URLSession = .shared,
        assetCache: PackOpeningAssetCache? = nil,
        imageCache: ImageCache? = nil,
        remoteBaseURL: URL? = nil
    ) {
        self.fileManager = fileManager
        self.session = session
        self.assetCache = assetCache ?? .shared
        self.imageCache = imageCache ?? .shared
        self.remoteBaseURL = remoteBaseURL ?? PackOpeningResource.remoteBaseURL()
        if let directory {
            recordsDirectory = directory
        } else {
            let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask)[0]
            recordsDirectory = documents
                .appendingPathComponent("TCGerCache", isDirectory: true)
                .appendingPathComponent("OfflinePackSets", isDirectory: true)
        }
        records = Self.loadRecords(from: recordsDirectory, fileManager: fileManager)
    }

    func status(for definition: PackOfflineSetDefinition) -> Status {
        if let value = progress[definition.id] { return .downloading(value) }
        if let record = records[definition.id] { return .downloaded(record) }
        if let error = errors[definition.id] { return .failed(error) }
        return .notDownloaded
    }

    func status(forSetID setID: String) -> Status? {
        guard let definition = PackOfflineSetDefinition.matching(setID) else { return nil }
        return status(for: definition)
    }

    func canOpen(setID: String, isConnected: Bool) -> Bool {
        if let definition = PackOfflineSetDefinition.matching(setID),
           case .downloaded = status(for: definition) {
            return true
        }
        return isConnected
    }

    func download(_ definition: PackOfflineSetDefinition) {
        guard activeDownloads[definition.id] == nil else { return }
        errors[definition.id] = nil
        progress[definition.id] = 0
        activeDownloads[definition.id] = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.performDownload(definition)
            } catch is CancellationError {
                self.progress[definition.id] = nil
            } catch {
                self.progress[definition.id] = nil
                self.errors[definition.id] = error.localizedDescription
            }
            self.activeDownloads[definition.id] = nil
        }
    }

    func remove(_ definition: PackOfflineSetDefinition) {
        activeDownloads[definition.id]?.cancel()
        activeDownloads[definition.id] = nil
        guard let record = records.removeValue(forKey: definition.id) else {
            progress[definition.id] = nil
            errors[definition.id] = nil
            return
        }

        for value in record.removableURLs {
            guard let url = URL(string: value) else { continue }
            assetCache.remove(url)
            imageCache.remove(for: url)
        }
        try? fileManager.removeItem(at: recordURL(for: definition.id))
        progress[definition.id] = nil
        errors[definition.id] = nil
        revision += 1
    }

    func refresh() {
        records = Self.loadRecords(from: recordsDirectory, fileManager: fileManager)
        progress.removeAll()
        errors.removeAll()
        revision += 1
    }

    private func performDownload(_ definition: PackOfflineSetDefinition) async throws {
        guard NetworkMonitor.shared.isConnected else { throw DownloadError.noConnection }

        let entries = await CardIndexMetadataStore.shared.entries(
            for: .pokemon,
            setCode: definition.metadataSetCode
        )
        let cardURLs = Self.cardArtworkURLs(from: entries)
        guard !cardURLs.isEmpty else { throw DownloadError.emptySet(definition.name) }

        let manifestURL = remoteBaseURL.appendingPathComponent("pack/manifest.json")
        let manifestAsset = try await Self.fetch(manifestURL, session: session)
        assetCache.store(manifestAsset.data, for: manifestURL)
        guard let manifest = try? JSONDecoder().decode(PackManifest.self, from: manifestAsset.data) else {
            throw DownloadError.invalidManifest
        }

        var sharedURLs = [manifestURL]
        if let mesh = manifest.mesh, let url = resolveAssetPath(mesh) {
            sharedURLs.append(url)
        }
        let wrapperURLs = manifest.covers?.values
            .filter { $0.packPool?.caseInsensitiveCompare(definition.packPool) == .orderedSame }
            .flatMap { [$0.plain, $0.decaled].compactMap { $0 }.compactMap(resolveAssetPath) } ?? []

        let uniqueCardURLs = Self.unique(cardURLs)
        let setSpecificURLs = Self.unique(uniqueCardURLs + wrapperURLs)
        let allURLs = Self.unique(sharedURLs + setSpecificURLs)
        var completed = 0
        let cardURLSet = Set(uniqueCardURLs)
        let setSpecificURLSet = Set(setSpecificURLs)
        var storedBytes: Int64 = 0

        for start in stride(from: 0, to: allURLs.count, by: 6) {
            try Task.checkCancellation()
            let end = min(start + 6, allURLs.count)
            let batch = Array(allURLs[start..<end])
            let assets = try await withThrowingTaskGroup(of: DownloadedAsset.self) { group in
                for url in batch {
                    if let cached = assetCache.data(for: url) {
                        group.addTask { DownloadedAsset(url: url, data: cached) }
                    } else {
                        let session = session
                        group.addTask { try await Self.fetch(url, session: session) }
                    }
                }

                var output: [DownloadedAsset] = []
                for try await asset in group { output.append(asset) }
                return output
            }

            for asset in assets {
                assetCache.store(asset.data, for: asset.url)
                if cardURLSet.contains(asset.url), let image = UIImage(data: asset.data) {
                    imageCache.storeForOffline(image, data: asset.data, for: asset.url)
                }
                completed += 1
                if setSpecificURLSet.contains(asset.url) {
                    let copies: Int64 = cardURLSet.contains(asset.url) ? 2 : 1
                    storedBytes += Int64(asset.data.count) * copies
                }
                progress[definition.id] = Double(completed) / Double(allURLs.count)
            }
        }

        let record = PackOfflineDownloadRecord(
            setID: definition.id,
            downloadedAt: Date(),
            cardCount: entries.count,
            byteCount: storedBytes,
            removableURLs: setSpecificURLs.map(\.absoluteString)
        )
        try save(record)
        records[definition.id] = record
        progress[definition.id] = nil
        errors[definition.id] = nil
        revision += 1
    }

    private func save(_ record: PackOfflineDownloadRecord) throws {
        try fileManager.createDirectory(at: recordsDirectory, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(record).write(to: recordURL(for: record.setID), options: [.atomic])
    }

    private func recordURL(for setID: String) -> URL {
        recordsDirectory.appendingPathComponent("\(setID).json")
    }

    private func resolveAssetPath(_ path: String) -> URL? {
        if let absolute = URL(string: path), absolute.scheme == "https" { return absolute }
        var components = URLComponents(url: remoteBaseURL, resolvingAgainstBaseURL: false)
        let basePath = components?.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
        let assetPath = path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components?.path = "/" + [basePath, assetPath].filter { !$0.isEmpty }.joined(separator: "/")
        return components?.url
    }

    private nonisolated static func fetch(_ url: URL, session: URLSession) async throws -> DownloadedAsset {
        var lastError: Error?
        for _ in 0..<2 {
            do {
                let (data, response) = try await session.data(from: url)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    throw DownloadError.invalidResponse(url)
                }
                return DownloadedAsset(url: url, data: data)
            } catch {
                lastError = error
            }
        }
        throw lastError ?? DownloadError.invalidResponse(url)
    }

    private nonisolated static func cardArtworkURLs(from entries: [CardIndexMetadataEntry]) -> [URL] {
        entries.flatMap { entry -> [URL] in
            guard let value = entry.imageURL, let high = URL(string: value) else { return [] }
            let lowValue = value.replacingOccurrences(of: "/high.webp", with: "/low.webp")
            guard let low = URL(string: lowValue) else { return [high] }
            return [high, low]
        }
    }

    private nonisolated static func unique(_ urls: [URL]) -> [URL] {
        var seen: Set<String> = []
        return urls.filter { seen.insert($0.absoluteString).inserted }
    }

    private nonisolated static func loadRecords(
        from directory: URL,
        fileManager: FileManager
    ) -> [String: PackOfflineDownloadRecord] {
        guard let urls = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        ) else { return [:] }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return urls.reduce(into: [:]) { output, url in
            guard let data = try? Data(contentsOf: url),
                  let record = try? decoder.decode(PackOfflineDownloadRecord.self, from: data)
            else { return }
            output[record.setID] = record
        }
    }
}

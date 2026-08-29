import Combine
import CoreML
import CryptoKit
import Foundation

nonisolated struct ScannerAssetFile: Decodable, Sendable {
    let file: String
    let bytes: Int
    let sha256: String
}

nonisolated struct ScannerModelPackageFile: Decodable, Sendable {
    let relativePath: String
    let file: String
    let bytes: Int
    let sha256: String
}

nonisolated struct ScannerAssetManifest: Decodable, Sendable {
    let formatVersion: Int
    let game: String
    let version: Int
    let generatedAt: String
    let encoder: String
    let modelName: String
    let metadataSchema: String?
    let recognitionContract: String?
    let cardCount: Int
    let printingCount: Int?
    let dimension: Int
    let downloadBytes: Int
    let modelPackage: [ScannerModelPackageFile]
    let vectors: ScannerAssetFile
    let metadata: ScannerAssetFile

    var displayedCardCount: Int { printingCount ?? cardCount }
}

nonisolated struct ScannerRuntimeAssets: Sendable {
    let game: TCGGame
    let version: Int
    let modelURL: URL
    let vectorsURL: URL
    let metadataURL: URL
}

nonisolated enum ScannerAssetInstallState: Equatable {
    case notInstalled
    case installed(version: Int)
}

nonisolated enum ScannerAssetConfiguration {
    static func baseURL(bundle: Bundle = .main) -> URL? {
        guard let value = bundle.object(forInfoDictionaryKey: "TCGerScannerAssetBaseURL") as? String,
              !value.isEmpty,
              !value.contains("$("),
              let url = URL(string: value),
              url.scheme == "https",
              url.host != nil else {
            return nil
        }
        return url
    }
}

@MainActor
final class ScannerAssetStore: ObservableObject {
    static let shared = ScannerAssetStore()
    static let downloadableGames: [TCGGame] = [.pokemon, .magic, .yugioh]

    enum StoreError: LocalizedError {
        case unavailable
        case invalidResponse
        case unsupportedManifest
        case invalidManifest
        case unsafePath
        case checksumMismatch
        case invalidMetadata
        case invalidVectors

        var errorDescription: String? {
            switch self {
            case .unavailable:
                return "The on-device scanner model is not available right now."
            case .invalidResponse:
                return "The scanner model download returned an invalid response."
            case .unsupportedManifest:
                return "This scanner model requires a newer version of TCGer."
            case .invalidManifest:
                return "The scanner model manifest is invalid."
            case .unsafePath:
                return "The scanner model contains an unsafe file path."
            case .checksumMismatch:
                return "The scanner model download failed its integrity check."
            case .invalidMetadata:
                return "The scanner card metadata is invalid."
            case .invalidVectors:
                return "The scanner vector index is invalid."
            }
        }
    }

    @Published private(set) var manifests: [TCGGame: ScannerAssetManifest] = [:]
    @Published private(set) var installedVersions: [TCGGame: Int] = [:]
    @Published private(set) var installingGames: Set<TCGGame> = []
    @Published private(set) var installProgress: [TCGGame: Double] = [:]

    private let baseURL: URL?
    private let session: URLSession
    private let fileManager: FileManager
    private let defaults: UserDefaults
    private let rootDirectory: URL

    init(
        baseURL: URL? = ScannerAssetConfiguration.baseURL(),
        session: URLSession = .shared,
        fileManager: FileManager = .default,
        defaults: UserDefaults = .standard
    ) {
        self.baseURL = baseURL
        self.session = session
        self.fileManager = fileManager
        self.defaults = defaults
        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        rootDirectory = applicationSupport
            .appendingPathComponent("TCGer", isDirectory: true)
            .appendingPathComponent("ScannerAssets", isDirectory: true)

        for game in Self.downloadableGames {
            let version = defaults.integer(forKey: Self.installKey(for: game))
            guard version > 0 else { continue }
            let directory = Self.versionDirectory(root: rootDirectory, game: game, version: version)
            if Self.runtime(in: directory, game: game, version: version, fileManager: fileManager) != nil {
                installedVersions[game] = version
            }
        }

        Task { [weak self] in
            guard let self else { return }
            for game in Self.downloadableGames {
                try? await self.refreshManifest(for: game)
            }
        }
    }

    func refreshManifest(for game: TCGGame) async throws {
        let (manifest, _) = try await fetchManifest(for: game)
        manifests[game] = manifest
    }

    func installState(for game: TCGGame) -> ScannerAssetInstallState {
        installedVersions[game].map(ScannerAssetInstallState.installed(version:)) ?? .notInstalled
    }

    func isAvailable(_ game: TCGGame) -> Bool {
        manifests[game] != nil
    }

    func isUpdateAvailable(_ game: TCGGame) -> Bool {
        guard let remote = manifests[game]?.version,
              let installed = installedVersions[game] else { return false }
        return remote > installed
    }

    func runtime(for game: TCGGame) -> ScannerRuntimeAssets? {
        guard let version = installedVersions[game] else { return nil }
        let directory = Self.versionDirectory(root: rootDirectory, game: game, version: version)
        return Self.runtime(in: directory, game: game, version: version, fileManager: fileManager)
    }

    func install(_ game: TCGGame) async throws {
        if installingGames.contains(game) {
            while installingGames.contains(game) {
                try await Task.sleep(for: .milliseconds(50))
            }
            return
        }
        installingGames.insert(game)
        installProgress[game] = 0
        defer {
            installingGames.remove(game)
            installProgress.removeValue(forKey: game)
        }

        let (manifest, manifestData) = try await fetchManifest(for: game)
        manifests[game] = manifest
        let staging = rootDirectory.appendingPathComponent(".staging-\(UUID().uuidString)", isDirectory: true)
        defer { try? fileManager.removeItem(at: staging) }
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)

        let packageURL = staging.appendingPathComponent("Model.mlpackage", isDirectory: true)
        try fileManager.createDirectory(at: packageURL, withIntermediateDirectories: true)
        let allAssets: [(remote: ScannerAssetFile, destination: URL)] = try manifest.modelPackage.map { file in
            let destination = try Self.safeDestination(root: packageURL, relativePath: file.relativePath)
            return (
                ScannerAssetFile(file: file.file, bytes: file.bytes, sha256: file.sha256),
                destination
            )
        } + [
            (manifest.vectors, staging.appendingPathComponent("Vectors.bin")),
            (manifest.metadata, staging.appendingPathComponent("Metadata.json")),
        ]

        var completedBytes = 0
        for asset in allAssets {
            let data = try await download(asset.remote)
            try fileManager.createDirectory(
                at: asset.destination.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: asset.destination, options: .atomic)
            completedBytes += asset.remote.bytes
            installProgress[game] = min(1, Double(completedBytes) / Double(manifest.downloadBytes))
        }

        let metadataURL = staging.appendingPathComponent("Metadata.json")
        let vectorsURL = staging.appendingPathComponent("Vectors.bin")
        try Self.validateMetadata(at: metadataURL, manifest: manifest)
        try Self.validateVectors(at: vectorsURL, manifest: manifest)

        let compiledTemporary = try await Task.detached(priority: .utility) {
            try MLModel.compileModel(at: packageURL)
        }.value
        let compiledURL = staging.appendingPathComponent("Model.mlmodelc", isDirectory: true)
        try fileManager.copyItem(at: compiledTemporary, to: compiledURL)
        try? fileManager.removeItem(at: packageURL)
        try manifestData.write(to: staging.appendingPathComponent("manifest.json"), options: .atomic)

        let gameDirectory = rootDirectory.appendingPathComponent(game.rawValue, isDirectory: true)
        let destination = Self.versionDirectory(
            root: rootDirectory,
            game: game,
            version: manifest.version
        )
        try fileManager.createDirectory(at: gameDirectory, withIntermediateDirectories: true)
        if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
        }
        try fileManager.moveItem(at: staging, to: destination)
        defaults.set(manifest.version, forKey: Self.installKey(for: game))
        installedVersions[game] = manifest.version
        removeInactiveVersions(for: game, keeping: destination)
    }

    func remove(_ game: TCGGame) {
        let directory = rootDirectory.appendingPathComponent(game.rawValue, isDirectory: true)
        try? fileManager.removeItem(at: directory)
        defaults.removeObject(forKey: Self.installKey(for: game))
        installedVersions.removeValue(forKey: game)
    }

    private func fetchManifest(for game: TCGGame) async throws -> (ScannerAssetManifest, Data) {
        guard let baseURL else { throw StoreError.unavailable }
        let url = baseURL
            .appendingPathComponent(game.rawValue, isDirectory: true)
            .appendingPathComponent("manifest.json", isDirectory: false)
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 60
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode) else {
            throw StoreError.invalidResponse
        }
        let manifest = try JSONDecoder().decode(ScannerAssetManifest.self, from: data)
        guard (1...3).contains(manifest.formatVersion) else {
            throw StoreError.unsupportedManifest
        }
        guard manifest.game == game.rawValue,
              manifest.version > 0,
              manifest.encoder == "arcface",
              manifest.cardCount > 0,
              manifest.dimension > 0,
              manifest.downloadBytes > 0,
              !manifest.modelPackage.isEmpty else {
            throw StoreError.invalidManifest
        }
        if manifest.formatVersion == 2 {
            guard manifest.metadataSchema == "tcger-cards-index-metadata-v2",
                  manifest.recognitionContract == "tcger-two-stage-recognition-v1" else {
                throw StoreError.invalidManifest
            }
        }
        if manifest.formatVersion == 3 {
            guard manifest.metadataSchema == "tcger-cards-index-metadata-v3",
                  manifest.recognitionContract == "tcger-two-stage-recognition-v2",
                  manifest.printingCount ?? 0 >= manifest.cardCount else {
                throw StoreError.invalidManifest
            }
        }
        let files = manifest.modelPackage.map {
            ScannerAssetFile(file: $0.file, bytes: $0.bytes, sha256: $0.sha256)
        } + [manifest.vectors, manifest.metadata]
        guard files.allSatisfy({ file in
            file.bytes > 0
                && file.sha256.count == 64
                && file.sha256.allSatisfy(\.isHexDigit)
                && Self.remoteURL(baseURL: URL(fileURLWithPath: "/manifest-root"), relativePath: file.file) != nil
        }),
        files.reduce(0, { $0 + $1.bytes }) == manifest.downloadBytes else {
            throw StoreError.invalidManifest
        }
        return (manifest, data)
    }

    private func download(_ asset: ScannerAssetFile) async throws -> Data {
        guard let baseURL,
              let url = Self.remoteURL(baseURL: baseURL, relativePath: asset.file) else {
            throw StoreError.unsafePath
        }
        let (data, response) = try await session.data(from: url)
        guard let response = response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode) else {
            throw StoreError.invalidResponse
        }
        guard data.count == asset.bytes,
              SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == asset.sha256 else {
            throw StoreError.checksumMismatch
        }
        return data
    }

    private func removeInactiveVersions(for game: TCGGame, keeping active: URL) {
        let directory = rootDirectory.appendingPathComponent(game.rawValue, isDirectory: true)
        guard let contents = try? fileManager.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        ) else { return }
        for url in contents where url.standardizedFileURL != active.standardizedFileURL {
            try? fileManager.removeItem(at: url)
        }
    }

    private nonisolated static func validateMetadata(
        at url: URL,
        manifest: ScannerAssetManifest
    ) throws {
        try validateMetadataData(Data(contentsOf: url), manifest: manifest)
    }

    nonisolated static func validateMetadataData(
        _ data: Data,
        manifest: ScannerAssetManifest
    ) throws {
        struct Row: Decodable {
            let annIndex: Int
            let cardId: String?
            let exactPrintingId: String?
            let recognitionFamilyId: String?
            let name: String?
            let game: String?
            let imageURL: String?
            let setCode: String?
            let collectorNumber: String?
            let releaseDate: String?
            let printings: [Printing]?
        }
        struct Printing: Decodable {
            let cardId: String?
            let exactPrintingId: String?
            let imageURL: String?
            let setCode: String?
            let collectorNumber: String?
            let releaseDate: String?
        }
        let rows = try JSONDecoder().decode([Row].self, from: data)
        guard rows.count == manifest.cardCount,
              rows.enumerated().allSatisfy({ index, row in
                  row.annIndex == index && row.game?.lowercased() == manifest.game
              }) else {
            throw StoreError.invalidMetadata
        }
        guard manifest.formatVersion >= 2 else { return }

        func isPresent(_ value: String?) -> Bool {
            value?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }
        for row in rows {
            guard isPresent(row.cardId),
                  isPresent(row.exactPrintingId),
                  isPresent(row.recognitionFamilyId),
                  isPresent(row.name),
                  isPresent(row.imageURL) else {
                throw StoreError.invalidMetadata
            }
            if manifest.game == TCGGame.magic.rawValue {
                guard isPresent(row.setCode),
                      isPresent(row.collectorNumber),
                      isPresent(row.releaseDate) else {
                    throw StoreError.invalidMetadata
                }
            }
            if manifest.formatVersion == 3 {
                guard let printings = row.printings, !printings.isEmpty else {
                    throw StoreError.invalidMetadata
                }
                for printing in printings {
                    guard isPresent(printing.cardId),
                          isPresent(printing.exactPrintingId),
                          isPresent(printing.imageURL) else {
                        throw StoreError.invalidMetadata
                    }
                    if manifest.game == TCGGame.magic.rawValue,
                       !(isPresent(printing.setCode)
                         && isPresent(printing.collectorNumber)
                         && isPresent(printing.releaseDate)) {
                        throw StoreError.invalidMetadata
                    }
                }
            }
        }
    }

    private nonisolated static func validateVectors(
        at url: URL,
        manifest: ScannerAssetManifest
    ) throws {
        let data = try Data(contentsOf: url, options: .mappedIfSafe)
        guard data.count >= 8 else { throw StoreError.invalidVectors }
        let count = Int(data.withUnsafeBytes {
            $0.loadUnaligned(fromByteOffset: 0, as: Int32.self).littleEndian
        })
        let dimension = Int(data.withUnsafeBytes {
            $0.loadUnaligned(fromByteOffset: 4, as: Int32.self).littleEndian
        })
        guard count == manifest.cardCount,
              dimension == manifest.dimension,
              data.count == 8 + count * dimension else {
            throw StoreError.invalidVectors
        }
    }

    private nonisolated static func safeDestination(root: URL, relativePath: String) throws -> URL {
        guard let url = remoteURL(baseURL: root, relativePath: relativePath),
              url.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path + "/") else {
            throw StoreError.unsafePath
        }
        return url
    }

    private nonisolated static func remoteURL(baseURL: URL, relativePath: String) -> URL? {
        let components = relativePath.split(separator: "/", omittingEmptySubsequences: false)
        guard !components.isEmpty,
              components.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." && !$0.contains("\\") }) else {
            return nil
        }
        return components.reduce(baseURL) { url, component in
            url.appendingPathComponent(String(component), isDirectory: false)
        }
    }

    private nonisolated static func runtime(
        in directory: URL,
        game: TCGGame,
        version: Int,
        fileManager: FileManager
    ) -> ScannerRuntimeAssets? {
        let modelURL = directory.appendingPathComponent("Model.mlmodelc", isDirectory: true)
        let vectorsURL = directory.appendingPathComponent("Vectors.bin", isDirectory: false)
        let metadataURL = directory.appendingPathComponent("Metadata.json", isDirectory: false)
        guard fileManager.fileExists(atPath: modelURL.path),
              fileManager.fileExists(atPath: vectorsURL.path),
              fileManager.fileExists(atPath: metadataURL.path) else { return nil }
        return ScannerRuntimeAssets(
            game: game,
            version: version,
            modelURL: modelURL,
            vectorsURL: vectorsURL,
            metadataURL: metadataURL
        )
    }

    private nonisolated static func versionDirectory(
        root: URL,
        game: TCGGame,
        version: Int
    ) -> URL {
        root.appendingPathComponent(game.rawValue, isDirectory: true)
            .appendingPathComponent("version-\(version)", isDirectory: true)
    }

    private nonisolated static func installKey(for game: TCGGame) -> String {
        "scannerAssetInstalledVersion.\(game.rawValue)"
    }
}

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
    /// Optional `tcger-scanner-acceptance-policy-v1` object. Absent on
    /// manifests published before 2026-08-29; the client then runs its
    /// built-in profile for the game.
    let acceptancePolicy: ScannerGameAcceptancePolicy?

    var displayedCardCount: Int { printingCount ?? cardCount }
}

nonisolated struct ScannerRuntimeAssets: Sendable {
    let game: String
    let version: Int
    let modelURL: URL
    let vectorsURL: URL
    let metadataURL: URL
    /// The policy the installed manifest declared, if any.
    let acceptancePolicy: ScannerGameAcceptancePolicy?
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
    static var downloadableGames: [TCGGame] {
        Array(Set([TCGGame.pokemon, .magic, .yugioh] + GamePackageStore.shared.installed.compactMap { package in
            package.manifest.scanner?.ios == nil ? nil : TCGGame(rawValue: package.manifest.game.id)
        })).sorted { $0.rawValue < $1.rawValue }
    }

    struct PackageSource {
        let gameID: String
        let url: URL
        let asset: GamePackageAsset
    }

    static var downloadableGameIDs: [String] {
        Array(Set([TCGGame.pokemon, .magic, .yugioh].map(\.rawValue) + installedPackageSources().map(\.gameID))).sorted()
    }

    private static func installedPackageSources() -> [PackageSource] {
        GamePackageStore.shared.installed.compactMap { package in
            guard let asset = package.manifest.scanner?.ios?.manifest,
                  let base = URL(string: package.sourceURL),
                  let url = URL(string: asset.url, relativeTo: base)?.absoluteURL,
                  url.scheme == "https" else { return nil }
            return PackageSource(gameID: package.manifest.game.id, url: url, asset: asset)
        }
    }

    private func packageScanner(for game: String) -> PackageSource? {
        let sources = packageSources().filter { $0.gameID == game }
        return sources.count == 1 ? sources.first : nil
    }

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

    @Published private(set) var manifestsByID: [String: ScannerAssetManifest] = [:]
    @Published private(set) var installedVersionsByID: [String: Int] = [:]
    @Published private(set) var installingGameIDs: Set<String> = []
    @Published private(set) var installProgressByID: [String: Double] = [:]
    // Built-in selectors keep their typed interface; package download ownership uses stable IDs.
    var manifests: [TCGGame: ScannerAssetManifest] { Dictionary(uniqueKeysWithValues: manifestsByID.compactMap { key, value in TCGGame(rawValue: key).map { ($0, value) } }) }
    var installedVersions: [TCGGame: Int] { Dictionary(uniqueKeysWithValues: installedVersionsByID.compactMap { key, value in TCGGame(rawValue: key).map { ($0, value) } }) }
    var installingGames: Set<TCGGame> { Set(installingGameIDs.compactMap(TCGGame.init(rawValue:))) }
    var installProgress: [TCGGame: Double] { Dictionary(uniqueKeysWithValues: installProgressByID.compactMap { key, value in TCGGame(rawValue: key).map { ($0, value) } }) }
    private let packageSources: () -> [PackageSource]
    private let compileModel: @Sendable (URL) async throws -> URL

    private let baseURL: URL?
    private let session: URLSession
    private let fileManager: FileManager
    private let defaults: UserDefaults
    private let rootDirectory: URL

    init(
        baseURL: URL? = ScannerAssetConfiguration.baseURL(),
        session: URLSession = .shared,
        fileManager: FileManager = .default,
        defaults: UserDefaults = .standard,
        rootDirectory: URL? = nil,
        packageSources: (() -> [PackageSource])? = nil,
        refreshOnInit: Bool = true,
        compileModel: @escaping @Sendable (URL) async throws -> URL = { url in
            try await Task.detached(priority: .utility) { try MLModel.compileModel(at: url) }.value
        }
    ) {
        self.packageSources = packageSources ?? Self.installedPackageSources
        self.compileModel = compileModel
        self.baseURL = baseURL
        self.session = session
        self.fileManager = fileManager
        self.defaults = defaults
        let applicationSupport = fileManager.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first ?? fileManager.temporaryDirectory
        self.rootDirectory = rootDirectory ?? applicationSupport
            .appendingPathComponent("TCGer", isDirectory: true)
            .appendingPathComponent("ScannerAssets", isDirectory: true)

        for game in Set([TCGGame.pokemon, .magic, .yugioh].map(\.rawValue) + self.packageSources().map(\.gameID)) where Self.validGameID(game) {
            let version = defaults.integer(forKey: Self.installKey(for: game))
            guard version > 0 else { continue }
            let directory = Self.versionDirectory(root: self.rootDirectory, game: game, version: version)
            if Self.runtime(in: directory, game: game, version: version, fileManager: fileManager) != nil {
                installedVersionsByID[game] = version
            }
        }

        if refreshOnInit { Task { [weak self] in
            guard let self else { return }
            for game in Set([TCGGame.pokemon, .magic, .yugioh].map(\.rawValue) + self.packageSources().map(\.gameID)) where Self.validGameID(game) {
                try? await self.refreshManifest(for: game)
            }
        } }
    }

    func refreshManifest(for game: String) async throws {
        let (manifest, _) = try await fetchManifest(for: game)
        manifestsByID[game] = manifest
    }

    func installState(for game: String) -> ScannerAssetInstallState {
        installedVersionsByID[game].map(ScannerAssetInstallState.installed(version:)) ?? .notInstalled
    }

    func isAvailable(_ game: String) -> Bool {
        manifestsByID[game] != nil
    }

    func isUpdateAvailable(_ game: String) -> Bool {
        guard let remote = manifestsByID[game]?.version,
              let installed = installedVersionsByID[game] else { return false }
        return remote > installed
    }

    func runtime(for game: String) -> ScannerRuntimeAssets? {
        guard let version = installedVersionsByID[game] else { return nil }
        let directory = Self.versionDirectory(root: rootDirectory, game: game, version: version)
        return Self.runtime(in: directory, game: game, version: version, fileManager: fileManager)
    }

    func install(_ game: String) async throws {
        guard Self.validGameID(game) else { throw StoreError.unsafePath }
        if installingGameIDs.contains(game) {
            while installingGameIDs.contains(game) {
                try await Task.sleep(for: .milliseconds(50))
            }
            return
        }
        installingGameIDs.insert(game)
        installProgressByID[game] = 0
        defer {
            installingGameIDs.remove(game)
            installProgressByID.removeValue(forKey: game)
        }

        let (manifest, manifestData) = try await fetchManifest(for: game)
        manifestsByID[game] = manifest
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
            let data = try await download(asset.remote, baseOverride: packageScanner(for: game)?.url.deletingLastPathComponent())
            try fileManager.createDirectory(
                at: asset.destination.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try data.write(to: asset.destination, options: .atomic)
            completedBytes += asset.remote.bytes
            installProgressByID[game] = min(1, Double(completedBytes) / Double(manifest.downloadBytes))
        }

        let metadataURL = staging.appendingPathComponent("Metadata.json")
        let vectorsURL = staging.appendingPathComponent("Vectors.bin")
        try Self.validateMetadata(at: metadataURL, manifest: manifest)
        try Self.validateVectors(at: vectorsURL, manifest: manifest)

        let compiledTemporary = try await compileModel(packageURL)
        let compiledURL = staging.appendingPathComponent("Model.mlmodelc", isDirectory: true)
        try fileManager.copyItem(at: compiledTemporary, to: compiledURL)
        try? fileManager.removeItem(at: packageURL)
        try manifestData.write(to: staging.appendingPathComponent("manifest.json"), options: .atomic)

        let gameDirectory = rootDirectory.appendingPathComponent(game, isDirectory: true)
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
        installedVersionsByID[game] = manifest.version
        removeInactiveVersions(for: game, keeping: destination)
    }

    func remove(_ game: String) {
        guard Self.validGameID(game) else { return }
        let directory = rootDirectory.appendingPathComponent(game, isDirectory: true)
        try? fileManager.removeItem(at: directory)
        defaults.removeObject(forKey: Self.installKey(for: game))
        installedVersionsByID.removeValue(forKey: game)
    }

    func refreshManifest(for game: TCGGame) async throws { try await refreshManifest(for: game.rawValue) }
    func installState(for game: TCGGame) -> ScannerAssetInstallState { installState(for: game.rawValue) }
    func isAvailable(_ game: TCGGame) -> Bool { isAvailable(game.rawValue) }
    func isUpdateAvailable(_ game: TCGGame) -> Bool { isUpdateAvailable(game.rawValue) }
    func runtime(for game: TCGGame) -> ScannerRuntimeAssets? { runtime(for: game.rawValue) }
    func install(_ game: TCGGame) async throws { try await install(game.rawValue) }
    func remove(_ game: TCGGame) { remove(game.rawValue) }

    private nonisolated static func validGameID(_ game: String) -> Bool {
        game.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil
    }

    private func fetchManifest(for game: String) async throws -> (ScannerAssetManifest, Data) {
        guard Self.validGameID(game) else { throw StoreError.unsafePath }
        let sources = packageSources().filter { $0.gameID == game }
        guard sources.count <= 1 else { throw StoreError.unavailable }
        let package = packageScanner(for: game)
        guard package != nil || [TCGGame.pokemon, .magic, .yugioh].map(\.rawValue).contains(game) else { throw StoreError.unavailable }
        guard let url = package?.url ?? baseURL?.appendingPathComponent(game, isDirectory: true).appendingPathComponent("manifest.json", isDirectory: false) else { throw StoreError.unavailable }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 60
        let (data, response) = try await session.data(for: request)
        guard let response = response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode) else {
            throw StoreError.invalidResponse
        }
        if let asset = package?.asset {
            guard data.count == asset.bytes, SHA256.hash(data: data).map({ String(format: "%02x", $0) }).joined() == asset.sha256.lowercased() else { throw StoreError.checksumMismatch }
        }
        let manifest = try JSONDecoder().decode(ScannerAssetManifest.self, from: data)
        guard (1...3).contains(manifest.formatVersion) else {
            throw StoreError.unsupportedManifest
        }
        guard manifest.game == game,
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
        if let policy = manifest.acceptancePolicy, !policy.isValid {
            throw StoreError.invalidManifest
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

    private func download(_ asset: ScannerAssetFile, baseOverride: URL? = nil) async throws -> Data {
        guard let baseURL = baseOverride ?? baseURL,
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

    private func removeInactiveVersions(for game: String, keeping active: URL) {
        let directory = rootDirectory.appendingPathComponent(game, isDirectory: true)
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
        game: String,
        version: Int,
        fileManager: FileManager
    ) -> ScannerRuntimeAssets? {
        let modelURL = directory.appendingPathComponent("Model.mlmodelc", isDirectory: true)
        let vectorsURL = directory.appendingPathComponent("Vectors.bin", isDirectory: false)
        let metadataURL = directory.appendingPathComponent("Metadata.json", isDirectory: false)
        guard fileManager.fileExists(atPath: modelURL.path),
              fileManager.fileExists(atPath: vectorsURL.path),
              fileManager.fileExists(atPath: metadataURL.path) else { return nil }
        // The manifest is staged next to the runtime files at install time;
        // its declared policy travels with the version it was published for.
        let manifestURL = directory.appendingPathComponent("manifest.json", isDirectory: false)
        let declaredPolicy = (try? Data(contentsOf: manifestURL))
            .flatMap { try? JSONDecoder().decode(ScannerAssetManifest.self, from: $0) }?
            .acceptancePolicy
        return ScannerRuntimeAssets(
            game: game,
            version: version,
            modelURL: modelURL,
            vectorsURL: vectorsURL,
            metadataURL: metadataURL,
            acceptancePolicy: declaredPolicy?.isValid == true ? declaredPolicy : nil
        )
    }

    private nonisolated static func versionDirectory(
        root: URL,
        game: String,
        version: Int
    ) -> URL {
        root.appendingPathComponent(game, isDirectory: true)
            .appendingPathComponent("version-\(version)", isDirectory: true)
    }

    private nonisolated static func installKey(for game: String) -> String {
        "scannerAssetInstalledVersion.\(game)"
    }
}

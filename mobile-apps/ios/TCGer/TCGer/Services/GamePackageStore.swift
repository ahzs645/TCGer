import CryptoKit
import Combine
import Foundation
import SwiftUI

nonisolated enum GameFeatureID {
    static let pokedex = "pokedex"
    static let supportedVersions = [pokedex: 1]
}

enum PackageJSONValue: Codable, Hashable {
    case string(String), number(Double), bool(Bool), array([PackageJSONValue]), object([String: PackageJSONValue]), null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let decoded = try? value.decode(Bool.self) { self = .bool(decoded) }
        else if let decoded = try? value.decode(Double.self) { self = .number(decoded) }
        else if let decoded = try? value.decode(String.self) { self = .string(decoded) }
        else if let decoded = try? value.decode([PackageJSONValue].self) { self = .array(decoded) }
        else { self = .object(try value.decode([String: PackageJSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .bool(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .object(let item): try value.encode(item)
        case .null: try value.encodeNil()
        }
    }

    var displayValue: String {
        switch self {
        case .string(let value): value
        case .number(let value): value.formatted()
        case .bool(let value): value ? "true" : "false"
        default: ""
        }
    }

    var numberValue: Double? {
        switch self { case .number(let value): value; case .string(let value): Double(value); default: nil }
    }
}

struct GamePackageAsset: Codable, Hashable {
    let url: String
    let bytes: Int
    let sha256: String
    let mediaType: String?
}

struct GamePackageFilterOption: Codable, Hashable, Identifiable {
    let value: PackageJSONValue
    let label: String
    var id: String { value.displayValue }
}

struct GamePackageFilter: Codable, Hashable, Identifiable {
    let id: String
    let label: String
    let property: String
    let help: String?
    let type: String
    let options: [GamePackageFilterOption]?
    let min: Double?
    let max: Double?
    let step: Double?
    let trueLabel: String?
    let falseLabel: String?
    let mode: String?
    let maxLength: Int?
}

struct GamePackageManifest: Codable, Hashable {
    struct Update: Codable, Hashable { let sequence: Int; let manifestUrl: String?; let releaseNotes: String? }
    struct Game: Codable, Hashable { let id: String; let name: String; let shortName: String?; let description: String?; let homepage: String?; let accentColor: String? }
    struct Publisher: Codable, Hashable {
        struct SigningKey: Codable, Hashable { let id: String; let algorithm: String; let publicKey: String }
        let id: String?; let name: String; let homepage: String?; var signingKey: SigningKey? = nil
    }
    struct Signature: Codable, Hashable { let algorithm: String; let keyId: String; let url: String }
    struct Catalog: Codable, Hashable { let schema: String; let asset: GamePackageAsset; let cardCount: Int; let setCount: Int? }
    struct RuntimeAsset: Codable, Hashable { let runtime: String; let manifest: GamePackageAsset }
    struct Scanner: Codable, Hashable { let web: RuntimeAsset?; let ios: RuntimeAsset?; let android: RuntimeAsset? }
    struct OfflinePacks: Codable, Hashable { let schema: String; let manifest: GamePackageAsset }
    struct SealedProducts: Codable, Hashable { let schema: String; let asset: GamePackageAsset; let productCount: Int }

    let schema: String
    let packageId: String?
    let packageVersion: String
    let publishedAt: String
    let update: Update?
    let game: Game
    let publisher: Publisher
    var signature: Signature? = nil
    let catalog: Catalog
    let filters: [GamePackageFilter]
    let definition: GamePackageDefinition?
    let scanner: Scanner?
    let offlinePacks: OfflinePacks?
    let sealedProducts: SealedProducts?

    var installedId: String {
        if let packageId, let publisherId = publisher.id { return "\(publisherId)--\(packageId)" }
        return game.id
    }
    var effectiveDefinition: GamePackageDefinition {
        definition ?? GamePackageDefinition.legacy(manifest: self)
    }
}

struct GamePackageDefinition: Codable, Hashable {
    struct Feature: Codable, Hashable, Identifiable {
        let id: String
        let version: Int?

        var effectiveVersion: Int { version ?? 1 }
    }
    struct Format: Codable, Hashable, Identifiable { let id: String; let label: String; let physical: Bool? }
    struct Presentation: Codable, Hashable { let accentColor: String?; let iconUrl: String?; let cardBackUrl: String? }
    struct Interfaces: Codable, Hashable {
        let search: Bool?; let collection: Bool?; let sets: Bool?; let wishlists: Bool?
        let decks: Bool?; let pricing: Bool?; let sealedProducts: Bool?; let scanner: Bool?; let packOpening: Bool?
        let features: [Feature]?

        func supportsFeature(_ id: String, maximumVersion: Int = 1) -> Bool {
            features?.contains { $0.id == id && $0.effectiveVersion <= maximumVersion } == true
        }

        var enabledLabels: [String] {
            [(search ?? true, "Search"), (collection ?? true, "Collections"), (sets ?? true, "Sets"),
             (wishlists ?? true, "Wishlists"), (decks ?? false, "Decks"), (pricing ?? false, "Pricing"),
             (sealedProducts ?? false, "Sealed"), (scanner ?? false, "Scanner"), (packOpening ?? false, "Pack opening")]
                .compactMap { $0.0 ? $0.1 : nil }
                + (features ?? []).map { $0.id }
        }
    }
    struct IdentityMode: Codable, Hashable, Identifiable { let id: String; let label: String; let description: String; let key: String }
    struct CollectionDefinition: Codable, Hashable { let identityModes: [IdentityMode]; let defaultIdentityMode: String; let facets: [GamePackageFilter] }
    struct SearchDefinition: Codable, Hashable { let facets: [GamePackageFilter] }

    let id: String
    let label: String
    let shortLabel: String?
    let aliases: [String]?
    let formats: [Format]?
    let presentation: Presentation?
    let interfaces: Interfaces?
    let collection: CollectionDefinition
    let search: SearchDefinition

    static func legacy(manifest: GamePackageManifest) -> Self {
        .init(
            id: manifest.game.id,
            label: manifest.game.name,
            shortLabel: manifest.game.shortName,
            aliases: nil,
            formats: nil,
            presentation: manifest.game.accentColor.map { .init(accentColor: $0, iconUrl: nil, cardBackUrl: nil) },
            interfaces: .init(
                search: true, collection: true, sets: manifest.catalog.setCount != nil, wishlists: true,
                decks: false, pricing: false, sealedProducts: manifest.sealedProducts != nil, scanner: manifest.scanner != nil,
                packOpening: manifest.offlinePacks != nil, features: []
            ),
            collection: .init(
                identityModes: [.init(id: "collector", label: "Collector", description: "Keep exact sets, rarities, artwork, and variants separate.", key: "printingKey")],
                defaultIdentityMode: "collector",
                facets: manifest.filters
            ),
            search: .init(facets: manifest.filters)
        )
    }
}

struct InstalledGamePackage: Codable, Hashable, Identifiable {
    let id: String
    let sourceURL: String
    let installedAt: Date
    let manifest: GamePackageManifest
    var trust: GamePackageTrust? = nil
}

struct GamePackageTrust: Codable, Hashable {
    let status: String
    let keyId: String?
    let fingerprint: String?
}

enum GamePackageDuplicateKind: Equatable { case included, samePackage, sameCatalog }
enum GamePackageReleaseRelation: Equatable { case differentPackage, same, update, downgrade, conflict }

func gamePackageReleaseRelation(current: GamePackageManifest, candidate: GamePackageManifest) -> GamePackageReleaseRelation {
    guard current.installedId == candidate.installedId else { return .differentPackage }
    guard current.game.id == candidate.game.id else { return .conflict }
    let sameContent = current == candidate
    if current.update?.sequence != nil || candidate.update?.sequence != nil {
        guard let currentSequence = current.update?.sequence,
              let candidateSequence = candidate.update?.sequence else { return .conflict }
        if candidateSequence > currentSequence { return .update }
        if candidateSequence < currentSequence { return .downgrade }
        return sameContent ? .same : .conflict
    }
    let formatter = ISO8601DateFormatter()
    guard let currentDate = formatter.date(from: current.publishedAt),
          let candidateDate = formatter.date(from: candidate.publishedAt) else { return .conflict }
    if candidateDate > currentDate { return .update }
    if candidateDate < currentDate { return .downgrade }
    return sameContent ? .same : .conflict
}

func duplicateGamePackage(in installed: [GamePackageManifest], candidate: GamePackageManifest) -> GamePackageDuplicateKind? {
    if candidate.publisher.id == "tcger", candidate.packageId == "\(candidate.game.id)-catalog" {
        return .included
    }
    for current in installed {
        let sameCatalog = current.game.id == candidate.game.id &&
            current.catalog.asset.sha256.caseInsensitiveCompare(candidate.catalog.asset.sha256) == .orderedSame
        if current.installedId == candidate.installedId {
            if sameCatalog && current.packageVersion == candidate.packageVersion { return .samePackage }
            continue
        }
        if sameCatalog { return .sameCatalog }
    }
    return nil
}

struct CommunityCatalogCard: Codable, Hashable, Identifiable {
    let id: String
    let baseExternalId: String?
    let printingKey: String?
    let artworkId: String?
    let name: String
    let setCode: String?
    var setName: String?
    let collectorNumber: String?
    let rarity: String?
    let artist: String?
    let type: String?
    let category: String?
    let stage: String?
    let suffix: String?
    let archetype: String?
    let classifications: [String]?
    let variants: [String]?
    let character: String?
    let era: String?
    let specialTrait: String?
    let treatments: [String]?
    let supertype: String?
    let subtypes: [String]?
    let types: [String]?
    let hp: Double?
    let manaCost: String?
    let colors: [String]?
    let race: String?
    let atk: Double?
    let def: Double?
    let level: Double?
    let language: String?
    let regulationMark: String?
    let sanctionedPlayLegal: Bool?
    let formatLegality: [String: PackageJSONValue]?
    let dexEntries: [PackageJSONValue]?
    let releasedAt: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let attributes: [String: PackageJSONValue]?

    var effectiveAttributes: [String: PackageJSONValue] {
        var root: [String: PackageJSONValue] = [:]
        func string(_ key: String, _ value: String?) { if let value { root[key] = .string(value) } }
        func strings(_ key: String, _ value: [String]?) { if let value { root[key] = .array(value.map(PackageJSONValue.string)) } }
        func number(_ key: String, _ value: Double?) { if let value { root[key] = .number(value) } }
        string("artist", artist); string("type", type); string("category", category); string("stage", stage)
        string("suffix", suffix); string("archetype", archetype); string("character", character)
        string("era", era); string("specialTrait", specialTrait); string("manaCost", manaCost); string("race", race)
        strings("classifications", classifications); strings("variants", variants); strings("treatments", treatments)
        strings("subtypes", subtypes); strings("types", types); strings("colors", colors)
        number("hp", hp); number("atk", atk); number("def", def); number("level", level)
        root.merge(attributes ?? [:], uniquingKeysWith: { _, explicit in explicit })
        return root
    }

    func value(at path: String) -> PackageJSONValue? {
        let builtIn: [String: String?] = [
            "id": id, "name": name, "setCode": setCode, "setName": setName, "collectorNumber": collectorNumber,
            "rarity": rarity, "artist": artist, "type": type, "category": category, "supertype": supertype,
            "language": language, "regulationMark": regulationMark, "releasedAt": releasedAt,
        ]
        if let value = builtIn[path] ?? nil { return .string(value) }
        if path == "sanctionedPlayLegal", let sanctionedPlayLegal { return .bool(sanctionedPlayLegal) }
        if path.hasPrefix("formatLegality."), let value = formatLegality?[String(path.dropFirst("formatLegality.".count))] { return value }
        if path == "dexEntries.number", let dexEntries {
            return .array(dexEntries.compactMap { entry in
                guard case .object(let object) = entry else { return nil }
                return object["number"]
            })
        }
        guard path.hasPrefix("attributes."), var current = effectiveAttributes[String(path.dropFirst("attributes.".count)) .split(separator: ".").first.map(String.init) ?? ""] else { return nil }
        for key in path.dropFirst("attributes.".count).split(separator: ".").dropFirst() {
            guard case .object(let object) = current, let next = object[String(key)] else { return nil }
            current = next
        }
        return current
    }
}

private struct CommunityCatalogSet: Codable { let code: String; let name: String; let series: String?; let releasedAt: String?; let cardCount: Int?; let iconUrl: String?; let logoUrl: String? }
private struct CommunityCatalog: Codable { let formatVersion: Int; let tcg: String; let sets: [CommunityCatalogSet]?; let cards: [CommunityCatalogCard] }

@MainActor
final class GamePackageStore: ObservableObject {
    static let shared = GamePackageStore()
    @Published private(set) var installed: [InstalledGamePackage] = []
    @Published private(set) var isInstalling = false
    @Published private(set) var availableUpdates: [String: GamePackageManifest] = [:]
    @Published var errorMessage: String?

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let maximumManifestBytes = 1_048_576
    private let allowedProperties = try! NSRegularExpression(pattern: "^(id|name|setCode|collectorNumber|rarity|artist|type|category|releasedAt|attributes\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)$")
    private let allowedDefinitionProperties = try! NSRegularExpression(pattern: "^(name|setCode|setName|collectorNumber|rarity|releasedAt|language|artist|supertype|regulationMark|sanctionedPlayLegal|quantity|dexEntries\\.number|formatLegality\\.(standard|expanded|unlimited)|attributes\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*|copies\\.(condition|language|finishCode|finishLabel|edition|stamp))$")
    private var publisherKeys: [String: String] = [:]

    private init() {
        loadInstalled()
        loadPublisherKeys()
    }

    func checkForUpdates() async {
        var updates: [String: GamePackageManifest] = [:]
        for package in installed {
            guard !Task.isCancelled else { return }
            do {
                let sourceURL = try secureURL(package.manifest.update?.manifestUrl ?? package.sourceURL)
                let manifestData = try await download(sourceURL, maximumBytes: maximumManifestBytes)
                let candidate = try decoder.decode(GamePackageManifest.self, from: manifestData)
                try validate(candidate)
                let verification = try await verifyPublisher(sourceURL: sourceURL, manifestData: manifestData, manifest: candidate)
                if package.trust?.status == "verified", verification.trust.status != "verified" { continue }
                if package.trust?.status == "verified", package.trust?.keyId != verification.trust.keyId { continue }
                if gamePackageReleaseRelation(current: package.manifest, candidate: candidate) == .update {
                    updates[package.id] = candidate
                }
            } catch is CancellationError {
                return
            } catch {
                continue
            }
        }
        availableUpdates = updates
    }

    func update(_ package: InstalledGamePackage) async {
        await install(from: package.manifest.update?.manifestUrl ?? package.sourceURL)
    }

    func install(from value: String) async {
        isInstalling = true
        errorMessage = nil
        defer { isInstalling = false }
        do {
            let sourceURL = try secureURL(value)
            let manifestData = try await download(sourceURL, maximumBytes: maximumManifestBytes)
            let manifest = try decoder.decode(GamePackageManifest.self, from: manifestData)
            try validate(manifest)
            let publisherVerification = try await verifyPublisher(
                sourceURL: sourceURL,
                manifestData: manifestData,
                manifest: manifest
            )
            if let current = installed.first(where: { $0.id == manifest.installedId }) {
                if current.trust?.status == "verified", publisherVerification.trust.status != "verified" {
                    throw PackageError.invalid("A verified package cannot be replaced by an unsigned update")
                }
                if current.trust?.status == "verified", current.trust?.keyId != publisherVerification.trust.keyId {
                    throw PackageError.invalid("The publisher signing key changed; explicit key rotation is required")
                }
                switch gamePackageReleaseRelation(current: current.manifest, candidate: manifest) {
                case .update: break
                case .same: throw PackageError.invalid("This exact package release is already installed")
                case .downgrade: throw PackageError.invalid("A newer package release is already installed")
                case .conflict: throw PackageError.invalid("This package conflicts with the installed release sequence")
                case .differentPackage: break
                }
            }
            if let duplicate = duplicateGamePackage(in: installed.map(\.manifest), candidate: manifest) {
                let message = switch duplicate {
                case .included: "This official TCGer package is available through the Game Store"
                case .samePackage: "This exact package version is already installed"
                case .sameCatalog: "This catalog is already installed under another package name"
                }
                throw PackageError.invalid(message)
            }
            let catalogURL = try secureURL(manifest.catalog.asset.url, relativeTo: sourceURL)
            let catalogData = try await download(catalogURL, maximumBytes: manifest.catalog.asset.bytes)
            guard catalogData.count == manifest.catalog.asset.bytes else { throw PackageError.invalid("Catalog byte count does not match") }
            let digest = SHA256.hash(data: catalogData).map { String(format: "%02x", $0) }.joined()
            guard digest == manifest.catalog.asset.sha256.lowercased() else { throw PackageError.invalid("Catalog checksum does not match") }
            let catalog = try decoder.decode(CommunityCatalog.self, from: catalogData)
            guard catalog.formatVersion == 1, catalog.tcg == manifest.game.id, catalog.cards.count == manifest.catalog.cardCount else {
                throw PackageError.invalid("Catalog identity or card count does not match")
            }
            guard Set(catalog.cards.map(\.id)).count == catalog.cards.count else { throw PackageError.invalid("Catalog card ids must be unique") }
            guard manifest.catalog.setCount == nil || (catalog.sets ?? []).count == manifest.catalog.setCount else {
                throw PackageError.invalid("Catalog set count does not match")
            }
            if manifest.effectiveDefinition.interfaces?.supportsFeature(GameFeatureID.pokedex) == true,
               !catalog.cards.contains(where: { card in
                   card.dexEntries?.contains(where: { entry in
                       guard case .object(let object) = entry,
                             let number = object["number"]?.numberValue else { return false }
                       return number > 0
                   }) == true
               }) {
                throw PackageError.invalid("Pokédex support requires normalized dexEntries data")
            }
            let fileManager = FileManager.default
            try fileManager.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
            let directory = packageDirectory(manifest.installedId)
            let staging = rootDirectory.appendingPathComponent(".staging-\(manifest.installedId)-\(UUID().uuidString)", isDirectory: true)
            let backup = rootDirectory.appendingPathComponent(".backup-\(manifest.installedId)-\(UUID().uuidString)", isDirectory: true)
            try fileManager.createDirectory(at: staging, withIntermediateDirectories: false)
            do {
                try catalogData.write(to: staging.appendingPathComponent("catalog.json"), options: .atomic)
                try manifestData.write(to: staging.appendingPathComponent("manifest.json"), options: .atomic)
            } catch {
                try? fileManager.removeItem(at: staging)
                throw error
            }
            let previous = installed.first { $0.id == manifest.installedId }
            let record = InstalledGamePackage(
                id: manifest.installedId,
                sourceURL: manifest.update?.manifestUrl ?? sourceURL.absoluteString,
                installedAt: previous?.installedAt ?? Date(),
                manifest: manifest,
                trust: publisherVerification.trust
            )
            if let pin = publisherVerification.pin {
                publisherKeys[pin.id] = pin.publicKey
                try persistPublisherKeys()
            }
            var nextInstalled = installed.filter { $0.id != record.id }
            nextInstalled.append(record)
            nextInstalled.sort { $0.manifest.game.name < $1.manifest.game.name }
            var movedExistingToBackup = false
            do {
                if fileManager.fileExists(atPath: directory.path) {
                    try fileManager.moveItem(at: directory, to: backup)
                    movedExistingToBackup = true
                }
                try fileManager.moveItem(at: staging, to: directory)
                try persistInstalled(nextInstalled)
                installed = nextInstalled
                availableUpdates.removeValue(forKey: record.id)
                if movedExistingToBackup { try? fileManager.removeItem(at: backup) }
            } catch {
                try? fileManager.removeItem(at: staging)
                if fileManager.fileExists(atPath: directory.path) {
                    try? fileManager.removeItem(at: directory)
                }
                if movedExistingToBackup {
                    try? fileManager.moveItem(at: backup, to: directory)
                }
                throw error
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func cards(for package: InstalledGamePackage) throws -> [CommunityCatalogCard] {
        let data = try Data(contentsOf: packageDirectory(package.id).appendingPathComponent("catalog.json"))
        let catalog = try decoder.decode(CommunityCatalog.self, from: data)
        let setNames = Dictionary((catalog.sets ?? []).map { ($0.code, $0.name) }, uniquingKeysWith: { first, _ in first })
        return catalog.cards.map { card in
            var card = card
            if card.setName == nil, let code = card.setCode { card.setName = setNames[code] }
            return card
        }
    }

    func search(packageId: String, query: String, limit: Int = 500) throws -> [Card] {
        guard let package = installed.first(where: { $0.id == packageId }) else { return [] }
        let normalized = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return try cards(for: package).lazy
            .filter {
                normalized.isEmpty || $0.name.localizedCaseInsensitiveContains(normalized) ||
                    $0.setName?.localizedCaseInsensitiveContains(normalized) == true ||
                    $0.setCode?.localizedCaseInsensitiveContains(normalized) == true ||
                    $0.collectorNumber?.localizedCaseInsensitiveContains(normalized) == true
            }
            .prefix(limit)
            .map { $0.card(gameId: package.manifest.game.id) }
    }

    func remove(_ package: InstalledGamePackage) {
        try? FileManager.default.removeItem(at: packageDirectory(package.id))
        installed.removeAll { $0.id == package.id }
        availableUpdates.removeValue(forKey: package.id)
        try? persistInstalled()
    }

    private func validate(_ manifest: GamePackageManifest) throws {
        guard manifest.schema == "https://tcger.app/schemas/game-package-manifest/v1",
              manifest.catalog.schema == "tcger-catalog-v1",
              manifest.game.id.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil,
              manifest.catalog.cardCount >= 0,
              manifest.catalog.asset.bytes > 0, manifest.catalog.asset.bytes <= 536_870_912,
              manifest.catalog.asset.sha256.range(of: "^[A-Fa-f0-9]{64}$", options: .regularExpression) != nil,
              manifest.filters.count <= 24,
              manifest.offlinePacks == nil || manifest.offlinePacks?.schema == "tcger-pack-library-v1",
              manifest.sealedProducts == nil || manifest.sealedProducts?.schema == "tcger-sealed-catalog-v1",
              [manifest.scanner?.web, manifest.scanner?.ios, manifest.scanner?.android].compactMap({ $0 }).allSatisfy({ $0.runtime == "tcger-arcface-v1" })
        else { throw PackageError.invalid("Unsupported game package manifest") }
        guard manifest.definition == nil || manifest.definition?.id == manifest.game.id,
              manifest.packageId == nil || manifest.publisher.id != nil,
              (manifest.publisher.signingKey == nil) == (manifest.signature == nil),
              manifest.publisher.signingKey?.id == manifest.signature?.keyId
        else { throw PackageError.invalid("Package identity or game definition does not match") }
        if let packageId = manifest.packageId { try validateID(packageId) }
        if let publisherId = manifest.publisher.id { try validateID(publisherId) }
        guard manifest.update == nil || manifest.update!.sequence >= 0 else {
            throw PackageError.invalid("Invalid package release sequence")
        }
        if let definition = manifest.definition {
            let features = definition.interfaces?.features ?? []
            guard !(definition.interfaces?.scanner == true && manifest.scanner == nil),
                  !(definition.interfaces?.packOpening == true && manifest.offlinePacks == nil),
                  !(definition.interfaces?.sealedProducts == true && manifest.sealedProducts == nil),
                  !definition.collection.identityModes.isEmpty,
                  definition.collection.identityModes.count <= 2,
                  definition.collection.identityModes.map(\.id).allSatisfy({ ["consolidated", "collector"].contains($0) }),
                  Set(definition.collection.identityModes.map(\.id)).count == definition.collection.identityModes.count,
                  features.count <= 32,
                  Set(features.map(\.id)).count == features.count,
                  features.allSatisfy({
                      $0.effectiveVersion > 0 && $0.effectiveVersion <= 1000 &&
                          $0.id.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil
                  }),
                  features.allSatisfy({ feature in
                      GameFeatureID.supportedVersions[feature.id] != nil ||
                          manifest.publisher.id.map { feature.id.hasPrefix("\($0)--") } == true
                  }),
                  definition.collection.identityModes.contains(where: { $0.id == definition.collection.defaultIdentityMode }),
                  definition.collection.identityModes.allSatisfy({ $0.key == ($0.id == "consolidated" ? "baseExternalId" : "printingKey") })
            else { throw PackageError.invalid("Invalid game interface capability or collection identity") }
            try validateFilters(definition.collection.facets, properties: allowedDefinitionProperties, requireOptions: false)
            try validateFilters(definition.search.facets, properties: allowedDefinitionProperties, requireOptions: false)
        }
        try validateFilters(manifest.filters, properties: allowedProperties, requireOptions: true)
    }

    private func validateID(_ id: String) throws {
        guard id.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil else {
            throw PackageError.invalid("Invalid package identity")
        }
    }

    private func validateFilters(_ filters: [GamePackageFilter], properties: NSRegularExpression, requireOptions: Bool) throws {
        guard filters.count <= 24, Set(filters.map(\.id)).count == filters.count else {
            throw PackageError.invalid("Too many filters or duplicate filter ids")
        }
        var ids = Set<String>()
        for filter in filters {
            guard ids.insert(filter.id).inserted,
                  filter.id.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil,
                  properties.firstMatch(in: filter.property, range: NSRange(filter.property.startIndex..., in: filter.property)) != nil,
                  ["select", "multiSelect", "numberRange", "boolean", "text"].contains(filter.type),
                  (filter.options?.count ?? 0) <= 200,
                  !requireOptions || !(["select", "multiSelect"].contains(filter.type)) || !(filter.options ?? []).isEmpty,
                  filter.type != "numberRange" || (filter.min != nil && filter.max != nil && filter.min! <= filter.max!),
                  filter.type != "text" || (1...200).contains(filter.maxLength ?? 80)
            else { throw PackageError.invalid("Unsupported package filter") }
        }
    }

    private func secureURL(_ value: String, relativeTo base: URL? = nil) throws -> URL {
        guard let url = URL(string: value, relativeTo: base)?.absoluteURL,
              url.user == nil, url.password == nil, url.fragment == nil,
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host ?? "")) else {
            throw PackageError.invalid("Game package links must use HTTPS")
        }
        return url
    }

    private func download(_ url: URL, maximumBytes: Int) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse, 200..<300 ~= http.statusCode else { throw PackageError.invalid("Download failed") }
        guard data.count <= maximumBytes else { throw PackageError.invalid("Download is larger than allowed") }
        return data
    }

    private struct PublisherVerification {
        struct Pin { let id: String; let publicKey: String }
        let trust: GamePackageTrust
        let pin: Pin?
    }

    private func verifyPublisher(
        sourceURL: URL,
        manifestData: Data,
        manifest: GamePackageManifest
    ) async throws -> PublisherVerification {
        guard let signingKey = manifest.publisher.signingKey,
              let signatureMetadata = manifest.signature else {
            return PublisherVerification(
                trust: GamePackageTrust(status: "unsigned", keyId: nil, fingerprint: nil),
                pin: nil
            )
        }
        guard let publisherId = manifest.publisher.id,
              signingKey.algorithm == "ed25519",
              signatureMetadata.algorithm == "ed25519",
              signingKey.id == signatureMetadata.keyId,
              let publicKeyData = Data(base64Encoded: signingKey.publicKey),
              publicKeyData.count == 32 else {
            throw PackageError.invalid("Invalid package signing metadata")
        }
        let signatureURL = try secureURL(signatureMetadata.url, relativeTo: sourceURL)
        let signature = try await download(signatureURL, maximumBytes: 512)
        guard signature.count == 64 else {
            throw PackageError.invalid("Package signature must be 64 bytes")
        }
        let publicKey = try Curve25519.Signing.PublicKey(rawRepresentation: publicKeyData)
        guard publicKey.isValidSignature(signature, for: manifestData) else {
            throw PackageError.invalid("Package publisher signature is invalid")
        }
        let pinId = "\(publisherId):\(signingKey.id)"
        if let pinned = publisherKeys[pinId], pinned != signingKey.publicKey {
            throw PackageError.invalid("The publisher signing key changed; explicit key rotation is required")
        }
        let fingerprint = SHA256.hash(data: publicKeyData).map { String(format: "%02x", $0) }.joined()
        return PublisherVerification(
            trust: GamePackageTrust(status: "verified", keyId: signingKey.id, fingerprint: fingerprint),
            pin: .init(id: pinId, publicKey: signingKey.publicKey)
        )
    }

    private var rootDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TCGer/GamePackages", isDirectory: true)
    }
    private func packageDirectory(_ id: String) -> URL { rootDirectory.appendingPathComponent(id, isDirectory: true) }
    private var indexURL: URL { rootDirectory.appendingPathComponent("installed.json") }
    private var publisherKeysURL: URL { rootDirectory.appendingPathComponent("publisher-keys.json") }
    private func loadInstalled() { if let data = try? Data(contentsOf: indexURL), let value = try? decoder.decode([InstalledGamePackage].self, from: data) { installed = value } }
    private func loadPublisherKeys() { if let data = try? Data(contentsOf: publisherKeysURL), let value = try? decoder.decode([String: String].self, from: data) { publisherKeys = value } }
    private func persistInstalled(_ value: [InstalledGamePackage]? = nil) throws {
        try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
        try encoder.encode(value ?? installed).write(to: indexURL, options: .atomic)
    }
    private func persistPublisherKeys() throws { try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true); try encoder.encode(publisherKeys).write(to: publisherKeysURL, options: .atomic) }
}

private enum PackageError: LocalizedError { case invalid(String); var errorDescription: String? { if case .invalid(let message) = self { message } else { nil } } }

extension CommunityCatalogCard {
    var normalizedDexEntries: [PokedexEntry]? {
        let entries = dexEntries?.compactMap { value -> PokedexEntry? in
            guard case .object(let object) = value,
                  let number = object["number"]?.numberValue,
                  number.rounded() == number,
                  number > 0 else { return nil }
            let name: String
            if case .string(let value)? = object["name"] { name = value } else { name = "#\(Int(number))" }
            return PokedexEntry(number: Int(number), name: name)
        }
        return entries?.isEmpty == false ? entries : nil
    }

    func card(gameId: String) -> Card {
        Card(
            id: id,
            name: name,
            tcg: gameId,
            setCode: setCode,
            setName: setName,
            rarity: rarity,
            artist: artist,
            imageUrl: imageUrl,
            imageUrlSmall: imageUrlSmall,
            price: nil,
            collectorNumber: collectorNumber,
            releasedAt: releasedAt.flatMap { ISO8601DateFormatter().date(from: $0) },
            supertype: supertype ?? type,
            subtypes: subtypes,
            types: types,
            dexEntries: normalizedDexEntries,
            regulationMark: regulationMark,
            language: language,
            attributes: effectiveAttributes.mapValues { $0.jsonValue },
            baseExternalId: baseExternalId,
            printingKey: printingKey ?? id,
            artworkId: artworkId,
            sanctionedPlayLegal: sanctionedPlayLegal
        )
    }
}

private extension PackageJSONValue {
    var jsonValue: JSONValue {
        switch self {
        case .string(let value): .string(value)
        case .number(let value): .number(value)
        case .bool(let value): .bool(value)
        case .array(let value): .array(value.map { $0.jsonValue })
        case .object(let value): .object(value.mapValues { $0.jsonValue })
        case .null: .null
        }
    }
}

struct InstallGamePackageView: View {
    @ObservedObject var store: GamePackageStore
    @State private var packageURL = ""

    var body: some View {
        List {
            Section {
                TextField("Game package URL", text: $packageURL)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()
                Button {
                    Task {
                        await store.install(from: packageURL)
                        if store.errorMessage == nil { packageURL = "" }
                    }
                } label: {
                    if store.isInstalling {
                        ProgressView()
                    } else {
                        Label("Install Package", systemImage: "square.and.arrow.down")
                    }
                }
                .disabled(store.isInstalling || packageURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                if let error = store.errorMessage {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            } header: {
                Text("Package URL")
            } footer: {
                Text("Only HTTPS declarative manifests are accepted. Official TCGer packages are available in the Game Store.")
            }

            Section("Installed Packages") {
                if store.installed.isEmpty {
                    ContentUnavailableView(
                        "No Other Packages",
                        systemImage: "shippingbox",
                        description: Text("Packages installed from another publisher will appear here.")
                    )
                } else {
                    ForEach(store.installed) { package in
                        NavigationLink { CommunityGameLibraryView(package: package, store: store) } label: {
                            VStack(alignment: .leading) {
                                Text(package.manifest.effectiveDefinition.label)
                                Text("\(package.manifest.publisher.name) · \(package.manifest.catalog.cardCount.formatted()) cards · v\(package.manifest.packageVersion)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(package.trust?.status == "verified"
                                     ? "Verified key \(package.trust?.fingerprint?.prefix(12) ?? "")"
                                     : "Unsigned publisher")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                let interfaces = package.manifest.effectiveDefinition.interfaces?.enabledLabels ?? []
                                if !interfaces.isEmpty {
                                    Text("Declared support: \(interfaces.joined(separator: ", "))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                if let candidate = store.availableUpdates[package.id] {
                                    Text(
                                        "Update v\(candidate.packageVersion)" +
                                            (candidate.update?.releaseNotes.map { " · \($0)" } ?? "")
                                    )
                                    .font(.caption2)
                                    .foregroundStyle(.tint)
                                }
                            }
                        }
                        .badge(store.availableUpdates[package.id] == nil ? nil : "Update")
                        .swipeActions {
                            Button("Remove", role: .destructive) { store.remove(package) }
                            if store.availableUpdates[package.id] != nil {
                                Button("Update") { Task { await store.update(package) } }
                                    .tint(.accentColor)
                            }
                        }
                    }
                }
            }
            if !store.installed.isEmpty {
                Section {
                    Button {
                        Task { await store.checkForUpdates() }
                    } label: {
                        Label("Check for Library Updates", systemImage: "arrow.clockwise")
                    }
                    .disabled(store.isInstalling)
                }
            }
        }
        .navigationTitle("Install from URL")
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.checkForUpdates() }
    }
}

struct CommunityGameLibraryView: View {
    let package: InstalledGamePackage
    let store: GamePackageStore
    @State private var cards: [CommunityCatalogCard] = []
    @State private var search = ""
    @State private var selections: [String: Set<String>] = [:]

    private var filteredCards: [CommunityCatalogCard] {
        cards.lazy.filter { card in
            (search.isEmpty || card.name.localizedCaseInsensitiveContains(search)) && package.manifest.effectiveDefinition.search.facets.allSatisfy { filter in
                guard let selected = selections[filter.id], !selected.isEmpty else { return true }
                guard let actual = card.value(at: filter.property) else { return false }
                switch filter.type {
                case "text":
                    let text = selected.first ?? ""
                    return filter.mode == "equals" ? actual.displayValue.caseInsensitiveCompare(text) == .orderedSame : actual.displayValue.localizedCaseInsensitiveContains(text)
                case "numberRange":
                    guard let number = actual.numberValue else { return false }
                    let bounds = (selected.first ?? "").split(separator: ":", omittingEmptySubsequences: false)
                    let lower = bounds.first.flatMap { Double($0) }
                    let upper = bounds.dropFirst().first.flatMap { Double($0) }
                    return (lower == nil || number >= lower!) && (upper == nil || number <= upper!)
                default:
                    if case .array(let values) = actual { return values.contains { item in selected.contains { item.displayValue.caseInsensitiveCompare($0) == .orderedSame } } }
                    return selected.contains { actual.displayValue.caseInsensitiveCompare($0) == .orderedSame }
                }
            }
        }.prefix(500).map { $0 }
    }

    var body: some View {
        List {
            if !package.manifest.effectiveDefinition.search.facets.isEmpty { Section("Filters") { ForEach(package.manifest.effectiveDefinition.search.facets) { filter in FilterControl(filter: filter, values: Binding(get: { selections[filter.id] ?? [] }, set: { selections[filter.id] = $0 })) } } }
            Section("Cards") { ForEach(filteredCards) { card in VStack(alignment: .leading) { Text(card.name); if let set = card.setCode { Text([set, card.collectorNumber].compactMap { $0 }.joined(separator: " ")).font(.caption).foregroundStyle(.secondary) } } } }
        }.navigationTitle(package.manifest.effectiveDefinition.label).searchable(text: $search).task { cards = (try? store.cards(for: package)) ?? [] }
    }
}

private struct FilterControl: View {
    let filter: GamePackageFilter
    @Binding var values: Set<String>
    @State private var minimum = ""
    @State private var maximum = ""
    var body: some View {
        if filter.type == "multiSelect" {
            VStack(alignment: .leading) {
                Text(filter.label)
                ScrollView(.horizontal) { HStack { ForEach(filter.options ?? []) { option in
                    Button(option.label) { let key = option.value.displayValue; if values.contains(key) { values.remove(key) } else { values.insert(key) } }
                        .buttonStyle(.borderedProminent).tint(values.contains(option.value.displayValue) ? .accentColor : .secondary)
                } } }.scrollIndicators(.hidden)
            }
        } else if filter.type == "select" || filter.type == "boolean" {
            Picker(filter.label, selection: Binding(get: { values.first ?? "" }, set: { values = $0.isEmpty ? [] : [$0] })) { Text("All").tag(""); ForEach(filter.options ?? (filter.type == "boolean" ? [.init(value: .bool(true), label: filter.trueLabel ?? "Yes"), .init(value: .bool(false), label: filter.falseLabel ?? "No")] : [])) { Text($0.label).tag($0.value.displayValue) } }
        } else if filter.type == "numberRange" {
            VStack(alignment: .leading) { Text(filter.label); HStack { TextField("Min", text: $minimum).keyboardType(.decimalPad); TextField("Max", text: $maximum).keyboardType(.decimalPad) } }.onChange(of: minimum) { values = (minimum.isEmpty && maximum.isEmpty) ? [] : ["\(minimum):\(maximum)"] }.onChange(of: maximum) { values = (minimum.isEmpty && maximum.isEmpty) ? [] : ["\(minimum):\(maximum)"] }
        } else { TextField(filter.label, text: Binding(get: { values.first ?? "" }, set: { values = $0.isEmpty ? [] : [$0] })) }
    }
}

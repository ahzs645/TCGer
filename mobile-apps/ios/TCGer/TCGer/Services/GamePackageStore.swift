import CryptoKit
import Combine
import Foundation
import SwiftUI

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
    struct Game: Codable, Hashable { let id: String; let name: String; let shortName: String?; let description: String?; let homepage: String?; let accentColor: String? }
    struct Publisher: Codable, Hashable { let name: String; let homepage: String? }
    struct Catalog: Codable, Hashable { let schema: String; let asset: GamePackageAsset; let cardCount: Int; let setCount: Int? }
    struct RuntimeAsset: Codable, Hashable { let runtime: String; let manifest: GamePackageAsset }
    struct Scanner: Codable, Hashable { let web: RuntimeAsset?; let ios: RuntimeAsset?; let android: RuntimeAsset? }
    struct OfflinePacks: Codable, Hashable { let schema: String; let manifest: GamePackageAsset }

    let schema: String
    let packageVersion: String
    let publishedAt: String
    let game: Game
    let publisher: Publisher
    let catalog: Catalog
    let filters: [GamePackageFilter]
    let scanner: Scanner?
    let offlinePacks: OfflinePacks?
}

struct InstalledGamePackage: Codable, Hashable, Identifiable {
    let id: String
    let sourceURL: String
    let installedAt: Date
    let manifest: GamePackageManifest
}

struct CommunityCatalogCard: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let setCode: String?
    let collectorNumber: String?
    let rarity: String?
    let artist: String?
    let type: String?
    let category: String?
    let releasedAt: String?
    let imageUrl: String?
    let imageUrlSmall: String?
    let attributes: [String: PackageJSONValue]?

    func value(at path: String) -> PackageJSONValue? {
        let builtIn: [String: String?] = [
            "id": id, "name": name, "setCode": setCode, "collectorNumber": collectorNumber,
            "rarity": rarity, "artist": artist, "type": type, "category": category, "releasedAt": releasedAt,
        ]
        if let value = builtIn[path] ?? nil { return .string(value) }
        guard path.hasPrefix("attributes."), var current = attributes?[String(path.dropFirst("attributes.".count)) .split(separator: ".").first.map(String.init) ?? ""] else { return nil }
        for key in path.dropFirst("attributes.".count).split(separator: ".").dropFirst() {
            guard case .object(let object) = current, let next = object[String(key)] else { return nil }
            current = next
        }
        return current
    }
}

private struct CommunityCatalog: Codable { let formatVersion: Int; let tcg: String; let cards: [CommunityCatalogCard] }

@MainActor
final class GamePackageStore: ObservableObject {
    static let shared = GamePackageStore()
    @Published private(set) var installed: [InstalledGamePackage] = []
    @Published private(set) var isInstalling = false
    @Published var errorMessage: String?

    private let decoder = JSONDecoder()
    private let encoder = JSONEncoder()
    private let maximumManifestBytes = 1_048_576
    private let allowedProperties = try! NSRegularExpression(pattern: "^(id|name|setCode|collectorNumber|rarity|artist|type|category|releasedAt|attributes\\.[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)$")

    private init() { loadInstalled() }

    func install(from value: String) async {
        isInstalling = true
        errorMessage = nil
        defer { isInstalling = false }
        do {
            let sourceURL = try secureURL(value)
            let manifestData = try await download(sourceURL, maximumBytes: maximumManifestBytes)
            let manifest = try decoder.decode(GamePackageManifest.self, from: manifestData)
            try validate(manifest)
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
            let directory = packageDirectory(manifest.game.id)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try catalogData.write(to: directory.appendingPathComponent("catalog.json"), options: .atomic)
            try manifestData.write(to: directory.appendingPathComponent("manifest.json"), options: .atomic)
            let record = InstalledGamePackage(id: manifest.game.id, sourceURL: sourceURL.absoluteString, installedAt: Date(), manifest: manifest)
            installed.removeAll { $0.id == record.id }
            installed.append(record)
            installed.sort { $0.manifest.game.name < $1.manifest.game.name }
            try persistInstalled()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func cards(for package: InstalledGamePackage) throws -> [CommunityCatalogCard] {
        let data = try Data(contentsOf: packageDirectory(package.id).appendingPathComponent("catalog.json"))
        return try decoder.decode(CommunityCatalog.self, from: data).cards
    }

    func remove(_ package: InstalledGamePackage) {
        try? FileManager.default.removeItem(at: packageDirectory(package.id))
        installed.removeAll { $0.id == package.id }
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
              [manifest.scanner?.web, manifest.scanner?.ios, manifest.scanner?.android].compactMap({ $0 }).allSatisfy({ $0.runtime == "tcger-arcface-v1" })
        else { throw PackageError.invalid("Unsupported game package manifest") }
        var ids = Set<String>()
        for filter in manifest.filters {
            guard ids.insert(filter.id).inserted,
                  filter.id.range(of: "^[a-z0-9][a-z0-9-]{0,63}$", options: .regularExpression) != nil,
                  allowedProperties.firstMatch(in: filter.property, range: NSRange(filter.property.startIndex..., in: filter.property)) != nil,
                  ["select", "multiSelect", "numberRange", "boolean", "text"].contains(filter.type),
                  (filter.options?.count ?? 0) <= 200,
                  !(["select", "multiSelect"].contains(filter.type)) || !(filter.options ?? []).isEmpty,
                  filter.type != "numberRange" || (filter.min != nil && filter.max != nil && filter.min! <= filter.max!),
                  filter.type != "text" || (filter.maxLength ?? 80) <= 200
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

    private var rootDirectory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("TCGer/GamePackages", isDirectory: true)
    }
    private func packageDirectory(_ id: String) -> URL { rootDirectory.appendingPathComponent(id, isDirectory: true) }
    private var indexURL: URL { rootDirectory.appendingPathComponent("installed.json") }
    private func loadInstalled() { if let data = try? Data(contentsOf: indexURL), let value = try? decoder.decode([InstalledGamePackage].self, from: data) { installed = value } }
    private func persistInstalled() throws { try FileManager.default.createDirectory(at: rootDirectory, withIntermediateDirectories: true); try encoder.encode(installed).write(to: indexURL, options: .atomic) }
}

private enum PackageError: LocalizedError { case invalid(String); var errorDescription: String? { if case .invalid(let message) = self { message } else { nil } } }

struct CommunityGameLibrariesSection: View {
    @ObservedObject var store: GamePackageStore
    @State private var packageURL = ""

    var body: some View {
        Section {
            TextField("Game package URL", text: $packageURL)
                .textInputAutocapitalization(.never).keyboardType(.URL).autocorrectionDisabled()
            Button { Task { await store.install(from: packageURL); if store.errorMessage == nil { packageURL = "" } } } label: {
                if store.isInstalling { ProgressView() } else { Label("Install from URL", systemImage: "square.and.arrow.down") }
            }.disabled(store.isInstalling || packageURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if let error = store.errorMessage { Text(error).font(.caption).foregroundStyle(.red) }
            ForEach(store.installed) { package in
                NavigationLink { CommunityGameLibraryView(package: package, store: store) } label: {
                    VStack(alignment: .leading) {
                        Text(package.manifest.game.name)
                        Text("\(package.manifest.catalog.cardCount.formatted()) cards · v\(package.manifest.packageVersion)").font(.caption).foregroundStyle(.secondary)
                    }
                }.swipeActions { Button("Remove", role: .destructive) { store.remove(package) } }
            }
        } header: { Text("Community Game Libraries") } footer: { Text("Only HTTPS, declarative manifests are accepted. Catalog downloads are verified before being saved for offline use.") }
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
            (search.isEmpty || card.name.localizedCaseInsensitiveContains(search)) && package.manifest.filters.allSatisfy { filter in
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
            if !package.manifest.filters.isEmpty { Section("Filters") { ForEach(package.manifest.filters) { filter in FilterControl(filter: filter, values: Binding(get: { selections[filter.id] ?? [] }, set: { selections[filter.id] = $0 })) } } }
            Section("Cards") { ForEach(filteredCards) { card in VStack(alignment: .leading) { Text(card.name); if let set = card.setCode { Text([set, card.collectorNumber].compactMap { $0 }.joined(separator: " ")).font(.caption).foregroundStyle(.secondary) } } } }
        }.navigationTitle(package.manifest.game.name).searchable(text: $search).task { cards = (try? store.cards(for: package)) ?? [] }
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

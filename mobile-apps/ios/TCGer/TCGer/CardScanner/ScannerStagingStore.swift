import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Persistent staging tray for scanned cards.
///
/// The scanner's session tray historically lived in the view model, so
/// dismissing the scanner sheet — let alone relaunching the app — destroyed
/// every staged result. This actor gives the tray a disk twin: each staged
/// scan is one record in a single JSON manifest plus one JPEG sidecar for its
/// captured image, under `Application Support/ScannerStaging/`.
///
/// Storage rules (deliberately mirroring the dev-mode recorder):
/// - The manifest is rewritten in full, atomically, on every mutation, so a
///   crash never leaves a half-written tray.
/// - Every failure path degrades to an empty/in-memory tray rather than
///   crashing scanning; a corrupt manifest reads as no staged cards.
/// - New manifest fields must be optional (or defaulted at decode): the file
///   is a single JSON document, and one unreadable field would otherwise make
///   every previously staged tray fail to decode wholesale.
actor ScannerStagingStore {
    static let shared = ScannerStagingStore()

    struct StagedCandidateRecord: Codable {
        let id: UUID
        let cardID: String
        let name: String
        let game: String
        let setCode: String?
        let setName: String?
        let rarity: String?
        let imageURL: URL?
        let price: Double?
        let confidenceScore: Double
        let confidenceReason: String?
        let originatingStrategy: String
        let debugInfo: [String: String]
        /// The full catalog card when the strategy had one — keeps the
        /// restored tray's add-to-binder path lossless.
        let sourceCard: Card?
    }

    struct StagedScanRecord: Codable {
        let id: UUID
        let mode: String
        let imageFile: String
        let primary: StagedCandidateRecord
        let alternatives: [StagedCandidateRecord]
        let elapsed: TimeInterval
        let stagedAt: Date
        var addedToCollection: Bool
    }

    private struct Manifest: Codable {
        var scans: [StagedScanRecord]
    }

    /// A staged scan rebuilt into the session tray's working shape.
    struct RestoredScan {
        let result: CardScanResult
        let addedToCollection: Bool
    }

    private enum Limits {
        /// Matches the in-memory session cap; oldest scans are dropped first.
        static let maxStagedScans = 100
        static let jpegQuality: Double = 0.8
    }

    private let directory: URL
    private var records: [StagedScanRecord]?

    init(directory: URL = ScannerStagingStore.defaultDirectory()) {
        self.directory = directory
    }

    static func defaultDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ScannerStaging", isDirectory: true)
    }

    // MARK: Tray operations

    /// Rebuilds the persisted tray, oldest first (session order). Records
    /// whose image sidecar is missing or unreadable are dropped — a tray
    /// entry without its thumbnail is not worth resurrecting.
    func restore() -> [RestoredScan] {
        loadIfNeeded().compactMap { record in
            guard let image = loadImage(named: record.imageFile) else { return nil }
            return RestoredScan(
                result: CardScanResult(
                    id: record.id,
                    mode: ScanMode(rawValue: record.mode) ?? .pokemon,
                    capturedImage: image,
                    primary: Self.candidate(from: record.primary),
                    alternatives: record.alternatives.map(Self.candidate(from:)),
                    elapsed: record.elapsed
                ),
                addedToCollection: record.addedToCollection
            )
        }
    }

    func stage(_ result: CardScanResult) {
        var records = loadIfNeeded()
        guard !records.contains(where: { $0.id == result.id }) else { return }
        let imageFile = "\(result.id.uuidString).jpg"
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard write(image: result.capturedImage, to: directory.appendingPathComponent(imageFile))
        else { return }
        records.append(Self.record(from: result, imageFile: imageFile))
        while records.count > Limits.maxStagedScans {
            deleteImage(named: records.removeFirst().imageFile)
        }
        persist(records)
    }

    /// Re-encodes an existing staged scan in place (candidate correction).
    /// The image sidecar and staging timestamp are kept.
    func update(_ result: CardScanResult) {
        var records = loadIfNeeded()
        guard let index = records.firstIndex(where: { $0.id == result.id }) else { return }
        let existing = records[index]
        var updated = Self.record(from: result, imageFile: existing.imageFile)
        updated = StagedScanRecord(
            id: updated.id,
            mode: updated.mode,
            imageFile: existing.imageFile,
            primary: updated.primary,
            alternatives: updated.alternatives,
            elapsed: updated.elapsed,
            stagedAt: existing.stagedAt,
            addedToCollection: existing.addedToCollection
        )
        records[index] = updated
        persist(records)
    }

    func markAdded(_ ids: Set<UUID>) {
        var records = loadIfNeeded()
        var changed = false
        for index in records.indices where ids.contains(records[index].id) {
            records[index].addedToCollection = true
            changed = true
        }
        if changed { persist(records) }
    }

    func remove(id: UUID) {
        var records = loadIfNeeded()
        guard let index = records.firstIndex(where: { $0.id == id }) else { return }
        deleteImage(named: records[index].imageFile)
        records.remove(at: index)
        persist(records)
    }

    func clear() {
        let records = loadIfNeeded()
        for record in records {
            deleteImage(named: record.imageFile)
        }
        persist([])
    }

    // MARK: Mapping

    private static func record(from result: CardScanResult, imageFile: String) -> StagedScanRecord {
        StagedScanRecord(
            id: result.id,
            mode: result.mode.rawValue,
            imageFile: imageFile,
            primary: record(from: result.primary),
            alternatives: result.alternatives.map(record(from:)),
            elapsed: result.elapsed,
            stagedAt: Date(),
            addedToCollection: false
        )
    }

    private static func record(from candidate: CardScanCandidate) -> StagedCandidateRecord {
        StagedCandidateRecord(
            id: candidate.id,
            cardID: candidate.details.identity.id,
            name: candidate.details.identity.name,
            game: candidate.details.identity.game.rawValue,
            setCode: candidate.details.identity.setCode,
            setName: candidate.details.identity.setName,
            rarity: candidate.details.rarity,
            imageURL: candidate.details.imageURL,
            price: candidate.details.price,
            confidenceScore: candidate.confidence.score,
            confidenceReason: candidate.confidence.reason,
            originatingStrategy: candidate.originatingStrategy.rawValue,
            debugInfo: candidate.debugInfo,
            sourceCard: candidate.details.sourceCard
        )
    }

    private static func candidate(from record: StagedCandidateRecord) -> CardScanCandidate {
        CardScanCandidate(
            id: record.id,
            details: CardDetails(
                identity: CardIdentity(
                    id: record.cardID,
                    name: record.name,
                    game: TCGGame(rawValue: record.game) ?? .all,
                    setCode: record.setCode,
                    setName: record.setName
                ),
                rarity: record.rarity,
                imageURL: record.imageURL,
                price: record.price,
                sourceCard: record.sourceCard
            ),
            confidence: CardScanConfidence(
                score: record.confidenceScore,
                reason: record.confidenceReason
            ),
            originatingStrategy: ScanStrategyKind(rawValue: record.originatingStrategy) ?? .manual,
            debugInfo: record.debugInfo
        )
    }

    // MARK: Persistence

    private var manifestURL: URL {
        directory.appendingPathComponent("staged-scans.json")
    }

    private func loadIfNeeded() -> [StagedScanRecord] {
        if let records { return records }
        let loaded = (try? Data(contentsOf: manifestURL))
            .flatMap { try? JSONDecoder().decode(Manifest.self, from: $0) }?
            .scans ?? []
        records = loaded
        return loaded
    }

    private func persist(_ records: [StagedScanRecord]) {
        self.records = records
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(Manifest(scans: records)) {
            try? data.write(to: manifestURL, options: .atomic)
        }
    }

    private func deleteImage(named name: String) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
    }

    private func write(image: CGImage, to url: URL) -> Bool {
        guard let destination = CGImageDestinationCreateWithURL(
            url as CFURL,
            UTType.jpeg.identifier as CFString,
            1,
            nil
        ) else { return false }
        CGImageDestinationAddImage(destination, image, [
            kCGImageDestinationLossyCompressionQuality: Limits.jpegQuality,
        ] as CFDictionary)
        return CGImageDestinationFinalize(destination)
    }

    private func loadImage(named name: String) -> CGImage? {
        let url = directory.appendingPathComponent(name)
        guard let source = CGImageSourceCreateWithURL(url as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }
}

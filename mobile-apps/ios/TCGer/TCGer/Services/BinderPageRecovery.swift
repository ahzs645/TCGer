import Foundation

/// Images and placements are captured before inventory is sent. One protected
/// atomic file contains the intent, confirmed receipt and each upload's progress.
struct DeferredBinderPage: Codable, Equatable, Sendable {
    let pageNumber: Int
    let capturedAt: String
    let placements: [BinderPagePlacement]
    let detectionRowIDs: [String]
    let imageData: Data?
    let expectedRevision: Int
    let expectedPageID: String?

    func matchesContent(of page: SavedBinderPage) -> Bool {
        guard page.placements == placements else { return false }
        return Self.date(capturedAt) == Self.date(page.capturedAt)
    }

    static func date(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds)
        return formatter.date(from: value)
    }
}

struct BinderPageSaveProgress: Codable, Equatable, Sendable {
    let pageNumber: Int
    var expectedRevision: Int
    var expectedPageID: String?
    var placementAttempted = false
    var savedPage: SavedBinderPage?
    var completed = false
}

struct DeferredBinderPageSave: Codable, Identifiable, Sendable {
    let intake: InventoryIntakeDraft
    let pages: [DeferredBinderPage]
    var receipt: InventoryIntakeReceipt?
    var progress: [BinderPageSaveProgress]

    var id: String { intake.operationId }
    var title: String { "Binder scan · \(pages.count) pages · \(intake.rows.count) copies" }

    init(intake: InventoryIntakeDraft, pages: [DeferredBinderPage]) {
        self.intake = intake
        self.pages = pages
        self.progress = pages.map {
            BinderPageSaveProgress(pageNumber: $0.pageNumber, expectedRevision: $0.expectedRevision, expectedPageID: $0.expectedPageID)
        }
    }

    /// Keeps the physical-copy linkage available even after scanner memory is
    /// gone. Page endpoints still use their existing printing-based placements.
    func committedCopyIDs(on page: DeferredBinderPage) -> [String] {
        let rowIDs = Set(page.detectionRowIDs)
        return receipt?.rows.filter { rowIDs.contains($0.rowId) }.flatMap(\.entryIds) ?? []
    }
}

@MainActor
final class BinderPageSaveJournal {
    static let shared = BinderPageSaveJournal()
    typealias Writer = (Data, URL) throws -> Void
    private let directory: URL
    private let writer: Writer
    private var active: Set<String> = []

    init(directory: URL? = nil, writer: Writer? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("BinderPageSaves", isDirectory: true)
        self.writer = writer ?? { data, url in
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    func pending(scope: String) throws -> [DeferredBinderPageSave] {
        let url = try file(scope: scope)
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        let attempts = try JSONDecoder().decode([DeferredBinderPageSave].self, from: Data(contentsOf: url))
        for attempt in attempts { try validate(attempt) }
        return attempts
    }

    func attempt(id: String, scope: String) throws -> DeferredBinderPageSave {
        guard let attempt = try pending(scope: scope).first(where: { $0.id == id }) else {
            throw APIService.APIError.serverError(status: 404, message: "This binder save is no longer pending.")
        }
        return attempt
    }

    func save(_ attempt: DeferredBinderPageSave, scope: String) throws {
        try validate(attempt)
        var attempts = try pending(scope: scope)
        if let existing = attempts.first(where: { $0.id == attempt.id }) {
            guard try immutableData(existing) == immutableData(attempt) else {
                throw APIService.APIError.serverError(status: 409, message: "Resume the original saved binder scan before changing its details.")
            }
            return
        }
        attempts.append(attempt)
        try write(attempts, scope: scope)
    }

    private func validate(_ attempt: DeferredBinderPageSave) throws {
        guard !attempt.id.isEmpty, !attempt.pages.isEmpty,
              Set(attempt.pages.map(\.pageNumber)).count == attempt.pages.count,
              attempt.pages.allSatisfy({ $0.pageNumber > 0 && $0.expectedRevision >= 0 && DeferredBinderPage.date($0.capturedAt) != nil }),
              Set(attempt.pages.flatMap(\.detectionRowIDs)) == Set(attempt.intake.rows.map(\.rowId)),
              attempt.pages.flatMap(\.detectionRowIDs).count == attempt.intake.rows.count,
              attempt.progress.map(\.pageNumber) == attempt.pages.map(\.pageNumber),
              attempt.progress.allSatisfy({ $0.expectedRevision >= 0 }) else {
            throw APIService.APIError.serverError(status: 400, message: "The binder scan recovery snapshot is incomplete.")
        }
        if let receipt = attempt.receipt {
            guard receipt.operationId == attempt.id,
                  receipt.rows.count == attempt.intake.rows.count,
                  Set(receipt.rows.map(\.rowId)) == Set(attempt.intake.rows.map(\.rowId)),
                  Set(receipt.entryIds).count == receipt.entryIds.count,
                  receipt.entryIds.count == attempt.intake.rows.reduce(0, { $0 + $1.details.quantity }),
                  Set(receipt.rows.flatMap(\.entryIds)) == Set(receipt.entryIds),
                  attempt.intake.rows.allSatisfy({ row in receipt.rows.first(where: { $0.rowId == row.rowId })?.entryIds.count == row.details.quantity }) else {
                throw APIService.APIError.decodingError
            }
        }
    }

    func update(_ attempt: DeferredBinderPageSave, scope: String) throws {
        try validate(attempt)
        var attempts = try pending(scope: scope)
        guard let index = attempts.firstIndex(where: { $0.id == attempt.id }),
              try immutableData(attempts[index]) == immutableData(attempt),
              attempts[index].receipt == nil || attempts[index].receipt == attempt.receipt else {
            throw APIService.APIError.serverError(status: 409, message: "The saved binder attempt changed. Reload Pending saves.")
        }
        attempts[index] = attempt
        try write(attempts, scope: scope)
    }

    func complete(id: String, scope: String) throws {
        let attempts = try pending(scope: scope)
        guard let attempt = attempts.first(where: { $0.id == id }), attempt.receipt != nil,
              attempt.progress.count == attempt.pages.count, attempt.progress.allSatisfy(\.completed) else {
            throw APIService.APIError.serverError(status: 409, message: "The inventory receipt and all page decisions must be confirmed before removing recovery data.")
        }
        try write(attempts.filter { $0.id != id }, scope: scope)
    }

    func begin(id: String, scope: String) throws {
        guard active.insert(scope + ":" + id).inserted else {
            throw APIService.APIError.serverError(status: 409, message: "This binder save is already resuming.")
        }
    }

    func end(id: String, scope: String) { active.remove(scope + ":" + id) }

    private func immutableData(_ attempt: DeferredBinderPageSave) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(DeferredBinderPageSave(intake: attempt.intake, pages: attempt.pages))
    }

    private func file(scope: String) throws -> URL {
        guard !scope.isEmpty, scope != ".", scope != "..", scope.range(of: "^[A-Za-z0-9._-]+$", options: .regularExpression) != nil else {
            throw CocoaError(.fileWriteInvalidFileName)
        }
        return directory.appendingPathComponent(scope + ".json")
    }

    private func write(_ attempts: [DeferredBinderPageSave], scope: String) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try writer(JSONEncoder().encode(attempts), file(scope: scope))
    }
}

@MainActor
protocol BinderPageRecoveryService {
    func commitInventoryIntake(config: ServerConfiguration, token: String, draft: InventoryIntakeDraft) async throws -> InventoryIntakeReceipt
    func getBinderPages(config: ServerConfiguration, token: String?, binderId: String) async throws -> [SavedBinderPage]
    func upsertBinderPage(config: ServerConfiguration, token: String?, binderId: String, pageNumber: Int, capturedAt: Date, placements: [BinderPagePlacement], expectedRevision: Int?) async throws -> SavedBinderPage
    func replaceBinderPageImage(config: ServerConfiguration, token: String?, binderId: String, pageNumber: Int, imageData: Data, expectedRevision: Int?) async throws -> SavedBinderPage
}

extension APIService: BinderPageRecoveryService { }

struct BinderPageRecoveryConflict: LocalizedError, Identifiable {
    let operationID: String
    let pageNumber: Int
    let currentPage: SavedBinderPage?
    var id: String { "\(operationID)-\(pageNumber)-\(currentPage?.revision ?? 0)" }
    var errorDescription: String? { "Page \(pageNumber) changed after this scan was saved. Review the current page before choosing which version to keep." }
}

enum BinderPageConflictResolution { case keepCurrent, replaceWithSavedScan }

struct BinderPageRecoveryResult {
    let receipt: InventoryIntakeReceipt
    let pages: [SavedBinderPage]
}

@MainActor
final class BinderPageRecoveryCoordinator {
    private let journal: BinderPageSaveJournal
    private let service: any BinderPageRecoveryService

    init(journal: BinderPageSaveJournal = .shared, service: any BinderPageRecoveryService) {
        self.journal = journal
        self.service = service
    }

    func resolve(_ conflict: BinderPageRecoveryConflict, keeping resolution: BinderPageConflictResolution, scope: String) throws {
        try journal.begin(id: conflict.operationID, scope: scope)
        defer { journal.end(id: conflict.operationID, scope: scope) }
        var attempt = try journal.attempt(id: conflict.operationID, scope: scope)
        guard attempt.receipt != nil, let index = attempt.progress.firstIndex(where: { $0.pageNumber == conflict.pageNumber }),
              !attempt.progress[index].completed else {
            throw APIService.APIError.decodingError
        }
        switch resolution {
        case .keepCurrent:
            attempt.progress[index].savedPage = conflict.currentPage
            attempt.progress[index].completed = true
        case .replaceWithSavedScan:
            attempt.progress[index].expectedRevision = conflict.currentPage?.revision ?? 0
            attempt.progress[index].expectedPageID = conflict.currentPage?.id
            attempt.progress[index].placementAttempted = false
            attempt.progress[index].savedPage = nil
            attempt.progress[index].completed = false
        }
        try journal.update(attempt, scope: scope)
    }

    func resume(id: String, scope: String, config: ServerConfiguration, token: String, isCurrent: @MainActor () -> Bool) async throws -> BinderPageRecoveryResult {
        try journal.begin(id: id, scope: scope)
        defer { journal.end(id: id, scope: scope) }
        func requireCurrent() throws {
            guard isCurrent(), !Task.isCancelled else { throw CancellationError() }
        }
        try requireCurrent()
        var attempt = try journal.attempt(id: id, scope: scope)
        if attempt.receipt == nil {
            let receipt = try await service.commitInventoryIntake(config: config, token: token, draft: attempt.intake)
            try requireCurrent()
            guard receipt.operationId == attempt.id,
                  Set(receipt.rows.map(\.rowId)) == Set(attempt.intake.rows.map(\.rowId)),
                  Set(receipt.entryIds).count == receipt.entryIds.count,
                  receipt.entryIds.count == attempt.intake.rows.reduce(0, { $0 + $1.details.quantity }) else {
                throw APIService.APIError.decodingError
            }
            attempt.receipt = receipt
            try journal.update(attempt, scope: scope)
        }

        for index in attempt.pages.indices {
            try requireCurrent()
            if attempt.progress[index].completed { continue }
            let page = attempt.pages[index]
            let current = try await service.getBinderPages(config: config, token: token, binderId: attempt.intake.collectionId)
                .first { $0.pageNumber == page.pageNumber }
            try requireCurrent()
            let progress = attempt.progress[index]
            func conflict(_ current: SavedBinderPage?) -> BinderPageRecoveryConflict {
                BinderPageRecoveryConflict(operationID: id, pageNumber: page.pageNumber, currentPage: current)
            }
            if let saved = progress.savedPage {
                guard current == saved else { throw conflict(current) }
            } else if progress.placementAttempted, let current,
                      current.revision == progress.expectedRevision + 1,
                      (progress.expectedPageID == nil || current.id == progress.expectedPageID),
                      page.matchesContent(of: current) {
                // A lost PUT response can be recognized by the frozen content
                // and exactly one revision advance. Images never use this rule.
                attempt.progress[index].savedPage = current
                try journal.update(attempt, scope: scope)
            } else {
                guard (current?.revision ?? 0) == progress.expectedRevision,
                      current?.id == progress.expectedPageID,
                      let date = DeferredBinderPage.date(page.capturedAt) else { throw conflict(current) }
                attempt.progress[index].placementAttempted = true
                try journal.update(attempt, scope: scope)
                do {
                    let saved = try await service.upsertBinderPage(config: config, token: token, binderId: attempt.intake.collectionId, pageNumber: page.pageNumber, capturedAt: date, placements: page.placements, expectedRevision: progress.expectedRevision)
                    try requireCurrent()
                    guard saved.binderId == attempt.intake.collectionId, saved.pageNumber == page.pageNumber,
                          saved.revision == progress.expectedRevision + 1, page.matchesContent(of: saved) else { throw APIService.APIError.decodingError }
                    attempt.progress[index].savedPage = saved
                    try journal.update(attempt, scope: scope)
                } catch APIService.APIError.serverError(let status, _) where status == 409 {
                    let latest = try await service.getBinderPages(config: config, token: token, binderId: attempt.intake.collectionId).first { $0.pageNumber == page.pageNumber }
                    try requireCurrent()
                    throw conflict(latest)
                }
            }

            if let image = page.imageData, let saved = attempt.progress[index].savedPage {
                do {
                    let uploaded = try await service.replaceBinderPageImage(config: config, token: token, binderId: attempt.intake.collectionId, pageNumber: page.pageNumber, imageData: image, expectedRevision: saved.revision)
                    try requireCurrent()
                    guard uploaded.id == saved.id, uploaded.revision == saved.revision + 1,
                          uploaded.imageUrl != nil, page.matchesContent(of: uploaded) else { throw APIService.APIError.decodingError }
                    attempt.progress[index].savedPage = uploaded
                } catch APIService.APIError.serverError(let status, _) where status == 409 {
                    let latest = try await service.getBinderPages(config: config, token: token, binderId: attempt.intake.collectionId).first { $0.pageNumber == page.pageNumber }
                    try requireCurrent()
                    throw conflict(latest)
                }
            }
            attempt.progress[index].completed = true
            try journal.update(attempt, scope: scope)
        }
        try requireCurrent()
        guard let receipt = attempt.receipt else { throw APIService.APIError.decodingError }
        try journal.complete(id: id, scope: scope)
        return BinderPageRecoveryResult(receipt: receipt, pages: attempt.progress.compactMap(\.savedPage))
    }
}

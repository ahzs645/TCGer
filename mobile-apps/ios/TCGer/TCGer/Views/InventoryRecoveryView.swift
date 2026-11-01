import SwiftUI

struct InventoryRecoveryView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var operations: [PendingInventoryOperation] = []
    @State private var binderSaves: [DeferredBinderPageSave] = []
    @State private var pageReview: BinderPageRecoveryReviewContext?
    @State private var busyID: String?
    @State private var message: String?
    @State private var loadedGeneration: UUID?
    private let apiService = APIService()

    var body: some View {
        List {
            Section {
                Text("Each attempt keeps its original destination, copies, prices, and operation ID. Binder scans also keep their page positions and image. Resume after a timeout or app restart; confirmed copies are never added again.")
            }
            ForEach(binderSaves) { saved in
                Section {
                    Text(saved.title)
                    if let receipt = saved.receipt {
                        Text("\(receipt.entryIds.count) physical copies confirmed. Resuming page details only.")
                            .font(.caption).foregroundStyle(.secondary)
                    } else { Text("Inventory receipt is still pending.").font(.caption).foregroundStyle(.secondary) }
                    Text("\(saved.progress.filter(\.completed).count) of \(saved.pages.count) pages complete")
                        .font(.caption)
                    Button(busyID == saved.id ? "Resuming…" : "Resume binder scan") {
                        Task { await resumeBinderSave(saved.id) }
                    }.disabled(busyID != nil || !supports(saved))
                    if !supports(saved) {
                        Text("Connect to an updated server with guarded binder-page saves and atomic intake. Your saved image and confirmed copy IDs remain on this phone.").font(.caption)
                    }
                }
            }
            ForEach(operations) { operation in
                Section {
                    Text(operation.title)
                    Text(operation.id).font(.caption).foregroundStyle(.secondary)
                    Button(busyID == operation.id ? "Resuming…" : "Resume saved attempt") {
                        Task { await resume(operation) }
                    }.disabled(busyID != nil || !supports(operation))
                    if !supports(operation) {
                        Text("Connect this account to a server with atomic inventory operations before resuming.").font(.caption)
                    }
                }
            }
            if operations.isEmpty && binderSaves.isEmpty { Text("No pending saves for this account and server.") }
            if let message { Text(message).font(.callout) }
        }
        .navigationTitle("Pending saves")
        .task(id: environmentStore.widgetSessionID) { load() }
        .sheet(item: $pageReview) { context in
            BinderPageConflictReviewView(context: context) { resolution in
                guard environmentStore.matches(context.session) else { throw CancellationError() }
                try BinderPageRecoveryCoordinator(service: apiService).resolve(context.conflict, keeping: resolution, scope: context.scope)
                Task { await resumeBinderSave(context.attempt.id) }
            }
        }
    }

    private func supports(_ saved: DeferredBinderPageSave) -> Bool {
        environmentStore.serverConfiguration.isOnDevice ||
            (environmentStore.serverFeatures.binderPageRevisionGuards && (saved.receipt != nil || environmentStore.serverFeatures.atomicIntake))
    }

    private func supports(_ operation: PendingInventoryOperation) -> Bool {
        if environmentStore.serverConfiguration.isOnDevice { return true }
        switch operation {
        case .sale: return environmentStore.serverFeatures.atomicSales
        case .intake: return environmentStore.serverFeatures.atomicIntake
        }
    }

    @MainActor
    private func load() {
        operations = []
        binderSaves = []
        if loadedGeneration != environmentStore.widgetSessionID {
            loadedGeneration = environmentStore.widgetSessionID
            message = nil
            pageReview = nil
            busyID = nil
        }
        guard let token = environmentStore.authToken else { operations = []; binderSaves = []; return }
        do {
            let scope = InventoryOperationJournal.scope(config: environmentStore.serverConfiguration, userID: environmentStore.currentUser?.id, token: token)
            binderSaves = try BinderPageSaveJournal.shared.pending(scope: scope)
            let binderSaveIDs = Set(binderSaves.map(\.id))
            operations = try InventoryOperationJournal.shared.pending(scope: scope).filter { !binderSaveIDs.contains($0.id) }
        } catch { message = error.localizedDescription }
    }

    @MainActor
    private func resumeBinderSave(_ id: String) async {
        guard busyID == nil, let token = environmentStore.authToken else { return }
        let session = environmentStore.sessionIdentity
        let scope = InventoryOperationJournal.scope(config: session.configuration, userID: environmentStore.currentUser?.id, token: token)
        busyID = id
        message = nil
        defer { if environmentStore.matches(session), busyID == id { busyID = nil } }
        do {
            let saved = try BinderPageSaveJournal.shared.attempt(id: id, scope: scope)
            guard supports(saved) else { return }
            if try InventoryOperationJournal.shared.pending(scope: scope).contains(where: { $0.id == id }) {
                try InventoryOperationJournal.shared.complete(id: id, scope: scope)
            }
            let result = try await BinderPageRecoveryCoordinator(service: apiService).resume(id: id, scope: scope, config: session.configuration, token: token, isCurrent: { environmentStore.matches(session) })
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            CollectionMutationNotice.post(config: session.configuration, token: token)
            message = "Binder scan recovered. \(result.receipt.entryIds.count) original physical copy IDs are confirmed, and every page upload or review decision is complete."
            load()
        } catch {
            guard environmentStore.matches(session), !(error is CancellationError) else { return }
            load()
            if let saved = try? BinderPageSaveJournal.shared.attempt(id: id, scope: scope) {
                if saved.receipt != nil { CollectionMutationNotice.post(config: session.configuration, token: token) }
                if let conflict = error as? BinderPageRecoveryConflict {
                    pageReview = BinderPageRecoveryReviewContext(conflict: conflict, attempt: saved, scope: scope, session: session)
                    return
                }
            }
            message = error.localizedDescription
        }
    }

    @MainActor
    private func resume(_ operation: PendingInventoryOperation) async {
        guard busyID == nil, supports(operation), let token = environmentStore.authToken else { return }
        let session = environmentStore.sessionIdentity
        let scope = InventoryOperationJournal.scope(config: session.configuration, userID: environmentStore.currentUser?.id, token: token)
        busyID = operation.id
        message = nil
        defer { if environmentStore.matches(session), busyID == operation.id { busyID = nil } }
        do {
            switch operation {
            case .sale(let request):
                _ = try await apiService.recordInventorySale(config: session.configuration, token: token, request: request)
            case .intake(let draft):
                let receipt = try await apiService.commitInventoryIntake(config: session.configuration, token: token, draft: draft)
                guard environmentStore.matches(session), !Task.isCancelled else { throw CancellationError() }
                try await ScannerStagingStore.shared.markAddedDurably(Set(receipt.rows.compactMap { UUID(uuidString: $0.rowId) }))
            }
            guard environmentStore.matches(session), !Task.isCancelled else { throw CancellationError() }
            try InventoryOperationJournal.shared.complete(id: operation.id, scope: scope)
            CollectionMutationNotice.post(config: session.configuration, token: token)
            message = "Confirmed saved. The original receipt was recovered."
            load()
        } catch {
            guard environmentStore.matches(session), !(error is CancellationError) else { return }
            message = error.localizedDescription
        }
    }
}

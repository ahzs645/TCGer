import SwiftUI

struct PackOpeningReviewSheet: View {
    private struct PullSummary: Identifiable {
        let pull: PackOpeningPull
        let quantity: Int
        var id: String { pull.cardId }
    }

    let session: PackOpeningPullSession
    let onSaved: () -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var collections: [Collection] = []
    @State private var inventory: [SealedInventoryItem] = []
    @State private var selectedCollectionID = ""
    @State private var selectedInventoryID: String?
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var savedPullCount = 0
    @State private var savedCopyIDs: [String] = []
    @State private var errorMessage: String?

    private let apiService = APIService()

    private var eligibleInventory: [SealedInventoryItem] {
        inventory.filter { item in
            let type = item.product.productType.lowercased()
            let matchesPack = type.contains("booster") && !type.contains("box")
            let matchesGame = session.tcg.map { item.product.tcg.caseInsensitiveCompare($0) == .orderedSame } ?? true
            let matchesSet = session.setCode.map {
                item.product.setCode?.caseInsensitiveCompare($0) == .orderedSame
            } ?? true
            return matchesPack && matchesGame && matchesSet && item.quantity >= session.packs.count
        }
        .sorted { $0.product.name < $1.product.name }
    }

    private var groupedPulls: [PullSummary] {
        let groups = Dictionary(grouping: session.pulls, by: \.cardId)
        return groups.values
            .compactMap { pulls in
                pulls.first.map { PullSummary(pull: $0, quantity: pulls.count) }
            }
            .sorted {
                if $0.pull.tier != $1.pull.tier { return tierRank($0.pull.tier) > tierRank($1.pull.tier) }
                return $0.pull.name < $1.pull.name
            }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Opening", value: session.packLabel)
                    LabeledContent("Packs", value: "\(session.packs.count)")
                    LabeledContent("Cards", value: "\(session.pulls.count)")
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 12) {
                            ForEach(groupedPulls) { entry in
                                pullPreview(entry.pull, quantity: entry.quantity)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } header: {
                    Text("Review pulls")
                }

                Section {
                    if isLoading {
                        HStack { Spacer(); ProgressView(); Spacer() }
                    } else if collections.isEmpty {
                        ContentUnavailableView(
                            "No Collection Available",
                            systemImage: "rectangle.stack.badge.plus",
                            description: Text("Create a binder or library before saving these pulls.")
                        )
                    } else {
                        Picker("Destination", selection: $selectedCollectionID) {
                            ForEach(collections.sortedForDisplay()) { collection in
                                Text(collection.name).tag(collection.id)
                            }
                        }
                        .disabled(savedPullCount > 0)
                    }
                } header: {
                    Text("Add to collection")
                } footer: {
                    Text("Every revealed card is added as its own collection copy.")
                }

                Section {
                    Picker("Physical product", selection: $selectedInventoryID) {
                        Text("Don’t link inventory").tag(nil as String?)
                        ForEach(eligibleInventory) { item in
                            Text("\(item.product.name) · \(item.quantity) owned")
                                .tag(Optional(item.id))
                        }
                    }
                    .disabled(environmentStore.serverConfiguration.isOnDevice || eligibleInventory.isEmpty)
                } header: {
                    Text("Physical opening (optional)")
                } footer: {
                    if environmentStore.serverConfiguration.isOnDevice {
                        Text("Collection saving works on-device. Physical-opening ledgers require a connected TCGer server.")
                    } else if eligibleInventory.isEmpty {
                        Text("No matching booster-pack inventory has enough quantity for this opening.")
                    } else {
                        Text("Linking subtracts \(session.packs.count) pack\(session.packs.count == 1 ? "" : "s") from inventory and associates every saved card copy with the ledger.")
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Save Pulls")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isSaving)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task { await save() }
                    }
                    .disabled(isSaving || isLoading || collections.isEmpty || selectedCollectionID.isEmpty)
                }
            }
            .task { await load() }
        }
    }

    private func pullPreview(_ pull: PackOpeningPull, quantity: Int) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            AsyncImage(url: URL(string: pull.imageUrlSmall)) { image in
                image.resizable().scaledToFit()
            } placeholder: {
                RoundedRectangle(cornerRadius: 8).fill(.quaternary)
                    .overlay { ProgressView() }
            }
            .frame(width: 82, height: 114)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Text(pull.name)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .frame(width: 82, alignment: .leading)
            if quantity > 1 {
                Text("×\(quantity)").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Sign in before saving pack pulls."
            isLoading = false
            return
        }
        do {
            async let loadedCollections = apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: false
            )
            async let loadedInventory = apiService.getUserSealedInventory(
                config: environmentStore.serverConfiguration,
                token: token
            )
            collections = try await loadedCollections
            inventory = (try? await loadedInventory) ?? []
            selectedCollectionID = collections.first(where: \.isUnsortedBinder)?.id
                ?? collections.sortedForDisplay().first?.id
                ?? ""
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func save() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Sign in before saving pack pulls."
            return
        }
        isSaving = true
        errorMessage = nil

        do {
            let notes = "Opened from \(session.packLabel) via Pack Opening"
            let originalCopyIDs = Set(
                collections.first(where: { $0.id == selectedCollectionID })?
                    .cards.flatMap(\.copies).map(\.id) ?? []
            )
            for pull in session.pulls.dropFirst(savedPullCount) {
                let copyID = try await apiService.addCardToBinder(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: selectedCollectionID,
                    card: pull.card,
                    details: BinderCardAddDetails(quantity: 1, notes: notes)
                )
                savedPullCount += 1
                if let copyID { savedCopyIDs.append(copyID) }
            }

            if let selectedInventoryID {
                if savedCopyIDs.count != session.pulls.count {
                    let refreshed = try await apiService.getCollections(
                        config: environmentStore.serverConfiguration,
                        token: token,
                        useCache: false
                    )
                    let currentCopyIDs = Set(
                        refreshed.first(where: { $0.id == selectedCollectionID })?
                            .cards.flatMap(\.copies).map(\.id) ?? []
                    )
                    savedCopyIDs = Array(currentCopyIDs.subtracting(originalCopyIDs))
                }
                guard savedCopyIDs.count == session.pulls.count else {
                    throw PackOpeningSaveError.missingCopyIdentifiers
                }
                _ = try await apiService.createSealedOpening(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    inventoryId: selectedInventoryID,
                    openedQuantity: session.packs.count,
                    collectionIds: savedCopyIDs,
                    openedAt: session.openedAt,
                    notes: notes
                )
            }

            NotificationCenter.default.post(name: .collectionDidChange, object: nil)
            HapticManager.notification(.success)
            onSaved()
            dismiss()
        } catch {
            let prefix = savedPullCount > 0 ? "\(savedPullCount) cards were saved. " : ""
            errorMessage = prefix + error.localizedDescription
            isSaving = false
        }
    }

    private func tierRank(_ tier: String) -> Int {
        switch tier {
        case "chase": 4
        case "ultra": 3
        case "rare": 2
        case "uncommon": 1
        default: 0
        }
    }
}

private enum PackOpeningSaveError: LocalizedError {
    case missingCopyIdentifiers

    var errorDescription: String? {
        "The cards were added, but their exact copy IDs were not returned, so the physical ledger was not created. Try saving again to retry only the ledger."
    }
}

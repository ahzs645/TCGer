import SwiftUI

struct StorageAuditView: View {
    let container: StorageContainer
    let compartment: StorageCompartment
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var source = "manual"
    @State private var observedPlacementIDs: Set<String>
    @State private var observedJSON = "[]"
    @State private var preview: StorageAuditResult?
    @State private var reviewedRequest: StorageAuditRequest?
    @State private var busy = false
    @State private var message: String?
    private let apiService = APIService()

    init(container: StorageContainer, compartment: StorageCompartment) {
        self.container = container
        self.compartment = compartment
        _observedPlacementIDs = State(initialValue: Set(compartment.placements.map(\.id)))
    }

    var body: some View {
        Form {
            Section {
                Picker("Observation source", selection: $source) {
                    Text("Manual check").tag("manual")
                    Text("Observed-card JSON").tag("import")
                    if container.binderId != nil { Text("Latest binder scan").tag("latest-binder-scan") }
                }
                if source == "manual" {
                    ForEach(compartment.placements) { placement in
                        Toggle(isOn: Binding(
                            get: { observedPlacementIDs.contains(placement.id) },
                            set: { if $0 { observedPlacementIDs.insert(placement.id) } else { observedPlacementIDs.remove(placement.id) } }
                        )) {
                            VStack(alignment: .leading) {
                                Text("Slot \(placement.slotIndex + 1) · \(placement.cardName ?? placement.printedName ?? placement.collectionEntryId)")
                                Text("\(placement.quantity) expected").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                } else if source == "import" {
                    TextEditor(text: $observedJSON).font(.system(.caption, design: .monospaced)).frame(minHeight: 140)
                    Text("Each observation uses compartmentId, zero-based slotIndex, quantity, and either collectionEntryId or externalId with tcg. Use this to record extra or wrong cards.").font(.caption)
                } else {
                    Text("Compare the newest saved scan for page \(compartment.pageNumber.map(String.init) ?? "—") with this location.")
                }
            } header: { Text("Observe \(compartment.label)") } footer: {
                Text("Uncheck missing cards. Saving an audit records what you observed and never moves or deletes inventory.")
            }
            .disabled(busy)
            Button(busy ? "Working…" : "Preview audit") { Task { await runPreview() } }.disabled(busy)
            if let preview {
                Section("Review differences") {
                    ForEach(["correct", "missing", "wrong", "extra"], id: \.self) { status in
                        LabeledContent(status.capitalized, value: "\(preview.summary[status] ?? 0)")
                    }
                    ForEach(preview.issues, id: \.self) { Text($0).foregroundStyle(.red) }
                    ForEach(Array(preview.items.enumerated()), id: \.offset) { _, item in
                        VStack(alignment: .leading) {
                            Text("Slot \(item.slotIndex + 1) · \(item.status.capitalized)").font(.headline)
                            Text("Expected: \(item.expectedName ?? "Empty") × \(item.expectedQuantity)")
                            Text("Observed: \(item.observedName ?? "Empty") × \(item.observedQuantity)")
                        }.font(.caption)
                    }
                }
                Button("Save reviewed audit") { Task { await commit() } }
                    .disabled(busy || !preview.valid || reviewedRequest == nil || preview.id != nil)
            }
            if let message { Section { Text(message) } }
        }
        .navigationTitle("Audit location")
        .onChange(of: source) { invalidatePreview() }
        .onChange(of: observedPlacementIDs) { invalidatePreview() }
        .onChange(of: observedJSON) { invalidatePreview() }
    }

    private func invalidatePreview() {
        preview = nil
        reviewedRequest = nil
        message = nil
    }

    private func request() throws -> StorageAuditRequest {
        let observations: [StorageAuditObservation]?
        switch source {
        case "manual":
            observations = compartment.placements.filter { observedPlacementIDs.contains($0.id) }.map {
                StorageAuditObservation(compartmentId: compartment.id, slotIndex: $0.slotIndex, collectionEntryId: $0.collectionEntryId, quantity: $0.quantity)
            }
        case "import": observations = try JSONDecoder().decode([StorageAuditObservation].self, from: Data(observedJSON.utf8))
        default: observations = nil
        }
        return StorageAuditRequest(containerId: container.id, compartmentId: compartment.id, source: source, observations: observations)
    }

    @MainActor
    private func runPreview() async {
        guard !busy, let token = environmentStore.authToken else { return }
        let session = environmentStore.sessionIdentity
        busy = true
        defer { busy = false }
        do {
            let input = try request()
            let result = try await apiService.previewStorageAudit(config: session.configuration, token: token, request: input)
            guard environmentStore.matches(session), !Task.isCancelled, try input == request() else { return }
            preview = result
            reviewedRequest = result.valid ? input : nil
            message = nil
        } catch {
            guard environmentStore.matches(session), !(error is CancellationError) else { return }
            invalidatePreview()
            message = error.localizedDescription
        }
    }

    @MainActor
    private func commit() async {
        guard !busy, preview?.valid == true, let input = reviewedRequest, let token = environmentStore.authToken else { return }
        let session = environmentStore.sessionIdentity
        busy = true
        defer { busy = false }
        do {
            guard try input == request() else { invalidatePreview(); return }
            let result = try await apiService.commitStorageAudit(config: session.configuration, token: token, request: input)
            guard environmentStore.matches(session), !Task.isCancelled else { return }
            preview = result
            reviewedRequest = nil
            message = "Saved as a reviewed observation. Inventory was not changed."
        } catch {
            guard environmentStore.matches(session), !(error is CancellationError) else { return }
            message = error.localizedDescription
        }
    }
}

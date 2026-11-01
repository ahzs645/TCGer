import SwiftUI

struct PackOpeningReviewSheet: View {
    let session: PackOpeningPullSession
    let onSaved: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Simulated opening", value: session.packLabel)
                    LabeledContent("Packs", value: "\(session.packs.count)")
                    LabeledContent("Cards", value: "\(session.pulls.count)")
                } footer: {
                    Text("This saves a simulation on this phone. It does not add owned cards, change collection value, or subtract sealed stock.")
                }
                Section("Simulated pulls") {
                    ForEach(Array(session.pulls.enumerated()), id: \.offset) { _, pull in
                        HStack {
                            AsyncImage(url: URL(string: pull.imageUrlSmall)) { image in
                                image.resizable().scaledToFit()
                            } placeholder: { Color.secondary.opacity(0.1) }
                            .frame(width: 40, height: 56)
                            VStack(alignment: .leading) {
                                Text(pull.name)
                                Text([pull.setName, pull.collectorNumber, pull.rarity].filter { !$0.isEmpty }.joined(separator: " · "))
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
                Section("Recording a real opening") {
                    Text("Scan the cards you actually opened, then choose Review Scans. Select the physical product and number of opened units there to record the reviewed copies and sealed stock together.")
                }
                if let errorMessage { Section { Text(errorMessage).foregroundStyle(.red) } }
            }
            .navigationTitle("Save simulation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() }.disabled(isSaving) }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save history") {
                        guard !isSaving else { return }
                        isSaving = true
                        do {
                            try PackSimulationStore.shared.save(session)
                            onSaved()
                            dismiss()
                        } catch {
                            errorMessage = error.localizedDescription
                            isSaving = false
                        }
                    }.disabled(isSaving)
                }
            }
        }
    }
}

struct PackSimulationHistoryView: View {
    @State private var history = PackSimulationStore.History()
    @State private var errorMessage: String?
    var body: some View {
        List {
            Section {
                Text("Saved simulations and favorites are reference cards. They are separate from the cards you own.").foregroundStyle(.secondary)
            }
            Section("Simulations") {
                ForEach(history.sessions) { session in
                    NavigationLink {
                        PackOpeningReviewSheet(session: session, onSaved: {})
                    } label: {
                        VStack(alignment: .leading) {
                            Text(session.packLabel)
                            Text("\(session.pulls.count) cards · \(session.openedAt)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
                if history.sessions.isEmpty { Text("No saved simulations") }
            }
            Section("Simulation favorites") {
                ForEach(Array(history.favorites.enumerated()), id: \.offset) { _, card in
                    VStack(alignment: .leading) {
                        Text(card.name)
                        Text("\(card.tcg) · \(card.setName ?? card.setCode ?? "")").font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
        }
        .navigationTitle("Simulation history")
        .task {
            do { history = try PackSimulationStore.shared.history() }
            catch { errorMessage = error.localizedDescription }
        }
    }
}

import SwiftUI

struct DeckCheckoutView: View {
    let deckId: String
    let deckName: String

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var session: DeckCheckoutSession?
    @State private var note = ""
    @State private var isLoading = true
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        List {
            if isLoading {
                ProgressView("Loading checkout…")
            } else if let errorMessage, session == nil {
                ErrorView(title: "Couldn’t Load Checkout", message: errorMessage) {
                    Task { await load() }
                }
            } else if let session {
                Section {
                    Label(
                        session.isCheckedOut ? "Deck is checked out" : "Deck has been checked in",
                        systemImage: session.isCheckedOut ? "arrow.up.right.square.fill" : "checkmark.circle.fill"
                    )
                    .foregroundStyle(session.isCheckedOut ? .orange : .green)
                    if let note = session.note { Text(note).foregroundStyle(.secondary) }
                }

                Section(session.isCheckedOut ? "Pull List" : "Refiling List") {
                    ForEach(orderedAllocations(session)) { allocation in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(allocation.printedName ?? allocation.cardName ?? allocation.collectionEntryId)
                                Text(allocation.locationDescription)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("×\(allocation.quantity)").font(.headline.monospacedDigit())
                            if allocation.refilledAt != nil {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                            }
                        }
                    }
                }

                if session.isCheckedOut {
                    Section {
                        Button(isSaving ? "Checking In…" : "Check In and Refile", role: .none) {
                            Task { await checkin() }
                        }
                        .disabled(isSaving)
                    } footer: {
                        Text("Checking in releases every reserved copy and preserves this location snapshot as the refile guide.")
                    }
                }
            } else {
                Section("Checkout Note") {
                    TextField("Tournament, meetup, or reason (optional)", text: $note, axis: .vertical)
                }
                Section {
                    Button(isSaving ? "Reserving Cards…" : "Check Out Deck") {
                        Task { await checkout() }
                    }
                    .disabled(isSaving)
                } footer: {
                    Text("TCGer reserves concrete owned copies, rejects over-allocation, and generates an ordered page-and-slot pull list.")
                }
            }

            if let errorMessage, session != nil {
                Section { Text(errorMessage).foregroundStyle(.red) }
            }
        }
        .navigationTitle("\(deckName) Checkout")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Done") { dismiss() }
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func orderedAllocations(_ session: DeckCheckoutSession) -> [DeckCheckoutAllocation] {
        session.allocations.sorted {
            let left = [$0.containerName ?? "", $0.compartmentLabel ?? "", String($0.slotIndex ?? .max)]
            let right = [$1.containerName ?? "", $1.compartmentLabel ?? "", String($1.slotIndex ?? .max)]
            return left.lexicographicallyPrecedes(right)
        }
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Sign in is required."
            isLoading = false
            return
        }
        isLoading = session == nil
        errorMessage = nil
        do {
            session = try await apiService.getDeckCheckout(
                config: environmentStore.serverConfiguration,
                token: token,
                deckId: deckId
            )
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func checkout() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true
        errorMessage = nil
        do {
            session = try await apiService.checkoutDeck(
                config: environmentStore.serverConfiguration,
                token: token,
                deckId: deckId,
                note: note.nilIfBlank
            )
            HapticManager.notification(.success)
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }

    @MainActor
    private func checkin() async {
        guard let token = environmentStore.authToken else { return }
        isSaving = true
        errorMessage = nil
        do {
            session = try await apiService.checkinDeck(
                config: environmentStore.serverConfiguration,
                token: token,
                deckId: deckId
            )
            HapticManager.notification(.success)
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

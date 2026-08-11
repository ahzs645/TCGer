import SwiftUI

struct DeleteServerAccountView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss

    @State private var password = ""
    @State private var isDeleting = false
    @State private var showingConfirmation = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("This permanently deletes your server account, synced collection, wishlists, decks, finance history, uploaded images, and active sessions.")
                        .foregroundStyle(.secondary)

                    Text("Cards stored only on this phone are not deleted. Afterward, TCGer switches to phone-only mode.")
                        .foregroundStyle(.secondary)
                } header: {
                    Text("Permanent deletion")
                }

                Section {
                    SecureField("Current Password", text: $password)
                        .textContentType(.password)

                    if let errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button("Delete Server Account", role: .destructive) {
                        showingConfirmation = true
                    }
                    .disabled(password.isEmpty || isDeleting)
                } footer: {
                    Text("Your current password is required. This action cannot be undone.")
                }
            }
            .navigationTitle("Delete Account")
            .navigationBarTitleDisplayMode(.inline)
            .interactiveDismissDisabled(isDeleting)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isDeleting)
                }
            }
            .alert("Delete this account permanently?", isPresented: $showingConfirmation) {
                Button("Cancel", role: .cancel) {}
                Button("Delete Permanently", role: .destructive) {
                    Task { await deleteAccount() }
                }
            } message: {
                Text("Your server data and account credentials will be permanently removed.")
            }
            .overlay {
                if isDeleting {
                    ProgressView("Deleting account…")
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    @MainActor
    private func deleteAccount() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Your session has expired. Sign in again and retry."
            return
        }

        isDeleting = true
        errorMessage = nil
        defer { isDeleting = false }

        do {
            try await APIService().deleteServerAccount(
                config: environmentStore.serverConfiguration,
                token: token,
                password: password
            )
            environmentStore.finishServerAccountDeletion()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

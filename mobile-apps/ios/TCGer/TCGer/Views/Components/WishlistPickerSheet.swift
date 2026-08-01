import SwiftUI

/// Picks (or creates) a wishlist to receive a bulk add.
struct WishlistPickerSheet: View {
    let title: String
    let onSelect: (Wishlist) -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var wishlists: [Wishlist] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var newName = ""
    @State private var isCreating = false

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading wishlists…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if !wishlists.isEmpty {
                            Section {
                                ForEach(wishlists) { wishlist in
                                    Button {
                                        onSelect(wishlist)
                                        dismiss()
                                    } label: {
                                        HStack(spacing: 12) {
                                            Circle()
                                                .fill(Color.fromHex(wishlist.colorHex))
                                                .frame(width: 10, height: 10)
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(wishlist.name)
                                                Text("\(wishlist.totalCards) cards")
                                                    .font(.caption)
                                                    .foregroundColor(.secondary)
                                            }
                                        }
                                    }
                                }
                            } header: {
                                Text("Choose a wishlist")
                            }
                        }

                        Section {
                            HStack {
                                TextField("New wishlist name", text: $newName)
                                Button("Create") {
                                    Task { await createAndSelect() }
                                }
                                .disabled(
                                    newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                        || isCreating
                                )
                            }
                        } header: {
                            Text("Or start a new one")
                        }

                        if let errorMessage {
                            Section {
                                Text(errorMessage)
                                    .font(.footnote)
                                    .foregroundColor(.red)
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task { await load() }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }
        do {
            wishlists = try await apiService.getWishlists(
                config: environmentStore.serverConfiguration,
                token: token
            )
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    @MainActor
    private func createAndSelect() async {
        guard let token = environmentStore.authToken else { return }
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        isCreating = true
        defer { isCreating = false }

        do {
            let wishlist = try await apiService.createWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name
            )
            onSelect(wishlist)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

import SwiftUI

/// Picks (or creates) a wishlist to receive a bulk add.
struct WishlistPickerSheet: View {
    let title: String
    let onSelect: (Wishlist) -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var wishlistStore: WishlistStore
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?
    @State private var newName = ""
    @State private var isCreating = false

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            Group {
                if wishlistStore.isLoading && !wishlistStore.hasLoaded {
                    ProgressView("Loading wishlists…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if !wishlistStore.wishlists.isEmpty {
                            Section {
                                ForEach(wishlistStore.wishlists) { wishlist in
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
                                            Spacer()
                                        }
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .contentShape(Rectangle())
                                    }
                                    .buttonStyle(.plain)
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

                        if let pickerErrorMessage {
                            Section {
                                Text(pickerErrorMessage)
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
            return
        }
        await wishlistStore.load(
            config: environmentStore.serverConfiguration,
            token: token
        )
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
            wishlistStore.insert(wishlist)
            onSelect(wishlist)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var pickerErrorMessage: String? {
        errorMessage
            ?? (wishlistStore.wishlists.isEmpty ? wishlistStore.errorMessage : nil)
    }
}

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

    private var pickerErrorMessage: String? {
        errorMessage
            ?? (wishlistStore.wishlists.isEmpty ? wishlistStore.errorMessage : nil)
    }

    private var trimmedNewName: String {
        newName.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Group {
                if wishlistStore.isLoading && !wishlistStore.hasLoaded {
                    ProgressView("Loading wishlists…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if !wishlistStore.wishlists.isEmpty {
                            WishlistSelectionSection(
                                title: "Choose a wishlist",
                                wishlists: wishlistStore.wishlists,
                                selectedWishlistID: nil,
                                showsSelectionIndicators: false,
                                isLoading: false,
                                loadingMessage: "Loading wishlists…",
                                loadError: nil,
                                emptyMessage: nil,
                                isInteractionDisabled: false,
                                showsActivityIndicator: false,
                                onRetry: nil,
                                onSelect: select
                            )
                        }

                        CreateWishlistSection(
                            title: "Or start a new one",
                            placeholder: "New wishlist name",
                            name: $newName,
                            textInputAutocapitalization: nil,
                            buttonTitle: "Create",
                            isCreateDisabled: trimmedNewName.isEmpty || isCreating,
                            onCreate: startCreateAndSelect
                        )

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

    private func select(_ wishlist: Wishlist) {
        onSelect(wishlist)
        dismiss()
    }

    private func startCreateAndSelect() {
        Task { await createAndSelect() }
    }
}

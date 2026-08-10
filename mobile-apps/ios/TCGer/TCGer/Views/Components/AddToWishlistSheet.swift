import SwiftUI

struct AddToWishlistSheet: View {
    let card: Card
    var onComplete: (() -> Void)?
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var wishlistStore: WishlistStore
    @Environment(\.dismiss) private var dismiss
    @State private var errorMessage: String?
    @State private var isAdding = false
    @State private var successMessage: String?
    @State private var showingCreateNew = false
    @State private var newName = ""

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Group {
                if wishlistStore.isLoading && !wishlistStore.hasLoaded {
                    ProgressView("Loading wishlists...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if wishlistStore.wishlists.isEmpty && !showingCreateNew {
                    VStack(spacing: 16) {
                        Image(systemName: "heart.slash")
                            .font(.system(size: 40))
                            .foregroundColor(.secondary)
                        Text("No Wishlists")
                            .font(.headline)
                        Text("Create one to start tracking wanted cards")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Button {
                            showingCreateNew = true
                        } label: {
                            Label("Create Wishlist", systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        if showingCreateNew {
                            Section {
                                HStack {
                                    TextField("Wishlist name", text: $newName)
                                    Button("Create") {
                                        Task { await createAndAdd() }
                                    }
                                    .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isAdding)
                                }
                            } header: {
                                Text("New Wishlist")
                            }
                        }

                        Section {
                            ForEach(wishlistStore.wishlists) { wishlist in
                                Button {
                                    Task { await addToWishlist(wishlist) }
                                } label: {
                                    HStack(spacing: 12) {
                                        Circle()
                                            .fill(Color.fromHex(wishlist.colorHex))
                                            .frame(width: 10, height: 10)
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(wishlist.name)
                                                .font(.body)
                                            Text("\(wishlist.totalCards) cards")
                                                .font(.caption)
                                                .foregroundColor(.secondary)
                                        }
                                        Spacer()
                                        if isAdding {
                                            ProgressView()
                                                .scaleEffect(0.8)
                                        }
                                    }
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .disabled(isAdding)
                            }
                        } header: {
                            if !wishlistStore.wishlists.isEmpty {
                                Text("Add to Wishlist")
                            }
                        }

                        if !showingCreateNew {
                            Section {
                                Button {
                                    showingCreateNew = true
                                } label: {
                                    Label("Create New Wishlist", systemImage: "plus.circle")
                                }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Add to Wishlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .task {
                await loadWishlists()
            }
            .overlay {
                if let message = successMessage {
                    VStack {
                        Spacer()
                        Text(message)
                            .font(.subheadline)
                            .fontWeight(.medium)
                            .foregroundColor(.white)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 10)
                            .background(Color.green)
                            .cornerRadius(20)
                            .padding(.bottom, 20)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }
            }
            .alert("Wishlist Error", isPresented: errorIsPresented) {
                Button("OK", role: .cancel) {
                    errorMessage = nil
                }
            } message: {
                Text(errorMessage ?? "Something went wrong.")
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func loadWishlists() async {
        guard let token = environmentStore.authToken else {
            return
        }
        await wishlistStore.load(
            config: environmentStore.serverConfiguration,
            token: token
        )
    }

    @MainActor
    private func addToWishlist(_ wishlist: Wishlist) async {
        guard let token = environmentStore.authToken else { return }
        isAdding = true

        do {
            _ = try await apiService.addCardToWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                wishlistId: wishlist.id,
                card: card
            )
            successMessage = "Added to \(wishlist.name)"
            await refreshWishlistStore(token: token)
            HapticManager.notification(.success)
            onComplete?()
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isAdding = false
    }

    @MainActor
    private func createAndAdd() async {
        guard let token = environmentStore.authToken else { return }
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        isAdding = true

        do {
            let wishlist = try await apiService.createWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name
            )
            wishlistStore.insert(wishlist)
            _ = try await apiService.addCardToWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                wishlistId: wishlist.id,
                card: card
            )
            successMessage = "Added to \(wishlist.name)"
            await refreshWishlistStore(token: token)
            onComplete?()
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isAdding = false
    }

    @MainActor
    private func refreshWishlistStore(token: String) async {
        await wishlistStore.load(
            config: environmentStore.serverConfiguration,
            token: token,
            force: true
        )
        environmentStore.updateWishlistWidgetData(wishlists: wishlistStore.wishlists)
    }

    private var errorIsPresented: Binding<Bool> {
        Binding(
            get: { errorMessage != nil },
            set: { isPresented in
                if !isPresented {
                    errorMessage = nil
                }
            }
        )
    }
}

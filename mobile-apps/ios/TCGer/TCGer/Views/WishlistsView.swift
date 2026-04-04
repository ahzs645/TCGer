import SwiftUI

struct WishlistsView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var wishlists: [Wishlist] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showingCreateSheet = false
    @State private var selectedWishlist: Wishlist?
    @State private var newWishlistName = ""
    @State private var newWishlistDescription = ""
    @State private var newWishlistColor: Color = .blue

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading wishlists...")
                } else if let error = errorMessage {
                    VStack(spacing: 16) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 50))
                            .foregroundColor(.orange)
                        Text("Failed to Load Wishlists")
                            .font(.headline)
                        Text(error)
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal)
                        Button("Try Again") {
                            Task { await loadWishlists() }
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if wishlists.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "heart.slash")
                            .font(.system(size: 50))
                            .foregroundColor(.secondary)
                        Text("No Wishlists Yet")
                            .font(.title3)
                            .fontWeight(.semibold)
                        Text("Create a wishlist to track cards you want")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                        Button {
                            showingCreateSheet = true
                        } label: {
                            Label("Create Wishlist", systemImage: "plus")
                        }
                        .buttonStyle(.borderedProminent)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        ForEach(wishlists) { wishlist in
                            Button {
                                selectedWishlist = wishlist
                            } label: {
                                WishlistRow(wishlist: wishlist)
                            }
                            .buttonStyle(.plain)
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    Task { await deleteWishlist(wishlist) }
                                } label: {
                                    Label("Delete", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("Wishlists")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        showingCreateSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                }
            }
            .refreshable {
                await loadWishlists()
            }
            .task {
                await loadWishlists()
            }
            .sheet(isPresented: $showingCreateSheet) {
                createWishlistSheet
            }
            .sheet(item: $selectedWishlist) { wishlist in
                WishlistDetailView(wishlist: wishlist, onUpdate: {
                    Task { await loadWishlists() }
                })
                .environmentObject(environmentStore)
            }
        }
    }

    private var createWishlistSheet: some View {
        NavigationView {
            Form {
                Section {
                    TextField("Wishlist Name", text: $newWishlistName)
                    TextField("Description (optional)", text: $newWishlistDescription, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("Details")
                }

                Section {
                    ColorPickerGrid(selectedColor: $newWishlistColor)
                } header: {
                    Text("Color")
                }
            }
            .navigationTitle("New Wishlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        resetCreateForm()
                        showingCreateSheet = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task { await createWishlist() }
                    }
                    .disabled(newWishlistName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @MainActor
    private func loadWishlists() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = wishlists.isEmpty
        errorMessage = nil

        do {
            wishlists = try await apiService.getWishlists(
                config: environmentStore.serverConfiguration,
                token: token
            )
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }

    @MainActor
    private func createWishlist() async {
        guard let token = environmentStore.authToken else { return }
        let name = newWishlistName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }

        do {
            let wishlist = try await apiService.createWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                name: name,
                description: newWishlistDescription.isEmpty ? nil : newWishlistDescription,
                colorHex: newWishlistColor.toHex()
            )
            wishlists.insert(wishlist, at: 0)
            resetCreateForm()
            showingCreateSheet = false
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func deleteWishlist(_ wishlist: Wishlist) async {
        guard let token = environmentStore.authToken else { return }

        do {
            try await apiService.deleteWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: wishlist.id
            )
            wishlists.removeAll { $0.id == wishlist.id }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func resetCreateForm() {
        newWishlistName = ""
        newWishlistDescription = ""
        newWishlistColor = .blue
    }
}

// MARK: - Wishlist Row

private struct WishlistRow: View {
    let wishlist: Wishlist

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color.fromHex(wishlist.colorHex))
                .frame(width: 12, height: 12)

            VStack(alignment: .leading, spacing: 4) {
                Text(wishlist.name)
                    .font(.headline)

                HStack(spacing: 8) {
                    Text("\(wishlist.totalCards) cards")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    if wishlist.totalCards > 0 {
                        Text("\(wishlist.ownedCards)/\(wishlist.totalCards) owned")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            if wishlist.totalCards > 0 {
                ZStack {
                    Circle()
                        .stroke(Color(.systemGray4), lineWidth: 3)
                        .frame(width: 36, height: 36)
                    Circle()
                        .trim(from: 0, to: Double(wishlist.completionPercent) / 100.0)
                        .stroke(Color.accentColor, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .frame(width: 36, height: 36)
                        .rotationEffect(.degrees(-90))
                    Text("\(wishlist.completionPercent)%")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundColor(.secondary)
                }
            }

            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(.vertical, 4)
    }
}

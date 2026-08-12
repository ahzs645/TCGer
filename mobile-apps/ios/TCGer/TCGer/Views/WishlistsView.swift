import Combine
import SwiftUI

struct WishlistsView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var wishlistStore: WishlistStore
    @State private var showingCreateSheet = false
    @State private var wishlistPresentation: WishlistPresentation?
    @State private var newWishlistName = ""
    @State private var newWishlistDescription = ""
    @State private var newWishlistColor: Color = .blue
    @State private var newWishlistMatchAnyPrinting = false
    @State private var actionErrorMessage: String?
    @State private var searchText = ""
    @State private var lastHandledDeepLinkID: UUID?
    @State private var pendingWishlistID: String?

    private var filteredWishlists: [Wishlist] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return wishlistStore.wishlists }
        return wishlistStore.wishlists.filter {
            $0.name.localizedCaseInsensitiveContains(query) ||
            ($0.description?.localizedCaseInsensitiveContains(query) ?? false)
        }
    }

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                wishlistContent
            } else {
                NavigationStack {
                    wishlistContent
                }
            }
        }
        .onAppear {
            handleDeepLink(environmentStore.pendingDeepLinkRequest)
        }
        .onReceive(environmentStore.$pendingDeepLinkRequest.dropFirst()) { request in
            handleDeepLink(request)
        }
    }

    private var wishlistContent: some View {
        Group {
            if wishlistStore.isLoading && !wishlistStore.hasLoaded {
                ProgressView("Loading wishlists...")
            } else if let error = wishlistStore.errorMessage,
                      wishlistStore.wishlists.isEmpty {
                ErrorView(title: "Failed to Load Wishlists", message: error) {
                    Task { await loadWishlists(force: true) }
                }
            } else if wishlistStore.wishlists.isEmpty {
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
            } else if filteredWishlists.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else {
                List {
                    ForEach(filteredWishlists) { wishlist in
                        Button {
                            wishlistPresentation = WishlistPresentation(
                                wishlist: wishlist,
                                startsInEditMode: false
                            )
                        } label: {
                            WishlistRow(wishlist: wishlist)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            Button {
                                wishlistPresentation = WishlistPresentation(
                                    wishlist: wishlist,
                                    startsInEditMode: true
                                )
                            } label: {
                                Label("Edit", systemImage: "pencil")
                            }
                            .tint(.blue)
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                Task { await deleteWishlist(wishlist) }
                            } label: {
                                Label("Delete", systemImage: "trash")
                            }
                        }
                    }
                }
                .listStyle(.insetGrouped)
            }
        }
        .scrollEdgeEffectStyle(.soft, for: .top)
        .navigationTitle("Wishlists")
        .searchable(
            text: $searchText,
            placement: .navigationBarDrawer(displayMode: .always),
            prompt: "Search wishlists"
        )
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
            await loadWishlists(force: true)
        }
        .task {
            await loadWishlists()
        }
        .onChange(of: wishlistStore.revision) {
            environmentStore.updateWishlistWidgetData(wishlists: wishlistStore.wishlists)
        }
        .sheet(isPresented: $showingCreateSheet) {
            createWishlistSheet
        }
        .navigationDestination(isPresented: wishlistIsPresented) {
            if let presentation = wishlistPresentation {
                WishlistDetailView(
                    wishlist: presentation.wishlist,
                    startsInEditMode: presentation.startsInEditMode,
                    parentProvidesNavigation: true,
                    onUpdate: {
                        Task { await loadWishlists(force: true) }
                    }
                )
                .environmentObject(environmentStore)
            }
        }
        .alert("Wishlist Error", isPresented: actionErrorIsPresented) {
            Button("OK", role: .cancel) {
                actionErrorMessage = nil
            }
        } message: {
            Text(actionErrorMessage ?? "Something went wrong.")
        }
    }

    private var createWishlistSheet: some View {
        NavigationStack {
            Form {
                NameDescriptionColorSections(
                    namePlaceholder: "Wishlist Name",
                    name: $newWishlistName,
                    description: $newWishlistDescription,
                    selectedColor: $newWishlistColor
                )

                Section {
                    Toggle("Any printing counts as owned", isOn: $newWishlistMatchAnyPrinting)
                } footer: {
                    Text("On: owning any printing of a card checks it off. Off: only the exact printing on the list counts.")
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
    private func loadWishlists(force: Bool = false) async {
        guard let token = environmentStore.authToken else {
            return
        }

        await wishlistStore.load(
            config: environmentStore.serverConfiguration,
            token: token,
            force: force
        )
        resolvePendingWishlist()
    }

    @MainActor
    private func createWishlist() async {
        guard let token = environmentStore.authToken else { return }
        let name = newWishlistName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }

        do {
            _ = try await wishlistStore.create(
                config: environmentStore.serverConfiguration,
                token: token,
                input: CreateWishlistInput(
                    name: name,
                    description: newWishlistDescription.isEmpty ? nil : newWishlistDescription,
                    colorHex: newWishlistColor.toHex(),
                    matchAnyPrinting: newWishlistMatchAnyPrinting
                )
            )
            resetCreateForm()
            showingCreateSheet = false
        } catch {
            actionErrorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func deleteWishlist(_ wishlist: Wishlist) async {
        guard let token = environmentStore.authToken else { return }

        do {
            try await wishlistStore.delete(
                config: environmentStore.serverConfiguration,
                token: token,
                id: wishlist.id
            )
        } catch {
            actionErrorMessage = error.localizedDescription
        }
    }

    private var actionErrorIsPresented: Binding<Bool> {
        Binding(
            get: { actionErrorMessage != nil },
            set: { isPresented in
                if !isPresented {
                    actionErrorMessage = nil
                }
            }
        )
    }

    private func resetCreateForm() {
        newWishlistName = ""
        newWishlistDescription = ""
        newWishlistColor = .blue
        newWishlistMatchAnyPrinting = false
    }

    private var wishlistIsPresented: Binding<Bool> {
        Binding(
            get: { wishlistPresentation != nil },
            set: { if !$0 { wishlistPresentation = nil } }
        )
    }

    private func handleDeepLink(_ request: AppDeepLinkRequest?) {
        guard let request,
              request.id != lastHandledDeepLinkID,
              case .wishlist(let wishlistID) = request.destination else { return }
        lastHandledDeepLinkID = request.id
        pendingWishlistID = wishlistID
        resolvePendingWishlist(request: request)
    }

    private func resolvePendingWishlist(request: AppDeepLinkRequest? = nil) {
        guard let pendingWishlistID else { return }
        let currentRequest = request ?? environmentStore.pendingDeepLinkRequest
        guard let currentRequest,
              case .wishlist = currentRequest.destination else { return }
        guard let wishlist = wishlistStore.wishlists.first(where: { $0.id == pendingWishlistID }) else {
            if wishlistStore.hasLoaded,
               environmentStore.claimDeepLinkRequest(currentRequest, for: .wishlists) {
                self.pendingWishlistID = nil
            }
            return
        }
        guard environmentStore.claimDeepLinkRequest(currentRequest, for: .wishlists) else {
            self.pendingWishlistID = nil
            return
        }
        self.pendingWishlistID = nil
        wishlistPresentation = WishlistPresentation(wishlist: wishlist, startsInEditMode: false)
    }
}

private struct WishlistPresentation: Identifiable {
    let wishlist: Wishlist
    let startsInEditMode: Bool

    var id: String { wishlist.id }
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

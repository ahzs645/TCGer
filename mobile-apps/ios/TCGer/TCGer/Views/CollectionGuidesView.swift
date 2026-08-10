import SwiftUI

struct CollectionGuidesView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var guides: [CollectionGuide] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""

    private let apiService = APIService()

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    private var filteredGuides: [CollectionGuide] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return guides }
        return guides.filter { guide in
            guide.title.localizedCaseInsensitiveContains(query)
                || guide.description.localizedCaseInsensitiveContains(query)
                || guide.tags.contains { $0.localizedCaseInsensitiveContains(query) }
        }
    }

    var body: some View {
        Group {
            if parentProvidesNavigation {
                content
            } else {
                NavigationStack { content }
            }
        }
    }

    private var content: some View {
        Group {
            if isLoading && guides.isEmpty {
                ProgressView("Loading collection guides…")
            } else if let errorMessage, guides.isEmpty {
                ErrorView(title: "Couldn’t Load Guides", message: errorMessage) {
                    Task { await loadGuides() }
                }
            } else if filteredGuides.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else {
                ScrollView {
                    LazyVStack(spacing: 16) {
                        ForEach(filteredGuides) { guide in
                            NavigationLink(value: guide) {
                                CollectionGuideRow(guide: guide)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding()
                }
                .refreshable { await loadGuides() }
            }
        }
        .navigationTitle("Collection Guides")
        .searchable(text: $searchText, prompt: "Clay, artist, Pokémon…")
        .navigationDestination(for: CollectionGuide.self) { guide in
            CollectionGuideDetailView(guide: guide)
        }
        .task { await loadGuides() }
    }

    @MainActor
    private func loadGuides() async {
        guard let token = environmentStore.authToken else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            guides = try await apiService.getCollectionGuides(
                config: environmentStore.serverConfiguration,
                token: token
            )
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct CollectionGuideRow: View {
    let guide: CollectionGuide

    var body: some View {
        HStack(spacing: 16) {
            CachedAsyncImage(url: guide.coverImageUrl.flatMap(URL.init(string:))) { phase in
                if case let .success(image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Rectangle().fill(.quaternary)
                        .overlay { Image(systemName: "photo.on.rectangle.angled").foregroundStyle(.secondary) }
                }
            }
            .frame(width: 104, height: 146)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(guide.title).font(.headline)
                    if guide.followed {
                        Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                    }
                }
                Text(guide.description)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                HStack(spacing: 6) {
                    Label("\(guide.cardCountHint ?? 0)", systemImage: "rectangle.stack")
                    Text("•")
                    Text(guide.curatorName)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}

private struct CollectionGuideDetailView: View {
    private enum OwnershipFilter: String, CaseIterable, Identifiable {
        case all = "All"
        case missing = "Missing"
        case owned = "Owned"
        var id: String { rawValue }
    }

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @EnvironmentObject private var wishlistStore: WishlistStore
    @State private var guide: CollectionGuide
    @State private var cards: [Card] = []
    @State private var wishlist: Wishlist?
    @State private var isLoading = true
    @State private var isFollowing = false
    @State private var statusMessage: String?
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var selectedSet = "All sets"
    @State private var ownershipFilter = OwnershipFilter.all

    private let apiService = APIService()
    private let columns = [GridItem(.adaptive(minimum: 112, maximum: 170), spacing: 12)]

    init(guide: CollectionGuide) {
        _guide = State(initialValue: guide)
    }

    private var setOptions: [String] {
        ["All sets"] + Set(cards.compactMap(\.setCode)).sorted()
    }

    private var ownedKeys: Set<String> {
        Set((wishlist?.cards ?? []).filter(\.owned).map { "\($0.tcg):\($0.externalId)" })
    }

    private var filteredCards: [Card] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return cards.filter { card in
            let matchesText = query.isEmpty
                || card.name.localizedCaseInsensitiveContains(query)
                || (card.setName?.localizedCaseInsensitiveContains(query) ?? false)
                || (card.collectorNumber?.localizedCaseInsensitiveContains(query) ?? false)
            let matchesSet = selectedSet == "All sets" || card.setCode == selectedSet
            let isOwned = ownedKeys.contains("\(card.tcg):\(card.id)")
            let matchesOwnership = switch ownershipFilter {
            case .all: true
            case .missing: !isOwned
            case .owned: isOwned
            }
            return matchesText && matchesSet && matchesOwnership
        }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                hero

                if let statusMessage {
                    Label(statusMessage, systemImage: "arrow.triangle.2.circlepath")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                if let errorMessage {
                    Text(errorMessage).font(.subheadline).foregroundStyle(.red)
                }

                filters

                if isLoading {
                    ProgressView("Loading matching cards…")
                        .frame(maxWidth: .infinity, minHeight: 180)
                } else if filteredCards.isEmpty {
                    ContentUnavailableView(
                        "No Matching Cards",
                        systemImage: "rectangle.stack.badge.minus",
                        description: Text("Try changing the search or filters.")
                    )
                    .frame(minHeight: 220)
                } else {
                    LazyVGrid(columns: columns, spacing: 18) {
                        ForEach(filteredCards) { card in
                            guideCard(card)
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle(guide.title)
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $searchText, prompt: "Search this collection")
        .task { await load() }
    }

    private var hero: some View {
        HStack(alignment: .top, spacing: 18) {
            CachedAsyncImage(url: guide.coverImageUrl.flatMap(URL.init(string:))) { phase in
                if case let .success(image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Rectangle().fill(.quaternary)
                }
            }
            .frame(width: 118, height: 165)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 10) {
                Text(guide.description).font(.subheadline).foregroundStyle(.secondary)
                Text("Curated by \(guide.curatorName)").font(.caption)
                Text("\(cards.isEmpty ? guide.cardCountHint ?? 0 : cards.count) cards")
                    .font(.caption.weight(.semibold))
                Button {
                    Task { await follow() }
                } label: {
                    Label(
                        guide.followed ? "Following" : "Add to Wishlist",
                        systemImage: guide.followed ? "checkmark.circle.fill" : "heart.badge.plus"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(isFollowing || guide.followed)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var filters: some View {
        HStack {
            Picker("Ownership", selection: $ownershipFilter) {
                ForEach(OwnershipFilter.allCases) { filter in Text(filter.rawValue).tag(filter) }
            }
            .pickerStyle(.segmented)

            Menu {
                Picker("Set", selection: $selectedSet) {
                    ForEach(setOptions, id: \.self) { Text($0).tag($0) }
                }
            } label: {
                Label(selectedSet, systemImage: "line.3.horizontal.decrease.circle")
            }
        }
    }

    private func guideCard(_ card: Card) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            CachedAsyncImage(card: card) { phase in
                if case let .success(image) = phase {
                    image.resizable().scaledToFill()
                } else {
                    Rectangle().fill(.quaternary)
                }
            }
            .aspectRatio(63 / 88, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 8))
            .overlay(alignment: .topTrailing) {
                if ownedKeys.contains("\(card.tcg):\(card.id)") {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.white, .green)
                        .padding(5)
                }
            }
            Text(card.name).font(.caption.weight(.semibold)).lineLimit(1)
            Text([card.setCode, card.collectorNumber].compactMap { $0 }.joined(separator: " · "))
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }

    @MainActor
    private func load() async {
        guard let token = environmentStore.authToken else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            cards = try await expandGuide(token: token)
            if let wishlistId = guide.wishlistId {
                wishlist = try? await apiService.getWishlist(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    id: wishlistId
                )
            }
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func expandGuide(token: String) async throws -> [Card] {
        switch guide.rule.type {
        case .artist:
            return try await apiService.searchCardsByArtist(
                config: environmentStore.serverConfiguration,
                token: token,
                artist: guide.rule.query ?? "",
                game: TCGGame(rawValue: guide.rule.tcg) ?? .pokemon
            )
        case .name:
            return try await apiService.searchAllCards(
                config: environmentStore.serverConfiguration,
                token: token,
                query: guide.rule.query ?? "",
                game: TCGGame(rawValue: guide.rule.tcg) ?? .all,
                includeAllPrintings: guide.rule.includeAllPrintings
            )
        case .set:
            return try await apiService.getSetCards(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: guide.rule.tcg,
                setCode: guide.rule.setCode ?? ""
            )
        }
    }

    @MainActor
    private func follow() async {
        guard let token = environmentStore.authToken else { return }
        isFollowing = true
        statusMessage = "Creating wishlist…"
        defer { isFollowing = false }
        do {
            let response = try await apiService.followCollectionGuide(
                config: environmentStore.serverConfiguration,
                token: token,
                slug: guide.slug
            )
            guide = response.guide
            var followedWishlist = try await apiService.getWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: response.wishlistId
            )
            let syncService = WishlistSyncService(
                config: environmentStore.serverConfiguration,
                token: token,
                enabledGames: environmentStore.enabledGames
            )
            let result = await syncService.sync(wishlist: followedWishlist) { progress in
                Task { @MainActor in statusMessage = progress }
            }
            followedWishlist = try await apiService.getWishlist(
                config: environmentStore.serverConfiguration,
                token: token,
                id: response.wishlistId
            )
            wishlist = followedWishlist
            wishlistStore.insert(followedWishlist)
            statusMessage = result.errors.isEmpty
                ? "Added \(result.addedCards) cards to your wishlist."
                : "Added \(result.addedCards) cards; \(result.errors.count) sync issue(s)."
        } catch {
            errorMessage = error.localizedDescription
            statusMessage = nil
        }
    }
}

#Preview("Collection guide row") {
    CollectionGuideRow(guide: CollectionGuide(
        id: "preview",
        slug: "pokemon-clay-art",
        title: "The Clay Collection",
        description: "English Pokémon cards illustrated by Yuka Morii.",
        tcg: "pokemon",
        category: .artStyle,
        coverImageUrl: nil,
        curatorName: "TCGer",
        tags: ["Clay", "Yuka Morii"],
        version: 1,
        featured: true,
        rule: CollectionGuideRule(type: .artist, tcg: "pokemon", query: "Yuka Morii", setCode: nil, setName: nil, includeAllPrintings: true),
        cardCountHint: 224,
        followed: true,
        wishlistId: "preview-wishlist"
    ))
    .padding()
}


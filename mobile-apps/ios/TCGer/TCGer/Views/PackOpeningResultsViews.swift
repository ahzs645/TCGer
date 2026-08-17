import SwiftUI

struct PackOpeningNativeResultsView: View {
    let session: PackOpeningPullSession
    @Binding var inspectedPullIndex: Int?

    private let columns = [
        GridItem(.flexible(minimum: 120), spacing: 14),
        GridItem(.flexible(minimum: 120), spacing: 14),
    ]

    private var bestPull: PackOpeningPull? {
        session.pulls.max { tierRank($0.tier) < tierRank($1.tier) }
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 28) {
                if session.packs.count > 1, let bestPull {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Best Pull", systemImage: "sparkles")
                            .font(.title3.bold())
                            .foregroundStyle(.orange)

                        PackOpeningNativeResultCard(pull: bestPull) {
                            withAnimation(.snappy) {
                                inspectedPullIndex = session.pulls.firstIndex(of: bestPull)
                            }
                        }
                            .frame(maxWidth: 190)
                            .frame(maxWidth: .infinity)
                    }
                }

                ForEach(Array(session.packs.enumerated()), id: \.offset) { packIndex, pack in
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Text(session.packs.count == 1 ? "Your Pulls" : "Pack \(packIndex + 1)")
                                .font(.title3.bold())
                            Spacer()
                            Text("\(pack.count) cards")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        LazyVGrid(columns: columns, alignment: .center, spacing: 20) {
                            ForEach(Array(pack.enumerated()), id: \.offset) { cardIndex, pull in
                                PackOpeningNativeResultCard(pull: pull) {
                                    withAnimation(.snappy) {
                                        inspectedPullIndex = session.packs
                                            .prefix(packIndex)
                                            .reduce(0) { $0 + $1.count } + cardIndex
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 18)
            .padding(.top, 118)
            .padding(.bottom, 94)
        }
        .scrollIndicators(.hidden)
        .background(Color(uiColor: .systemBackground).ignoresSafeArea())
        .accessibilityLabel("Pack results for \(session.packLabel)")
    }

    private func tierRank(_ tier: String) -> Int {
        switch tier.lowercased() {
        case "chase": 5
        case "ultra": 4
        case "rare": 3
        case "uncommon": 2
        default: 1
        }
    }
}

struct PackOpeningResultSummary: View {
    let session: PackOpeningPullSession

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.title2)
                .foregroundStyle(.green)

            VStack(alignment: .leading, spacing: 2) {
                Text(session.packLabel)
                    .font(.headline)
                Text("\(session.packs.count) \(session.packs.count == 1 ? "pack" : "packs") · \(session.pulls.count) cards")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(uiColor: .secondarySystemBackground), in: .rect(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(Color(uiColor: .separator).opacity(0.5), lineWidth: 1)
        }
    }
}

private struct PackOpeningNativeResultCard: View {
    let pull: PackOpeningPull
    let onInspect: () -> Void

    var body: some View {
        Button(action: onInspect) {
            VStack(spacing: 9) {
            CachedAsyncImage(card: pull.card, thumbnail: true) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                case .failure:
                    Image(systemName: "rectangle.portrait.slash")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                default:
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .aspectRatio(2.5 / 3.5, contentMode: .fit)
            .clipShape(TradingCardShape())
            .shadow(color: tierColor.opacity(0.16), radius: 10, y: 5)

            VStack(spacing: 2) {
                Text(pull.name)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)

                Text(pull.rarity.uppercased())
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(tierColor)
                    .lineLimit(1)
            }
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(pull.name), \(pull.rarity)")
    }

    private var tierColor: Color {
        switch pull.tier.lowercased() {
        case "chase": .orange
        case "ultra": .purple
        case "rare": .blue
        case "uncommon": .green
        default: .secondary
        }
    }
}

struct PackOpeningCardCloseUp: View {
    let pull: PackOpeningPull
    let identity: String
    let onClose: () -> Void
    /// Positive advances, negative moves backward or exits when unavailable.
    let onSwipe: (Int) -> Void

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var isShowingBack = false
    @State private var settledScale: CGFloat = 1
    @GestureState private var liveScale: CGFloat = 1
    @GestureState private var dragOffset: CGSize = .zero
    @State private var wishlistCard: Card?
    @State private var isSavingFavorite = false
    @State private var favoriteMessage: String?
    @State private var favoriteError: String?

    private let apiService = APIService()

    private var effectiveScale: CGFloat {
        min(max(settledScale * liveScale, 1), 5)
    }

    private var shareText: String {
        var text = "\(pull.name) — \(pull.setName) #\(pull.collectorNumber)"
        if !pull.imageUrl.isEmpty { text += "\n\(pull.imageUrl)" }
        return text
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.clear
                    .contentShape(Rectangle())
                    .ignoresSafeArea()
                    .onTapGesture(perform: onClose)

                cardFace
                    .frame(maxWidth: min(geometry.size.width * 0.9, 430))
                    .frame(maxHeight: geometry.size.height * 0.76)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 88)

                VStack {
                    HStack {
                        Button(action: onClose) {
                            Image(systemName: "arrow.down.right.and.arrow.up.left")
                                .font(.headline)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.glass)
                        .accessibilityLabel("Return to card reveal")

                        Spacer()

                        Button {
                            withAnimation(.snappy) { isShowingBack.toggle() }
                        } label: {
                            Image(systemName: "rectangle.on.rectangle.angled")
                                .font(.headline)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.glass)
                        .accessibilityLabel("Flip card")
                    }

                    Spacer()
                    actionBar
                }
                .padding(.horizontal, 18)
                .safeAreaPadding(.top, 12)
                .safeAreaPadding(.bottom, 14)
            }
        }
        .background(.black.opacity(0.06))
        .onChange(of: identity) { _, _ in
            isShowingBack = false
            settledScale = 1
        }
        .sheet(item: $wishlistCard) { card in
            AddToWishlistSheet(card: card)
        }
        .alert("Favorites", isPresented: Binding(
            get: { favoriteMessage != nil || favoriteError != nil },
            set: { if !$0 { favoriteMessage = nil; favoriteError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(favoriteMessage ?? favoriteError ?? "")
        }
    }

    private var cardFace: some View {
        Group {
            if isShowingBack,
               let assetName = TCGGame(rawValue: pull.tcg)?.cardBackAssetName {
                Image(assetName)
                    .resizable()
                    .scaledToFit()
            } else {
                CachedAsyncImage(card: pull.card, thumbnail: false) { phase in
                    switch phase {
                    case .success(let image): image.resizable().scaledToFit()
                    case .failure:
                        Image(systemName: "rectangle.portrait.slash")
                            .font(.system(size: 52))
                            .foregroundStyle(.secondary)
                    default: ProgressView()
                    }
                }
            }
        }
        .aspectRatio(2.5 / 3.5, contentMode: .fit)
        .clipShape(TradingCardShape())
        .shadow(color: .black.opacity(0.16), radius: 18, y: 8)
        .scaleEffect(effectiveScale)
        .offset(x: dragOffset.width, y: dragOffset.height * 0.18)
        .rotationEffect(.degrees(Double(dragOffset.width / 28)))
        .opacity(max(0.35, 1 - abs(dragOffset.width) / 360))
        .rotation3DEffect(.degrees(isShowingBack ? 180 : 0), axis: (x: 0, y: 1, z: 0))
        .contentShape(Rectangle())
        .gesture(
            MagnifyGesture()
                .updating($liveScale) { value, state, _ in state = value.magnification }
                .onEnded { value in
                    settledScale = min(max(settledScale * value.magnification, 1), 5)
                }
        )
        .simultaneousGesture(
            DragGesture(minimumDistance: 24)
                .updating($dragOffset) { value, state, _ in
                    guard effectiveScale <= 1.02 else { return }
                    state = value.translation
                }
                .onEnded { value in
                    guard effectiveScale <= 1.02 else { return }
                    let horizontal = abs(value.translation.width)
                    let vertical = abs(value.translation.height)
                    if horizontal > 72, horizontal > vertical {
                        onSwipe(value.translation.width < 0 ? 1 : -1)
                    } else if vertical > 90, vertical > horizontal {
                        onClose()
                    }
                }
        )
        .onTapGesture(count: 2) {
            withAnimation(.snappy) { isShowingBack.toggle() }
        }
        .accessibilityLabel(isShowingBack ? "Back of \(pull.name)" : "Front of \(pull.name)")
    }

    private var actionBar: some View {
        HStack(spacing: 10) {
            Button {
                Task { await addToFavorites() }
            } label: {
                Label("Favorite", systemImage: "star.fill")
            }
            .buttonStyle(.glass)
            .disabled(isSavingFavorite)

            Button {
                wishlistCard = pull.card
            } label: {
                Label("Wishlist", systemImage: "heart")
            }
            .buttonStyle(.glass)

            ShareLink(item: shareText) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.glass)

            Button {
                onClose()
            } label: {
                Label("Done", systemImage: "arrow.down.right.and.arrow.up.left")
            }
            .buttonStyle(.glassProminent)
        }
        .labelStyle(.iconOnly)
    }

    @MainActor
    private func addToFavorites() async {
        guard !isSavingFavorite else { return }
        guard let token = environmentStore.authToken else {
            favoriteError = "Sign in before adding favorites."
            return
        }
        isSavingFavorite = true
        defer { isSavingFavorite = false }

        do {
            let collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: false
            )
            let existingFavorite = collections.first {
                $0.name.compare("Favorites", options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
            }
            let resolvedFavorite: Collection
            if let existingFavorite {
                resolvedFavorite = existingFavorite
            } else {
                resolvedFavorite = try await apiService.createCollection(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    name: "Favorites",
                    description: "Favorite cards",
                    colorHex: "#F59E0B"
                )
            }
            _ = try await apiService.addCardToBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: resolvedFavorite.id,
                card: pull.card,
                details: BinderCardAddDetails(quantity: 1, notes: "Favorited from Pack Opening")
            )
            NotificationCenter.default.post(name: .collectionDidChange, object: resolvedFavorite)
            HapticManager.notification(.success)
            favoriteMessage = "Added \(pull.name) to Favorites."
        } catch {
            favoriteError = error.localizedDescription
        }
    }
}

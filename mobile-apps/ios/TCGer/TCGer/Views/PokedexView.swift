import SwiftUI

private enum PokedexOwnershipFilter: String, CaseIterable, Identifiable {
    case all = "All"
    case owned = "Owned"
    case missing = "Missing"

    var id: String { rawValue }
}

private struct PokedexSpeciesRoute: Hashable {
    let number: Int
}

struct PokedexView: View {
    let parentProvidesNavigation: Bool

    @EnvironmentObject private var environmentStore: EnvironmentStore
    @StateObject private var catalogStore = CatalogStore.shared
    @State private var species: [PokedexSpeciesProgress] = []
    @State private var catalogEntriesBySpecies: [Int: [CatalogEntry]] = [:]
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var refreshWarning: String?
    @State private var searchText = ""
    @State private var ownershipFilter: PokedexOwnershipFilter = .all
    @State private var selectedGeneration: Int?
    @State private var collectionRevision = 0

    private let apiService = APIService()
    private let columns = [GridItem(.adaptive(minimum: 104, maximum: 160), spacing: 12)]

    init(parentProvidesNavigation: Bool = false) {
        self.parentProvidesNavigation = parentProvidesNavigation
    }

    private var filteredSpecies: [PokedexSpeciesProgress] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return species.filter { item in
            let matchesOwnership = switch ownershipFilter {
            case .all: true
            case .owned: item.isOwned
            case .missing: !item.isOwned
            }
            let matchesGeneration = selectedGeneration.flatMap { generation in
                PokedexGeneration.all.first(where: { $0.id == generation })?.range.contains(item.id)
            } ?? true
            let matchesSearch = query.isEmpty
                || item.entry.name.localizedCaseInsensitiveContains(query)
                || String(item.entry.number).contains(query)
            return matchesOwnership && matchesGeneration && matchesSearch
        }
    }

    private var ownedCount: Int { species.lazy.filter(\.isOwned).count }

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
            if isLoading {
                ProgressView("Building your Pokédex…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorMessage {
                ContentUnavailableView {
                    Label("Pokédex Unavailable", systemImage: "exclamationmark.triangle")
                } description: {
                    Text(errorMessage)
                } actions: {
                    Button("Try Again") { Task { await load() } }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                ScrollView {
                    VStack(spacing: 16) {
                        progressHeader
                        if let refreshWarning {
                            refreshWarningBanner(refreshWarning)
                        }
                        generationPicker
                        LazyVGrid(columns: columns, spacing: 12) {
                            ForEach(filteredSpecies) { item in
                                NavigationLink(value: PokedexSpeciesRoute(number: item.id)) {
                                    PokedexSpeciesTile(species: item)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding()
                }
                .background(Color(.systemGroupedBackground))
                .overlay {
                    if filteredSpecies.isEmpty {
                        ContentUnavailableView.search(text: searchText)
                    }
                }
            }
        }
        .navigationTitle("Pokédex")
        .navigationDestination(for: PokedexSpeciesRoute.self) { route in
            if let selectedSpecies = species.first(where: { $0.id == route.number }) {
                PokedexSpeciesDetailView(
                    species: selectedSpecies,
                    cards: cards(for: selectedSpecies)
                )
            }
        }
        .searchable(text: $searchText, prompt: "Name or Pokédex number")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Picker("Ownership", selection: $ownershipFilter) {
                    ForEach(PokedexOwnershipFilter.allCases) { filter in
                        Text(filter.rawValue).tag(filter)
                    }
                }
                .pickerStyle(.menu)
            }
        }
        .task { await load() }
        .refreshable { await load(useCache: false) }
        .onReceive(NotificationCenter.default.publisher(for: .collectionDidChange)) { _ in
            collectionRevision += 1
        }
        .task(id: collectionRevision) {
            guard collectionRevision > 0 else { return }
            await load(useCache: false)
        }
    }

    private var progressHeader: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("Species collected")
                    .font(.headline)
                Spacer()
                Text("\(ownedCount) / \(species.count)")
                    .font(.headline.monospacedDigit())
            }
            ProgressView(value: species.isEmpty ? 0 : Double(ownedCount) / Double(species.count))
                .tint(.green)
            Text("A species counts as owned when any of its Pokémon card printings is in your collection.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private var generationPicker: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Button("All regions") { selectedGeneration = nil }
                    .buttonStyle(.borderedProminent)
                    .tint(selectedGeneration == nil ? .accentColor : .secondary)
                ForEach(PokedexGeneration.all) { generation in
                    Button(generation.name) { selectedGeneration = generation.id }
                        .buttonStyle(.borderedProminent)
                        .tint(selectedGeneration == generation.id ? .accentColor : .secondary)
                }
            }
        }
    }

    private func refreshWarningBanner(_ message: String) -> some View {
        Label(message, systemImage: "wifi.exclamationmark")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            .accessibilityLabel("Refresh warning: \(message)")
    }

    private func cards(for species: PokedexSpeciesProgress) -> [Card] {
        (catalogEntriesBySpecies[species.id] ?? []).map(catalogStore.card(from:))
    }

    @MainActor
    private func load(useCache: Bool = true) async {
        isLoading = species.isEmpty
        errorMessage = nil
        refreshWarning = nil
        await catalogStore.loadIfNeeded(.pokemon)
        let entries = catalogStore.pokedexCards()

        guard !entries.isEmpty else {
            if species.isEmpty {
                errorMessage = "Install and enable the Pokémon card catalog in Settings to track species completion."
            } else {
                refreshWarning = "The Pokémon catalog is unavailable. Showing the latest Pokédex snapshot."
            }
            isLoading = false
            return
        }

        do {
            let collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken,
                useCache: useCache
            )
            let snapshot = await Task.detached(priority: .userInitiated) {
                PokedexProgressBuilder.build(
                    catalogEntries: entries,
                    collections: collections
                )
            }.value
            catalogEntriesBySpecies = snapshot.catalogEntriesByNumber
            species = snapshot.species
        } catch is CancellationError {
            isLoading = false
            return
        } catch {
            if species.isEmpty {
                let snapshot = await Task.detached(priority: .userInitiated) {
                    PokedexProgressBuilder.build(
                        catalogEntries: entries,
                        collections: []
                    )
                }.value
                catalogEntriesBySpecies = snapshot.catalogEntriesByNumber
                species = snapshot.species
            }
            refreshWarning = "Couldn’t refresh ownership. Showing the latest available Pokédex progress."
        }
        isLoading = false
    }
}

private struct PokedexSpeciesTile: View {
    let species: PokedexSpeciesProgress

    var body: some View {
        VStack(spacing: 8) {
            ZStack(alignment: .topTrailing) {
                CachedAsyncImage(url: species.artworkURL) { phase in
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(
                                species.isOwned
                                    ? Color.green.opacity(0.1)
                                    : Color.secondary.opacity(0.08)
                            )

                        switch phase {
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                                .saturation(species.isOwned ? 1 : 0)
                                .opacity(species.isOwned ? 1 : 0.55)
                                .padding(6)
                        case .empty:
                            ProgressView()
                                .controlSize(.small)
                        case .failure:
                            Image(systemName: "pawprint.fill")
                                .font(.title2)
                                .foregroundStyle(.tertiary)
                        @unknown default:
                            EmptyView()
                        }
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 116)
                .accessibilityHidden(true)

                Image(systemName: species.isOwned ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(species.isOwned ? .green : .secondary)
                    .padding(5)
                    .background(.ultraThinMaterial, in: Circle())
            }
            Text("#\(species.entry.number)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
            Text(species.entry.name)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
        }
        .padding(10)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 14))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Number \(species.entry.number), \(species.entry.name), \(species.isOwned ? "owned" : "missing")")
    }
}

private struct PokedexSpeciesDetailView: View {
    let species: PokedexSpeciesProgress
    let cards: [Card]

    private let columns = [GridItem(.adaptive(minimum: 132), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Label(
                        species.isOwned ? "Owned: \(species.ownedCopies)" : "Not collected yet",
                        systemImage: species.isOwned ? "checkmark.circle.fill" : "circle"
                    )
                    .foregroundStyle(species.isOwned ? .green : .secondary)
                    Spacer()
                    Text("\(species.printCount) printings")
                        .foregroundStyle(.secondary)
                }
                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(cards) { card in
                        VStack(alignment: .leading, spacing: 6) {
                            CachedAsyncImage(card: card) { phase in
                                if case .success(let image) = phase {
                                    image.resizable().scaledToFit()
                                } else {
                                    RoundedRectangle(cornerRadius: 10)
                                        .fill(Color.secondary.opacity(0.12))
                                        .aspectRatio(0.716, contentMode: .fit)
                                }
                            }
                            Text(card.setName ?? card.setCode ?? "Unknown set")
                                .font(.caption.weight(.semibold))
                                .lineLimit(1)
                            Text(card.collectorNumber ?? "")
                                .font(.caption2.monospacedDigit())
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .padding()
        }
        .navigationTitle("#\(species.entry.number) \(species.entry.name)")
        .navigationBarTitleDisplayMode(.inline)
    }
}

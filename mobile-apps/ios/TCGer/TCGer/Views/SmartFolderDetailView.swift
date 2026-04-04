import SwiftUI

struct SmartFolderDetailView: View {
    let folder: SmartFolder
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var matchingCards: [CollectionCard] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Finding matching cards...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if matchingCards.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "tray")
                            .font(.system(size: 50))
                            .foregroundColor(.secondary)
                        Text("No Matching Cards")
                            .font(.title3)
                            .fontWeight(.semibold)
                        Text("No cards in your collection match these rules")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    List {
                        Section {
                            HStack {
                                Text("\(matchingCards.count) cards match")
                                    .font(.subheadline)
                                    .foregroundColor(.secondary)
                                Spacer()
                                Text("\(folder.rules.count) rules (\(folder.matchMode.rawValue.lowercased()))")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }

                        Section {
                            ForEach(matchingCards) { card in
                                CollectionCardRow(
                                    card: card,
                                    showPricing: environmentStore.showPricing
                                )
                                .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
                                .listRowSeparator(.hidden)
                                .listRowBackground(Color(.systemBackground))
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(folder.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task {
                await loadMatchingCards()
            }
        }
    }

    @MainActor
    private func loadMatchingCards() async {
        guard let token = environmentStore.authToken else {
            isLoading = false
            return
        }

        do {
            let collections = try await apiService.getCollections(
                config: environmentStore.serverConfiguration,
                token: token,
                useCache: true
            )
            let allCards = collections.flatMap(\.cards)
            matchingCards = allCards.filter { folder.matches(card: $0) }
            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
}

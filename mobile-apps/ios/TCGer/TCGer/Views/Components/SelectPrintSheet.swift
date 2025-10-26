import SwiftUI

struct SelectPrintSheet: View {
    let card: Card
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @Binding var selectedPrint: Card

    @State private var prints: [Card] = []
    @State private var isLoading = true
    @State private var errorMessage: String?

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            Group {
                if isLoading {
                    ProgressView("Loading prints...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error = errorMessage {
                    ErrorView(message: error)
                } else if prints.isEmpty {
                    EmptyPrintsView()
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(prints) { print in
                                PrintRow(
                                    print: print,
                                    isSelected: selectedPrint.id == print.id
                                ) {
                                    selectedPrint = print
                                }
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationTitle("Select a Print")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use This Print") {
                        dismiss()
                    }
                    .disabled(isLoading)
                }
            }
        }
        .task {
            await loadPrints()
        }
    }

    @MainActor
    private func loadPrints() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            isLoading = false
            return
        }

        isLoading = true
        errorMessage = nil

        do {
            prints = try await apiService.getCardPrints(
                config: environmentStore.serverConfiguration,
                token: token,
                tcg: card.tcg,
                cardId: card.id
            )

            // If current selected print is in the list, keep it selected
            // Otherwise select the first print
            if !prints.contains(where: { $0.id == selectedPrint.id }) {
                selectedPrint = prints.first ?? card
            }

            isLoading = false
        } catch {
            errorMessage = error.localizedDescription
            isLoading = false
        }
    }
}

// MARK: - Print Row
private struct PrintRow: View {
    let print: Card
    let isSelected: Bool
    let onTap: () -> Void

    private var printDetails: String {
        var parts: [String] = []

        if let collectorNumber = print.collectorNumber {
            parts.append("#\(collectorNumber)")
        }

        if let rarity = print.rarity {
            parts.append(rarity)
        }

        if let releasedAt = print.releasedAt {
            let formatter = DateFormatter()
            formatter.dateFormat = "yyyy"
            let year = formatter.string(from: releasedAt)
            parts.append(year)
        }

        return parts.joined(separator: " • ")
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                // Card image thumbnail
                AsyncImage(url: URL(string: print.imageUrlSmall ?? print.imageUrl ?? "")) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                    case .empty:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .overlay(ProgressView())
                    case .failure:
                        Rectangle()
                            .fill(Color(.systemGray5))
                            .overlay(
                                Image(systemName: "photo")
                                    .foregroundColor(.secondary)
                            )
                    @unknown default:
                        Rectangle()
                            .fill(Color(.systemGray5))
                    }
                }
                .frame(width: 40, height: 56)
                .cornerRadius(4)

                // Print info
                VStack(alignment: .leading, spacing: 4) {
                    Text(print.setName ?? print.setCode ?? "Unknown set")
                        .font(.subheadline)
                        .fontWeight(.medium)
                        .foregroundColor(.primary)

                    if !printDetails.isEmpty {
                        Text(printDetails)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // Selection indicator
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.accentColor)
                        .font(.title3)
                }
            }
            .padding()
            .background(isSelected ? Color.accentColor.opacity(0.1) : Color(.systemGray6))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 2)
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Empty Prints View
private struct EmptyPrintsView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "photo.stack")
                .font(.system(size: 60))
                .foregroundColor(.secondary)
            Text("No Prints Found")
                .font(.title2)
                .fontWeight(.semibold)
            Text("This card doesn't have multiple printings available.")
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Error View
private struct ErrorView: View {
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 50))
                .foregroundColor(.orange)
            Text("Failed to Load Prints")
                .font(.headline)
            Text(message)
                .font(.subheadline)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

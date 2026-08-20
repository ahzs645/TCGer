import SwiftUI

struct WishlistChoiceRow: View {
    let wishlist: Wishlist
    let showsSelectionIndicator: Bool
    let isSelected: Bool
    let showsActivityIndicator: Bool

    var body: some View {
        HStack(spacing: 12) {
            Circle()
                .fill(Color.fromHex(wishlist.colorHex))
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 2) {
                Text(wishlist.name)
                    .foregroundStyle(.primary)
                Text("\(wishlist.totalCards) cards")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if showsActivityIndicator {
                ProgressView()
                    .scaleEffect(0.8)
            } else if showsSelectionIndicator {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(isSelected ? Color.accentColor : Color.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

struct WishlistSelectionSection: View {
    let title: String?
    let wishlists: [Wishlist]
    let selectedWishlistID: String?
    let showsSelectionIndicators: Bool
    let isLoading: Bool
    let loadingMessage: String
    let loadError: String?
    let emptyMessage: String?
    let isInteractionDisabled: Bool
    let showsActivityIndicator: Bool
    let onRetry: (() -> Void)?
    let onSelect: (Wishlist) -> Void

    var body: some View {
        Section {
            if isLoading {
                HStack(spacing: 10) {
                    ProgressView()
                    Text(loadingMessage)
                        .foregroundStyle(.secondary)
                }
            } else if let loadError, wishlists.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text(loadError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                    if let onRetry {
                        Button("Try Again", action: onRetry)
                    }
                }
            } else if wishlists.isEmpty {
                if let emptyMessage {
                    Text(emptyMessage)
                        .foregroundStyle(.secondary)
                }
            } else {
                ForEach(wishlists) { wishlist in
                    Button {
                        onSelect(wishlist)
                    } label: {
                        WishlistChoiceRow(
                            wishlist: wishlist,
                            showsSelectionIndicator: showsSelectionIndicators,
                            isSelected: selectedWishlistID == wishlist.id,
                            showsActivityIndicator: showsActivityIndicator
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isInteractionDisabled)
                }
            }
        } header: {
            if let title, !title.isEmpty {
                Text(title)
            }
        }
    }
}

struct CreateWishlistSection: View {
    let title: String
    let placeholder: String
    @Binding var name: String
    let textInputAutocapitalization: TextInputAutocapitalization?
    let buttonTitle: String
    let isCreateDisabled: Bool
    let onCreate: () -> Void

    var body: some View {
        Section(title) {
            HStack {
                TextField(placeholder, text: $name)
                    .textInputAutocapitalization(textInputAutocapitalization)
                Button(buttonTitle, action: onCreate)
                    .disabled(isCreateDisabled)
            }
        }
    }
}

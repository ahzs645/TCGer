import SwiftUI

struct CardImagePreviewView: View {
    let card: CollectionCard
    let onDismiss: () -> Void

    private var imageURL: URL? {
        if let primary = card.imageUrl, let url = URL(string: primary) {
            return url
        }
        if let small = card.imageUrlSmall, let url = URL(string: small) {
            return url
        }
        return nil
    }

    var body: some View {
        ZStack {
            // Dimmed background - tap to dismiss
            Color.black
                .opacity(0.85)
                .ignoresSafeArea()
                .onTapGesture {
                    onDismiss()
                }

            VStack(spacing: 24) {
                Spacer()

                // Card image
                Group {
                    if let url = imageURL {
                        AsyncImage(url: url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fit)
                                    .shadow(color: .black.opacity(0.4), radius: 25)
                            case .empty:
                                ProgressView()
                                    .tint(.white)
                            case .failure:
                                fallbackArtwork
                            @unknown default:
                                fallbackArtwork
                            }
                        }
                    } else {
                        fallbackArtwork
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 32)

                // Card info
                VStack(spacing: 6) {
                    Text(card.name)
                        .font(.title3.weight(.semibold))
                        .foregroundColor(.white)
                        .multilineTextAlignment(.center)
                    if let setCode = card.setCode {
                        Text(setCode)
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.7))
                    }
                    if let notes = card.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.caption)
                            .foregroundColor(.white.opacity(0.7))
                            .multilineTextAlignment(.center)
                            .padding(.top, 6)
                    }
                }
                .padding(.horizontal)

                Spacer()
            }
        }
        .overlay(alignment: .topTrailing) {
            Button {
                onDismiss()
            } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(.white.opacity(0.85))
                    .padding()
            }
            .accessibilityLabel("Close")
        }
    }

    private var fallbackArtwork: some View {
        VStack(spacing: 12) {
            Image(systemName: "photo")
                .font(.system(size: 40))
                .foregroundColor(.white.opacity(0.8))
            Text("No artwork available")
                .font(.footnote)
                .foregroundColor(.white.opacity(0.7))
        }
        .padding()
    }
}

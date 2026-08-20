import SwiftUI

struct ScanCandidateArtwork: View {
    let imageURL: URL?
    let contentMode: ContentMode
    let placeholderAspectRatio: CGFloat?

    init(
        imageURL: URL?,
        contentMode: ContentMode = .fit,
        placeholderAspectRatio: CGFloat? = nil
    ) {
        self.imageURL = imageURL
        self.contentMode = contentMode
        self.placeholderAspectRatio = placeholderAspectRatio
    }

    var body: some View {
        Group {
            if let imageURL {
                CachedAsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: contentMode)
                    case .failure:
                        placeholder
                    default:
                        placeholder.overlay(ProgressView())
                    }
                }
            } else {
                placeholder
            }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var placeholder: some View {
        let shape = RoundedRectangle(cornerRadius: 10)
            .fill(Color.secondary.opacity(0.12))
            .overlay {
                Image(systemName: "rectangle.portrait")
                    .foregroundStyle(.secondary)
            }

        if let placeholderAspectRatio {
            shape.aspectRatio(placeholderAspectRatio, contentMode: .fit)
        } else {
            shape
        }
    }
}

struct ScanCandidateSummary: View {
    enum Style {
        case compact
        case detail
    }

    let candidate: CardScanCandidate
    let style: Style
    let tint: Color

    var body: some View {
        switch style {
        case .compact:
            compactSummary
        case .detail:
            detailSummary
        }
    }

    private var compactSummary: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(candidate.details.identity.name)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.primary)
                .lineLimit(2)
            Text(candidate.details.identity.setCode ?? "Unknown set")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(candidate.confidence.score, format: .percent.precision(.fractionLength(0)))
                .font(.caption.weight(.semibold))
                .foregroundStyle(tint)
        }
    }

    private var detailSummary: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 7) {
                Text(candidate.details.identity.name)
                    .font(.title3.weight(.semibold))
                if candidate.originatingStrategy == .manual {
                    Label("Manual match", systemImage: "hand.tap.fill")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.blue)
                }
            }
            Text(candidate.details.identity.setName ?? candidate.details.identity.setCode ?? "Unknown set")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if candidate.originatingStrategy == .manual {
                Text("Selected by you")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            } else {
                Text("\(candidate.confidence.score, format: .percent.precision(.fractionLength(0))) match")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(tint)
            }
        }
    }
}

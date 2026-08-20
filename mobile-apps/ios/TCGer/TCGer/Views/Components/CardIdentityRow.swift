import SwiftUI

/// Shared compact card identity presentation. Screens provide only their
/// domain-specific metadata and trailing status/actions.
struct CardIdentityRow<Details: View, Trailing: View>: View {
    let card: Card
    let imageWidth: CGFloat
    let imageHeight: CGFloat
    let titleFont: Font
    private let details: Details
    private let trailing: Trailing

    init(
        card: Card,
        imageWidth: CGFloat = 60,
        imageHeight: CGFloat = 84,
        titleFont: Font = .headline,
        @ViewBuilder details: () -> Details,
        @ViewBuilder trailing: () -> Trailing
    ) {
        self.card = card
        self.imageWidth = imageWidth
        self.imageHeight = imageHeight
        self.titleFont = titleFont
        self.details = details()
        self.trailing = trailing()
    }

    var body: some View {
        HStack(spacing: 12) {
            CardArtworkImage(card: card, useFullResolution: false)
                .frame(width: imageWidth, height: imageHeight)

            VStack(alignment: .leading, spacing: 4) {
                Text(card.name)
                    .font(titleFont)
                    .lineLimit(2)
                details
            }

            Spacer(minLength: 8)
            trailing
        }
    }
}

extension CardIdentityRow where Trailing == EmptyView {
    init(
        card: Card,
        imageWidth: CGFloat = 60,
        imageHeight: CGFloat = 84,
        titleFont: Font = .headline,
        @ViewBuilder details: () -> Details
    ) {
        self.init(
            card: card,
            imageWidth: imageWidth,
            imageHeight: imageHeight,
            titleFont: titleFont,
            details: details,
            trailing: { EmptyView() }
        )
    }
}

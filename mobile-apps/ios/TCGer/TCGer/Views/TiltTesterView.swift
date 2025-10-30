import SwiftUI

struct TiltTesterView: View {
    let cards: [CollectionCard]

    @Environment(\.dismiss) private var dismiss

    private let demoCardSize = CGSize(width: 280, height: 280 / 0.72)

    private var availableCards: [Card] { [Self.demoCard] }
    private var activeCard: Card { Self.demoCard }

    var body: some View {
        NavigationView {
            VStack(spacing: 24) {
                Spacer(minLength: 12)

                TiltedCardView(
                    card: activeCard,
                    size: demoCardSize,
                    useFullResolution: true,
                    maxTiltDegrees: 18,
                    enableMotion: true,
                    enableDrag: true,
                    showsShadow: true
                )
                .frame(height: demoCardSize.height + 56)

                VStack(spacing: 6) {
                    Text(activeCard.name)
                        .font(.title3)
                        .fontWeight(.semibold)
                    Text(activeCard.tcgDisplayName)
                        .font(.footnote)
                        .foregroundColor(.secondary)
                    Text("Set: \(activeCard.setName ?? "Pokémon GO")")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                    Text("Foil style: Reverse Holo (PokéStop reference card)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 4)
                }
                .multilineTextAlignment(.center)

                Spacer()
            }
            .padding()
            .navigationTitle("Tilt Card Demo")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private static let demoCard = Card(
        id: "pgo-068",
        name: "PokéStop",
        tcg: "pokemon",
        setCode: "PGO",
        setName: "Pokémon GO",
        rarity: "Uncommon Reverse Holo",
        imageUrl: "https://images.pokemontcg.io/pgo/68_hires.png",
        imageUrlSmall: "https://images.pokemontcg.io/pgo/68.png",
        price: nil,
        collectorNumber: "068/078",
        releasedAt: nil
    )

}

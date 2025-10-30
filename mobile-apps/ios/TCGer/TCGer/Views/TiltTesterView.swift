import SwiftUI

struct TiltTesterView: View {
    let cards: [CollectionCard]

    @Environment(\.dismiss) private var dismiss
    @State private var selectedCardIndex: Int = 0

    private let demoCardSize = CGSize(width: 280, height: 280 / 0.72)

    private var availableCards: [Card] { Self.demoCards }
    private var activeCard: Card { Self.demoCards[selectedCardIndex] }

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
                    Text("Set: \(activeCard.setName ?? "Unknown")")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                    Text("Rarity: \(activeCard.rarity ?? "Unknown")")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    if let foilStyle = PokemonFoilStyle.style(for: activeCard) {
                        Text("Foil Effect: \(foilStyleName(foilStyle))")
                            .font(.caption)
                            .foregroundColor(.blue)
                            .padding(.top, 2)
                    }
                }
                .multilineTextAlignment(.center)

                // Card switcher
                HStack(spacing: 12) {
                    Button(action: { cycleCard(direction: -1) }) {
                        Image(systemName: "chevron.left.circle.fill")
                            .font(.title2)
                            .foregroundColor(.blue)
                    }

                    Text("\(selectedCardIndex + 1) / \(Self.demoCards.count)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .monospacedDigit()
                        .frame(minWidth: 50)

                    Button(action: { cycleCard(direction: 1) }) {
                        Image(systemName: "chevron.right.circle.fill")
                            .font(.title2)
                            .foregroundColor(.blue)
                    }
                }
                .padding(.top, 8)

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

    private func cycleCard(direction: Int) {
        withAnimation(.easeInOut(duration: 0.2)) {
            selectedCardIndex = (selectedCardIndex + direction + Self.demoCards.count) % Self.demoCards.count
        }
    }

    private func foilStyleName(_ style: PokemonFoilStyle) -> String {
        switch style {
        case .regularHolo: return "Regular Holo"
        case .cosmos: return "Cosmos Holo"
        case .sunpillar: return "Sunpillar"
        case .sunpillarEtched: return "Sunpillar Etched (Ultra Rare)"
        case .radiant: return "Radiant"
        case .rainbow: return "Rainbow Rare"
        case .secret: return "Secret Rare"
        case .reverse: return "Reverse Holo"
        case .amazing: return "Amazing Rare"
        case .fullCard: return "Full Art"
        }
    }

    // Available demo cards with different foil effects
    // Using embedded local images from Assets.xcassets/DemoCards
    private static let demoCards: [Card] = [
        // Ultra Rare Full Art Trainer (Sunpillar Etched)
        Card(
            id: "swsh9-167",
            name: "Barry",
            tcg: "pokemon",
            setCode: "SWSH9",
            setName: "Brilliant Stars",
            rarity: "Rare Ultra",
            imageUrl: "Peonia",  // Local asset name
            imageUrlSmall: "Peonia",  // Local asset name
            price: nil,
            collectorNumber: "167",
            releasedAt: nil,
            supertype: "Trainer",
            subtypes: ["Supporter"]
        ),
        // Cosmos Holo Trainer
        Card(
            id: "swsh45-60",
            name: "Professor's Research",
            tcg: "pokemon",
            setCode: "SWSH45",
            setName: "Shining Fates: Shiny Vault",
            rarity: "Rare Holo Cosmos",
            imageUrl: "ProfessorsResearch",  // Local asset name
            imageUrlSmall: "ProfessorsResearch",  // Local asset name
            price: nil,
            collectorNumber: "60",
            releasedAt: nil,
            supertype: "Trainer",
            subtypes: ["Supporter"]
        ),
        // Regular Holo Trainer
        Card(
            id: "swsh9-132",
            name: "Boss's Orders",
            tcg: "pokemon",
            setCode: "SWSH9",
            setName: "Brilliant Stars",
            rarity: "Rare Holo",
            imageUrl: "BossOrders",  // Local asset name
            imageUrlSmall: "BossOrders",  // Local asset name
            price: nil,
            collectorNumber: "132",
            releasedAt: nil,
            supertype: "Trainer",
            subtypes: ["Supporter"]
        ),
        // Rainbow Rare VMAX
        Card(
            id: "swsh4-188",
            name: "Pikachu VMAX",
            tcg: "pokemon",
            setCode: "SWSH4",
            setName: "Vivid Voltage",
            rarity: "Rare Rainbow",
            imageUrl: "Rayquaza",  // Local asset name
            imageUrlSmall: "Rayquaza",  // Local asset name
            price: nil,
            collectorNumber: "188",
            releasedAt: nil,
            supertype: "Pokémon",
            subtypes: ["VMAX"]
        ),
        // Reverse Holo Trainer
        Card(
            id: "pgo-69",
            name: "PokéStop",
            tcg: "pokemon",
            setCode: "PGO",
            setName: "Pokémon GO",
            rarity: "Uncommon Reverse Holo",
            imageUrl: "PokeStop",  // Local asset name
            imageUrlSmall: "PokeStop",  // Local asset name
            price: nil,
            collectorNumber: "68",
            releasedAt: nil,
            supertype: "Trainer",
            subtypes: ["Stadium"]
        )
    ]

    private static let demoCard = demoCards[0]  // Default to Ultra Rare Full Art

}

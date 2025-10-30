import SwiftUI

enum PokemonFoilStyle: CaseIterable {
    case regularHolo
    case cosmos
    case sunpillar
    case sunpillarEtched
    case radiant
    case rainbow
    case secret
    case reverse
    case amazing
    case fullCard

    static func textures(for card: Card) -> (foil: String?, mask: String?)? {
        switch card.id {
        case "swsh9-167": return ("BarryFoil", "BarryMask")
        case "swsh9-132": return ("BossFoil", "BossMask")
        case "swsh45-60": return ("ProfessorFoil", "ProfessorMask")
        case "swsh4-188": return ("PikachuFoil", "PikachuMask")
        case "pgo-69": return ("PokeStopFoil", "PokeStopMask")
        default: return nil
        }
    }

    static func style(for card: Card) -> PokemonFoilStyle? {
        guard card.tcg.lowercased() == "pokemon" else { return nil }
        guard let rarityValue = card.rarity?.lowercased() else { return nil }
        let rarity = rarityValue.trimmingCharacters(in: .whitespacesAndNewlines)

        let supertype = card.supertype?.lowercased()
        let subtypes = card.subtypes?.map { $0.lowercased() } ?? []
        let isTrainer = supertype == "trainer"
        let isSupporter = subtypes.contains("supporter")

        if rarity.contains("reverse holo") {
            return .reverse
        }

        if rarity.contains("rainbow alt") || rarity.contains("rainbow rare") || rarity.contains("hyper rare") {
            return .rainbow
        }

        if rarity.contains("amazing rare") {
            return .amazing
        }

        if rarity.contains("radiant") {
            return .radiant
        }

        if rarity.contains("secret") {
            return .secret
        }

        if rarity.contains("cosmos") {
            return .cosmos
        }

        if rarity.contains("ultra") && isTrainer && isSupporter {
            return .fullCard
        }

        if rarity.contains("ultra") {
            return .sunpillarEtched
        }

        if rarity.contains("vstar") || rarity.contains("vmax") {
            return .sunpillarEtched
        }

        if rarity.contains("gx") || rarity.contains("ex") {
            return .sunpillar
        }

        if rarity.contains("v") || rarity.contains("v-union") {
            return .sunpillar
        }

        if rarity.contains("holo") {
            return .regularHolo
        }

        return nil
    }

    var isSunpillarFamily: Bool {
        switch self {
        case .sunpillar, .sunpillarEtched, .fullCard: return true
        default: return false
        }
    }

    func shouldApplyTextureMask(for card: Card) -> Bool {
        switch self {
        case .sunpillar, .sunpillarEtched:
            if card.supertype?.lowercased() == "trainer" { return false }
            return true
        case .fullCard:
            return false
        default:
            return true
        }
    }

    func configuration(for card: Card) -> PokemonFoilConfiguration {
        let starfieldOpacity = self == .cosmos ? 0.45 : 0
        let sparkleRingOpacity = self == .amazing ? 0.6 : 0
        let lowercasedSupertype = card.supertype?.lowercased()
        let textures = PokemonFoilStyle.textures(for: card)

        let reverseFoilConfig: PokemonReverseFoilConfig?
        let maskImageName: String?

        if self == .reverse {
            let fallbackFoil = textures?.foil ?? (lowercasedSupertype == "trainer" ? "FoilTrainerBG" : "FoilIllusion")
            reverseFoilConfig = PokemonReverseFoilConfig(
                foilImageName: fallbackFoil,
                pointerOffsetFraction: lowercasedSupertype == "trainer" ? 0.15 : 0.1,
                brightness: lowercasedSupertype == "trainer" ? 0.85 : 0.7
            )
            maskImageName = textures?.mask
        } else {
            reverseFoilConfig = nil
            maskImageName = nil
        }

        return PokemonFoilConfiguration(
            rainbowColors: rainbowColors,
            secondaryGradient: secondaryGradient,
            scanlineSpacing: scanlineSpacing,
            scanlineLight: scanlineLight,
            scanlineDark: scanlineDark,
            scanlineAngle: scanlineAngle,
            baseOpacity: baseOpacity,
            highlightRadiusFactor: highlightRadiusFactor,
            starfieldOpacity: starfieldOpacity,
            sparkleRingOpacity: sparkleRingOpacity,
            cosmosLayers: cosmosLayers,
            reverseFoil: reverseFoilConfig,
            maskImageName: maskImageName,
            textureLayers: textureLayers(for: card)
        )
    }

    private var rainbowColors: [Color] {
        switch self {
        case .regularHolo:
            return [
                Color(red: 1.0, green: 0.05, blue: 0.21),
                Color(red: 0.93, green: 0.93, blue: 0.06),
                Color(red: 0.13, green: 0.91, blue: 0.52),
                Color(red: 0.05, green: 0.74, blue: 0.96),
                Color(red: 0.79, green: 0.16, blue: 0.95),
                Color(red: 1.0, green: 0.45, blue: 0.22)
            ]
        case .cosmos:
            return [
                Color(red: 0.94, green: 0.75, blue: 0.98),
                Color(red: 0.56, green: 0.75, blue: 0.97),
                Color(red: 0.37, green: 0.9, blue: 0.86),
                Color(red: 0.98, green: 0.86, blue: 0.54)
            ]
        case .sunpillar:
            return [
                Color(red: 1.0, green: 0.68, blue: 0.4),
                Color(red: 0.94, green: 0.45, blue: 0.74),
                Color(red: 0.55, green: 0.77, blue: 1.0)
            ]
        case .sunpillarEtched:
            return [
                Color(red: 1.0, green: 0.78, blue: 0.5),
                Color(red: 0.88, green: 0.52, blue: 0.96),
                Color(red: 0.56, green: 0.82, blue: 1.0),
                Color(red: 0.62, green: 0.96, blue: 0.78)
            ]
        case .radiant:
            return [
                Color(red: 0.93, green: 0.96, blue: 0.38),
                Color(red: 0.42, green: 0.97, blue: 0.82),
                Color(red: 0.42, green: 0.72, blue: 0.98),
                Color(red: 0.89, green: 0.58, blue: 0.96),
                Color(red: 0.99, green: 0.76, blue: 0.42)
            ]
        case .rainbow:
            return [
                Color(red: 1.0, green: 0.68, blue: 0.9),
                Color(red: 1.0, green: 0.83, blue: 0.54),
                Color(red: 0.72, green: 0.95, blue: 0.7),
                Color(red: 0.55, green: 0.82, blue: 1.0)
            ]
        case .secret:
            return [
                Color(red: 0.95, green: 0.83, blue: 0.6),
                Color(red: 0.84, green: 0.7, blue: 0.98),
                Color(red: 0.58, green: 0.8, blue: 1.0)
            ]
        case .reverse:
            return [
                Color(red: 0.94, green: 0.78, blue: 0.3),
                Color(red: 0.58, green: 0.82, blue: 0.95),
                Color(red: 0.98, green: 0.52, blue: 0.7)
            ]
        case .amazing:
            return [
                Color(red: 1.0, green: 0.56, blue: 0.46),
                Color(red: 1.0, green: 0.87, blue: 0.46),
                Color(red: 0.64, green: 0.95, blue: 0.52),
                Color(red: 0.45, green: 0.8, blue: 1.0)
            ]
        case .fullCard:
            return [
                Color(red: 0.95, green: 0.88, blue: 0.6),
                Color(red: 0.65, green: 0.82, blue: 1.0),
                Color(red: 0.85, green: 0.62, blue: 1.0)
            ]
        }
    }

    private var secondaryGradient: [Color] {
        switch self {
        case .regularHolo:
            return [
                Color.white.opacity(0.4),
                Color(red: 0.5, green: 0.7, blue: 1.0).opacity(0.25),
                Color.black.opacity(0.1)
            ]
        case .cosmos:
            return [
                Color.white.opacity(0.5),
                Color(red: 0.8, green: 0.7, blue: 1.0).opacity(0.3),
                Color.black.opacity(0.2)
            ]
        case .sunpillar:
            return [
                Color.white.opacity(0.55),
                Color(red: 0.95, green: 0.62, blue: 0.4).opacity(0.25),
                Color.black.opacity(0.08)
            ]
        case .sunpillarEtched:
            return [
                Color.white.opacity(0.6),
                Color(red: 0.92, green: 0.7, blue: 0.98).opacity(0.3),
                Color.black.opacity(0.1)
            ]
        case .radiant:
            return [
                Color.white.opacity(0.5),
                Color(red: 0.95, green: 0.7, blue: 0.4).opacity(0.3),
                Color.black.opacity(0.1)
            ]
        case .rainbow:
            return [
                Color.white.opacity(0.55),
                Color(red: 1.0, green: 0.68, blue: 0.6).opacity(0.3),
                Color.black.opacity(0.1)
            ]
        case .secret:
            return [
                Color.white.opacity(0.6),
                Color(red: 0.95, green: 0.8, blue: 0.52).opacity(0.35),
                Color.black.opacity(0.08)
            ]
        case .reverse:
            return [
                Color.white.opacity(0.45),
                Color(red: 0.9, green: 0.75, blue: 0.4).opacity(0.2),
                Color.black.opacity(0.05)
            ]
        case .amazing:
            return [
                Color.white.opacity(0.6),
                Color(red: 1.0, green: 0.8, blue: 0.4).opacity(0.35),
                Color.black.opacity(0.1)
            ]
        case .fullCard:
            return [
                Color.white.opacity(0.45),
                Color(red: 0.65, green: 0.8, blue: 1.0).opacity(0.25),
                Color.black.opacity(0.08)
            ]
        }
    }

    private var scanlineSpacing: CGFloat {
        switch self {
        case .regularHolo: return 4.0
        case .cosmos: return 6.5
        case .sunpillar: return 5.0
        case .sunpillarEtched: return 5.5
        case .radiant: return 6.0
        case .rainbow: return 6.0
        case .secret: return 5.5
        case .reverse: return 4.5
        case .amazing: return 6.5
        case .fullCard: return 5.5
        }
    }

    private var scanlineLight: Color {
        switch self {
        case .regularHolo: return Color.white.opacity(0.65)
        case .cosmos: return Color.white.opacity(0.55)
        case .sunpillar: return Color.white.opacity(0.6)
        case .sunpillarEtched: return Color.white.opacity(0.7)
        case .radiant: return Color.white.opacity(0.5)
        case .rainbow: return Color.white.opacity(0.6)
        case .secret: return Color.white.opacity(0.65)
        case .reverse: return Color.white.opacity(0.5)
        case .amazing: return Color.white.opacity(0.6)
        case .fullCard: return Color.white.opacity(0.55)
        }
    }

    private var scanlineDark: Color {
        switch self {
        case .regularHolo: return Color.black.opacity(0.35)
        case .cosmos: return Color.black.opacity(0.3)
        case .sunpillar: return Color.black.opacity(0.25)
        case .sunpillarEtched: return Color.black.opacity(0.22)
        case .radiant: return Color.black.opacity(0.25)
        case .rainbow: return Color.black.opacity(0.2)
        case .secret: return Color.black.opacity(0.22)
        case .reverse: return Color.black.opacity(0.2)
        case .amazing: return Color.black.opacity(0.28)
        case .fullCard: return Color.black.opacity(0.3)
        }
    }

    private var scanlineAngle: Angle {
        switch self {
        case .regularHolo: return Angle(degrees: 110)
        case .cosmos: return Angle(degrees: 120)
        case .sunpillar: return Angle(degrees: 130)
        case .sunpillarEtched: return Angle(degrees: 140)
        case .radiant: return Angle(degrees: 135)
        case .rainbow: return Angle(degrees: 125)
        case .secret: return Angle(degrees: 115)
        case .reverse: return Angle(degrees: 110)
        case .amazing: return Angle(degrees: 135)
        case .fullCard: return Angle(degrees: 125)
        }
    }

    private func textureLayers(for card: Card) -> [PokemonFoilTextureLayer] {
        var layers: [PokemonFoilTextureLayer] = []

        if self != .cosmos {
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilGrain",
                    tileScale: 0.18,
                    offsetMultiplier: CGPoint(x: 0.35, y: 0.35),
                    opacity: self == .reverse ? 0.1 : 0.18,
                    blendMode: .overlay,
                    usesSeed: true
                )
            )
        }

        switch self {
        case .rainbow:
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilGlitter",
                    tileScale: 0.25,
                    offsetMultiplier: CGPoint(x: 1.4, y: 1.4),
                    opacity: 0.9,
                    blendMode: .softLight,
                    usesSeed: true
                )
            )
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilIllusion",
                    tileScale: 0.33,
                    offsetMultiplier: CGPoint(x: 0.4, y: 0.4),
                    opacity: 0.45,
                    blendMode: .luminosity,
                    usesSeed: false
                )
            )
        case .secret:
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilGlitter",
                    tileScale: 0.25,
                    offsetMultiplier: CGPoint(x: 1.2, y: 1.2),
                    opacity: 0.85,
                    blendMode: .softLight,
                    usesSeed: true
                )
            )
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilGeometric",
                    tileScale: 0.33,
                    offsetMultiplier: CGPoint(x: 0.25, y: 0.25),
                    opacity: 0.55,
                    blendMode: .hardLight,
                    usesSeed: false
                )
            )
        case .sunpillar, .sunpillarEtched, .fullCard:
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilIllusion",
                    tileScale: 0.33,
                    offsetMultiplier: CGPoint(x: 0.35, y: 0.35),
                    opacity: 0.6,
                    blendMode: .softLight,
                    usesSeed: false
                )
            )
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilGlitter",
                    tileScale: 0.25,
                    offsetMultiplier: CGPoint(x: 0.9, y: 0.9),
                    opacity: self == .sunpillarEtched ? 0.55 : 0.35,
                    blendMode: .screen,
                    usesSeed: true
                )
            )
            if self == .sunpillarEtched {
                layers.append(
                    PokemonFoilTextureLayer(
                        imageName: "FoilVMaxBG",
                        tileScale: 0.4,
                        offsetMultiplier: CGPoint(x: 0.25, y: 0.25),
                        opacity: 0.45,
                        blendMode: .hardLight,
                        usesSeed: true
                    )
                )
            } else if self == .sunpillar {
                layers.append(
                    PokemonFoilTextureLayer(
                        imageName: "FoilAncient",
                        tileScale: 0.38,
                        offsetMultiplier: CGPoint(x: 0.3, y: 0.3),
                        opacity: 0.4,
                        blendMode: .overlay,
                        usesSeed: true
                    )
                )
            }
        case .radiant:
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilTrainerBG",
                    tileScale: 0.28,
                    offsetMultiplier: CGPoint(x: 1.1, y: 1.1),
                    opacity: 0.7,
                    blendMode: .hardLight,
                    usesSeed: true
                )
            )
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilGlitter",
                    tileScale: 0.18,
                    offsetMultiplier: CGPoint(x: 1.6, y: 1.6),
                    opacity: 0.6,
                    blendMode: .colorDodge,
                    usesSeed: true
                )
            )
        case .amazing:
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: "FoilGlitter",
                    tileScale: 0.22,
                    offsetMultiplier: CGPoint(x: 1.2, y: 1.2),
                    opacity: 0.65,
                    blendMode: .screen,
                    usesSeed: true
                )
            )
        case .reverse:
            let lowercasedSupertype = card.supertype?.lowercased()
            layers.append(
                PokemonFoilTextureLayer(
                    imageName: lowercasedSupertype == "trainer" ? "FoilTrainerBG" : "FoilIllusion",
                    tileScale: 0.3,
                    offsetMultiplier: CGPoint(x: 0.5, y: 0.5),
                    opacity: lowercasedSupertype == "trainer" ? 0.5 : 0.4,
                    blendMode: .colorDodge,
                    usesSeed: true
                )
            )
        case .cosmos, .regularHolo:
            break
        }

        return layers
    }

    private var baseOpacity: Double {
        switch self {
        case .regularHolo: return 0.75
        case .cosmos: return 0.8
        case .sunpillar: return 0.78
        case .sunpillarEtched: return 0.82
        case .radiant: return 0.85
        case .rainbow: return 0.85
        case .secret: return 0.8
        case .reverse: return 0.7
        case .amazing: return 0.88
        case .fullCard: return 0.8
        }
    }

    private var highlightRadiusFactor: CGFloat {
        switch self {
        case .regularHolo: return 0.85
        case .cosmos: return 1.0
        case .sunpillar: return 0.9
        case .sunpillarEtched: return 1.05
        case .radiant: return 1.1
        case .rainbow: return 1.2
        case .secret: return 1.05
        case .reverse: return 1.25
        case .amazing: return 1.2
        case .fullCard: return 1.2
        }
    }

    private func maskKind(for card: Card) -> PokemonArtMaskShape.Kind? {
        let subtypes = card.subtypes?.map { $0.lowercased() } ?? []
        let isStage = subtypes.contains { $0.hasPrefix("stage") }
        let isTrainer = card.supertype?.lowercased() == "trainer"

        switch self {
        case .regularHolo, .cosmos:
            if isTrainer { return .trainer }
            if isStage { return .stage }
            return .standard
        case .sunpillar, .sunpillarEtched:
            return isTrainer ? nil : .standard
        case .radiant:
            return .radiant
        case .rainbow, .secret, .amazing:
            return .full
        case .fullCard, .reverse:
            return nil
        }
    }

    func maskView(for card: Card) -> AnyView {
        if self == .reverse {
            let subtypes = card.subtypes?.map { $0.lowercased() } ?? []
            let isStage = subtypes.contains { $0.hasPrefix("stage") }
            let isTrainer = card.supertype?.lowercased() == "trainer"

            let reverseKind: PokemonReverseMaskShape.Kind = {
                if isTrainer { return .trainer }
                if isStage { return .stage }
                return .standard
            }()

            return AnyView(
                PokemonReverseMaskShape(kind: reverseKind)
                    .fill(Color.white, style: FillStyle(eoFill: true))
            )
        }

        guard let kind = maskKind(for: card) else {
            return AnyView(foilsFullCardMask())
        }

        return AnyView(
            PokemonArtMaskShape(kind: kind)
                .fill(Color.white)
        )
    }

    private var cosmosLayers: [PokemonCosmosLayer] {
        guard self == .cosmos else { return [] }
        return [
            PokemonCosmosLayer(imageName: "CosmosBottom", blendMode: .colorBurn, offsetFraction: 0.35, opacity: 0.9),
            PokemonCosmosLayer(imageName: "CosmosMiddle", blendMode: .overlay, offsetFraction: 0.25, opacity: 0.92),
            PokemonCosmosLayer(imageName: "CosmosTop", blendMode: .multiply, offsetFraction: 0.18, opacity: 0.85)
        ]
    }
}

struct PokemonFoilConfiguration {
    let rainbowColors: [Color]
    let secondaryGradient: [Color]
    let scanlineSpacing: CGFloat
    let scanlineLight: Color
    let scanlineDark: Color
    let scanlineAngle: Angle
    let baseOpacity: Double
    let highlightRadiusFactor: CGFloat
    let starfieldOpacity: Double
    let sparkleRingOpacity: Double
    let cosmosLayers: [PokemonCosmosLayer]
    let reverseFoil: PokemonReverseFoilConfig?
    let maskImageName: String?
    let textureLayers: [PokemonFoilTextureLayer]
}

struct PokemonFoilTextureLayer: Identifiable {
    let id = UUID()
    let imageName: String
    let tileScale: CGFloat
    let offsetMultiplier: CGPoint
    let opacity: Double
    let blendMode: BlendMode
    let usesSeed: Bool
}

struct PokemonCosmosLayer {
    let imageName: String
    let blendMode: BlendMode
    let offsetFraction: CGFloat
    let opacity: Double
}

struct PokemonReverseFoilConfig {
    let foilImageName: String
    let pointerOffsetFraction: CGFloat
    let brightness: Double
}

struct PokemonArtMaskShape: Shape {
    enum Kind {
        case standard
        case stage
        case trainer
        case radiant
        case full
    }

    var kind: Kind = .standard

    func path(in rect: CGRect) -> Path {
        let insetTop: CGFloat
        let insetBottom: CGFloat
        let insetSides: CGFloat
        let cornerScale: CGFloat

        switch kind {
        case .stage:
            return stagePolygon(in: rect)
        case .standard:
            insetTop = rect.height * 0.0985
            insetBottom = rect.height * 0.5285
            insetSides = rect.width * 0.08
            cornerScale = 0
        case .trainer:
            insetTop = rect.height * 0.145
            insetBottom = rect.height * 0.482
            insetSides = rect.width * 0.085
            cornerScale = 0
        case .radiant:
            insetTop = rect.height * 0.028
            insetBottom = rect.height * 0.4
            insetSides = rect.width * 0.04
            cornerScale = 0.08
        case .full:
            insetTop = rect.height * 0.025
            insetBottom = rect.height * 0.05
            insetSides = rect.width * 0.05
            cornerScale = 0.08
        }

        let artRect = CGRect(
            x: rect.minX + insetSides,
            y: rect.minY + insetTop,
            width: rect.width - insetSides * 2,
            height: rect.height - insetTop - insetBottom
        )

        let cornerRadius = min(artRect.width, artRect.height) * cornerScale

        var path = Path()
        path.addRoundedRect(in: artRect, cornerSize: CGSize(width: cornerRadius, height: cornerRadius))
        return path
    }
}

struct PokemonReverseMaskShape: Shape {
    enum Kind {
        case standard
        case stage
        case trainer
    }

    var kind: Kind = .trainer

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.addRect(rect)

        let insetTop: CGFloat
        let insetRight: CGFloat
        let insetBottom: CGFloat
        let insetLeft: CGFloat

        switch kind {
        case .standard:
            insetTop = rect.height * 0.0985
            insetRight = rect.width * 0.08
            insetBottom = rect.height * 0.5285
            insetLeft = rect.width * 0.08
            let cutout = CGRect(
                x: rect.minX + insetLeft,
                y: rect.minY + insetTop,
                width: rect.width - insetLeft - insetRight,
                height: rect.height - insetTop - insetBottom
            )
            path.addRect(cutout)
            return path
        case .trainer:
            insetTop = rect.height * 0.145
            insetRight = rect.width * 0.085
            insetBottom = rect.height * 0.482
            insetLeft = rect.width * 0.085
            let cutout = CGRect(
                x: rect.minX + insetLeft,
                y: rect.minY + insetTop,
                width: rect.width - insetLeft - insetRight,
                height: rect.height - insetTop - insetBottom
            )
            path.addRect(cutout)
            return path
        case .stage:
            let stagePath = stagePolygon(in: rect)
            path.addPath(stagePath)
            return path
        }
    }
}

private func stagePolygon(in rect: CGRect) -> Path {
    let points: [CGPoint] = [
        CGPoint(x: rect.minX + rect.width * 0.915, y: rect.minY + rect.height * 0.0985),
        CGPoint(x: rect.minX + rect.width * 0.57, y: rect.minY + rect.height * 0.0985),
        CGPoint(x: rect.minX + rect.width * 0.54, y: rect.minY + rect.height * 0.12),
        CGPoint(x: rect.minX + rect.width * 0.17, y: rect.minY + rect.height * 0.12),
        CGPoint(x: rect.minX + rect.width * 0.16, y: rect.minY + rect.height * 0.14),
        CGPoint(x: rect.minX + rect.width * 0.12, y: rect.minY + rect.height * 0.16),
        CGPoint(x: rect.minX + rect.width * 0.08, y: rect.minY + rect.height * 0.16),
        CGPoint(x: rect.minX + rect.width * 0.08, y: rect.minY + rect.height * 0.4715),
        CGPoint(x: rect.minX + rect.width * 0.92, y: rect.minY + rect.height * 0.4715)
    ]

    var path = Path()
    guard let first = points.first else { return path }
    path.move(to: first)
    for point in points.dropFirst() {
        path.addLine(to: point)
    }
    path.closeSubpath()
    return path
}

private struct FullCardMaskShape: Shape {
    func path(in rect: CGRect) -> Path {
        Path(CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: rect.height))
    }
}

private func foilsFullCardMask() -> some View {
    FullCardMaskShape().fill(Color.white)
}

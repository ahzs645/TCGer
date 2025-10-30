import SwiftUI

struct PokemonFoilOverlay: View {
    let style: PokemonFoilStyle
    let pointer: CGPoint
    let intensity: Double

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let configuration = style.configuration()
            let distanceFromCenter = min(intensity, 1.0)
            let baseOpacity = configuration.baseOpacity * (0.35 + distanceFromCenter * 0.75)
            let highlightPoint = UnitPoint(x: pointer.x, y: pointer.y)

            let content = ZStack {
                if let reverseFoil = configuration.reverseFoil {
                    PokemonReverseFoilOverlay(
                        config: reverseFoil,
                        pointer: pointer,
                        intensity: intensity
                    )
                } else {
                    ForEach(configuration.cosmosLayers.indices, id: \.self) { index in
                        let layer = configuration.cosmosLayers[index]
                        CosmosTextureLayer(
                            imageName: layer.imageName,
                            pointer: pointer,
                            offsetFraction: layer.offsetFraction
                        )
                        .blendMode(layer.blendMode)
                        .opacity(layer.opacity)
                    }

                    LinearGradient(
                        gradient: Gradient(colors: configuration.rainbowColors),
                        startPoint: UnitPoint(
                            x: max(0, min(1, 0.15 + pointer.x * 0.7)),
                            y: max(0, min(1, 0.1 + pointer.y * 0.6))
                        ),
                        endPoint: UnitPoint(
                            x: max(0, min(1, 0.85 - pointer.x * 0.6)),
                            y: max(0, min(1, 0.9 - pointer.y * 0.5))
                        )
                    )
                    .blendMode(.colorDodge)

                    FoilScanlineOverlay(
                        spacing: configuration.scanlineSpacing,
                        lightColor: configuration.scanlineLight,
                        darkColor: configuration.scanlineDark,
                        angle: configuration.scanlineAngle,
                        pointer: pointer
                    )
                    .blendMode(.overlay)
                    .opacity(0.7)

                    LinearGradient(
                        gradient: Gradient(colors: configuration.secondaryGradient),
                        startPoint: UnitPoint(
                            x: max(0, min(1, pointer.x * 0.4)),
                            y: max(0, min(1, 1 - pointer.y * 0.4))
                        ),
                        endPoint: UnitPoint(
                            x: max(0, min(1, 0.8 + pointer.x * 0.4)),
                            y: max(0, min(1, pointer.y * 0.3))
                        )
                    )
                    .blendMode(.screen)
                    .opacity(0.6)

                    if configuration.starfieldOpacity > 0 {
                        AngularGradient(
                            gradient: Gradient(colors: [
                                Color.white.opacity(0.15),
                                Color(red: 0.7, green: 0.9, blue: 1.0).opacity(0.12),
                                Color.clear,
                                Color(red: 0.8, green: 0.6, blue: 1.0).opacity(0.15)
                            ]),
                            center: .center
                        )
                        .opacity(configuration.starfieldOpacity)
                        .blendMode(.screen)
                    }

                    if configuration.sparkleRingOpacity > 0 {
                        Circle()
                            .strokeBorder(
                                AngularGradient(
                                    gradient: Gradient(colors: [
                                        Color.white.opacity(0.5),
                                        Color(red: 1.0, green: 0.8, blue: 0.4).opacity(0.4),
                                        Color.white.opacity(0.5)
                                    ]),
                                    center: highlightPoint
                                ),
                                lineWidth: min(size.width, size.height) * 0.08
                            )
                            .frame(width: min(size.width, size.height) * 0.9)
                            .opacity(configuration.sparkleRingOpacity * (0.3 + distanceFromCenter * 0.7))
                            .blendMode(.screen)
                    }
                }

                RadialGradient(
                    gradient: Gradient(colors: [
                        Color.white.opacity(0.9),
                        Color.white.opacity(0.35),
                        Color.white.opacity(0.0)
                    ]),
                    center: highlightPoint,
                    startRadius: 0,
                    endRadius: min(size.width, size.height) * configuration.highlightRadiusFactor
                )
                .blendMode(.screen)
                .opacity(0.75 * distanceFromCenter)
            }
            .opacity(baseOpacity)
            .frame(width: size.width, height: size.height)

            let maskView: AnyView = {
                if let maskName = configuration.maskImageName {
                    return AnyView(
                        Image(maskName)
                            .resizable()
                            .scaledToFill()
                            .frame(width: size.width, height: size.height)
                    )
                } else {
                    return AnyView(
                        style.maskView
                            .frame(width: size.width, height: size.height)
                    )
                }
            }()

            content
                .mask(maskView)
        }
        .compositingGroup()
        .blendMode(.plusLighter)
        .allowsHitTesting(false)
    }
}


private struct FoilScanlineOverlay: View {
    let spacing: CGFloat
    let lightColor: Color
    let darkColor: Color
    let angle: Angle
    let pointer: CGPoint

    var body: some View {
        Canvas { context, size in
            guard spacing > 0 else { return }

            let offsetX = CGFloat(pointer.x - 0.5) * spacing * 20
            let offsetY = CGFloat(pointer.y - 0.5) * spacing * 20
            let diagonal = hypot(size.width, size.height)

            var path = Path()
            var y: CGFloat = -diagonal + offsetY
            var index = 0
            while y < diagonal + size.height {
                path.move(to: CGPoint(x: -diagonal + offsetX, y: y))
                path.addLine(to: CGPoint(x: diagonal + offsetX, y: y))
                let color = (index % 2 == 0) ? lightColor : darkColor
                context.stroke(path, with: .color(color.opacity(0.25)), lineWidth: 1)
                path = Path()
                y += spacing
                index += 1
            }
        }
        .rotationEffect(angle)
    }
}

private struct CosmosTextureLayer: View {
    let imageName: String
    let pointer: CGPoint
    let offsetFraction: CGFloat

    var body: some View {
        GeometryReader { proxy in
            let offsetX = (CGFloat(pointer.x) - 0.5) * proxy.size.width * offsetFraction
            let offsetY = (CGFloat(pointer.y) - 0.5) * proxy.size.height * offsetFraction

            Image(imageName)
                .resizable()
                .scaledToFill()
                .frame(width: proxy.size.width, height: proxy.size.height)
                .offset(x: offsetX, y: offsetY)
                .clipped()
                .allowsHitTesting(false)
        }
    }
}

private struct PokemonReverseFoilOverlay: View {
    let config: PokemonReverseFoilConfig
    let pointer: CGPoint
    let intensity: Double

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let offsetX = (CGFloat(pointer.x) - 0.5) * size.width * config.pointerOffsetFraction
            let offsetY = (CGFloat(pointer.y) - 0.5) * size.height * config.pointerOffsetFraction
            let startPoint = UnitPoint(x: max(0, min(1, pointer.x)), y: max(0, min(1, pointer.y)))

            ZStack {
                Image(config.foilImageName)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size.width, height: size.height)
                    .offset(x: offsetX, y: offsetY)
                    .colorMultiply(Color.white.opacity(config.brightness))
                    .blendMode(.colorDodge)
                    .opacity(0.85 + intensity * 0.1)

                RadialGradient(
                    gradient: Gradient(colors: [
                        Color.white.opacity(0.7),
                        Color.black.opacity(0.4),
                        Color.white.opacity(0.15)
                    ]),
                    center: startPoint,
                    startRadius: 0,
                    endRadius: max(size.width, size.height)
                )
                .blendMode(.softLight)
                .opacity(0.45)

                LinearGradient(
                    gradient: Gradient(colors: [
                        Color.black.opacity(0.85),
                        Color.white.opacity(0.2),
                        Color.black.opacity(0.85)
                    ]),
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .blendMode(.difference)
                .opacity(0.35)
            }
            .frame(width: size.width, height: size.height)
        }
    }
}

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

    static func style(for card: Card) -> PokemonFoilStyle? {
        guard card.tcg.lowercased() == "pokemon" else { return nil }
        guard let rarityValue = card.rarity?.lowercased() else { return nil }
        let rarity = rarityValue.trimmingCharacters(in: .whitespacesAndNewlines)

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
        case .regularHolo:
            return 4.0
        case .cosmos:
            return 6.5
        case .sunpillar:
            return 5.0
        case .sunpillarEtched:
            return 5.5
        case .radiant:
            return 6.0
        case .rainbow:
            return 6.0
        case .secret:
            return 5.5
        case .reverse:
            return 4.5
        case .amazing:
            return 6.5
        case .fullCard:
            return 5.5
        }
    }

    private var scanlineLight: Color {
        switch self {
        case .regularHolo:
            return Color.white.opacity(0.65)
        case .cosmos:
            return Color.white.opacity(0.55)
        case .sunpillar:
            return Color.white.opacity(0.6)
        case .sunpillarEtched:
            return Color.white.opacity(0.7)
        case .radiant:
            return Color.white.opacity(0.5)
        case .rainbow:
            return Color.white.opacity(0.6)
        case .secret:
            return Color.white.opacity(0.65)
        case .reverse:
            return Color.white.opacity(0.5)
        case .amazing:
            return Color.white.opacity(0.6)
        case .fullCard:
            return Color.white.opacity(0.55)
        }
    }

    private var scanlineDark: Color {
        switch self {
        case .regularHolo:
            return Color.black.opacity(0.35)
        case .cosmos:
            return Color.black.opacity(0.3)
        case .sunpillar:
            return Color.black.opacity(0.25)
        case .sunpillarEtched:
            return Color.black.opacity(0.22)
        case .radiant:
            return Color.black.opacity(0.25)
        case .rainbow:
            return Color.black.opacity(0.2)
        case .secret:
            return Color.black.opacity(0.22)
        case .reverse:
            return Color.black.opacity(0.2)
        case .amazing:
            return Color.black.opacity(0.28)
        case .fullCard:
            return Color.black.opacity(0.3)
        }
    }

    private var scanlineAngle: Angle {
        switch self {
        case .regularHolo:
            return Angle(degrees: 110)
        case .cosmos:
            return Angle(degrees: 120)
        case .sunpillar:
            return Angle(degrees: 130)
        case .sunpillarEtched:
            return Angle(degrees: 140)
        case .radiant:
            return Angle(degrees: 135)
        case .rainbow:
            return Angle(degrees: 125)
        case .secret:
            return Angle(degrees: 115)
        case .reverse:
            return Angle(degrees: 110)
        case .amazing:
            return Angle(degrees: 135)
        case .fullCard:
            return Angle(degrees: 125)
        }
    }

    private var baseOpacity: Double {
        switch self {
        case .regularHolo:
            return 0.75
        case .cosmos:
            return 0.8
        case .sunpillar:
            return 0.78
        case .sunpillarEtched:
            return 0.82
        case .radiant:
            return 0.85
        case .rainbow:
            return 0.85
        case .secret:
            return 0.8
        case .reverse:
            return 0.7
        case .amazing:
            return 0.88
        case .fullCard:
            return 0.8
        }
    }

    private var highlightRadiusFactor: CGFloat {
        switch self {
        case .regularHolo:
            return 0.85
        case .cosmos:
            return 1.0
        case .sunpillar:
            return 0.9
        case .sunpillarEtched:
            return 1.05
        case .radiant:
            return 1.1
        case .rainbow:
            return 1.2
        case .secret:
            return 1.05
        case .reverse:
            return 1.25
        case .amazing:
            return 1.2
        case .fullCard:
            return 1.2
        }
    }

    private var maskKind: PokemonArtMaskShape.Kind? {
        switch self {
        case .regularHolo, .sunpillar, .sunpillarEtched, .cosmos:
            return .standard
        case .radiant:
            return .radiant
        case .rainbow, .secret, .amazing:
            return .full
        case .reverse, .fullCard:
            return nil
        }
    }

    var maskView: some View {
        if let kind = maskKind {
            return AnyView(
                PokemonArtMaskShape(kind: kind)
                    .fill(Color.white)
            )
        } else {
            switch self {
            case .reverse:
                return AnyView(
                    PokemonReverseMaskShape(kind: .trainer)
                            .fill(Color.white, style: FillStyle(eoFill: true))
                               )
            default:
                return AnyView(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(Color.white)
                )
            }
        }
    }

    func configuration() -> PokemonFoilConfiguration {
        let starfieldOpacity = self == .cosmos ? 0.45 : 0
        let sparkleRingOpacity = self == .amazing ? 0.6 : 0
        let reverseFoilConfig: PokemonReverseFoilConfig?
        let maskImageName: String?

        if self == .reverse {
            reverseFoilConfig = PokemonReverseFoilConfig(
                foilImageName: "PokeStopFoil",
                pointerOffsetFraction: 0.0,
                brightness: 0.9
            )
            maskImageName = "PokeStopMask"
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
            maskImageName: maskImageName
        )
    }

    private var cosmosLayers: [PokemonCosmosLayer] {
        guard self == .cosmos else { return [] }
        return [
            PokemonCosmosLayer(imageName: "CosmosBottom", blendMode: .colorBurn, offsetFraction: 0.0, opacity: 0.85),
            PokemonCosmosLayer(imageName: "CosmosMiddle", blendMode: .overlay, offsetFraction: 0.0, opacity: 0.9),
            PokemonCosmosLayer(imageName: "CosmosTop", blendMode: .multiply, offsetFraction: 0.0, opacity: 0.8)
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

private struct PokemonArtMaskShape: Shape {
    enum Kind {
        case standard
        case radiant
        case full
    }

    var kind: Kind = .standard

    func path(in rect: CGRect) -> Path {
        let insetTop: CGFloat
        let insetBottom: CGFloat
        let insetSides: CGFloat

        switch kind {
        case .standard:
            insetTop = rect.height * 0.0985
            insetBottom = rect.height * 0.5285
            insetSides = rect.width * 0.08
        case .radiant:
            insetTop = rect.height * 0.028
            insetBottom = rect.height * 0.4
            insetSides = rect.width * 0.04
        case .full:
            insetTop = rect.height * 0.025
            insetBottom = rect.height * 0.05
            insetSides = rect.width * 0.05
        }

        let artRect = CGRect(
            x: rect.minX + insetSides,
            y: rect.minY + insetTop,
            width: rect.width - insetSides * 2,
            height: rect.height - insetTop - insetBottom
        )

        let cornerRadius = min(artRect.width, artRect.height) * 0.06

        var path = Path()
        path.addRoundedRect(in: artRect, cornerSize: CGSize(width: cornerRadius, height: cornerRadius))
        return path
    }
}

private struct PokemonReverseMaskShape: Shape {
    enum Kind {
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
        case .trainer:
            insetTop = rect.height * 0.145
            insetRight = rect.width * 0.085
            insetBottom = rect.height * 0.482
            insetLeft = rect.width * 0.085
        }

        let cutout = CGRect(
            x: rect.minX + insetLeft,
            y: rect.minY + insetTop,
            width: rect.width - insetLeft - insetRight,
            height: rect.height - insetTop - insetBottom
        )

        path.addRect(cutout)
        return path
    }
}

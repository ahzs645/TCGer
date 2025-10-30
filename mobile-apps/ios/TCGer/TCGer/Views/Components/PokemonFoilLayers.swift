import SwiftUI

struct FoilScanlineOverlay: View {
    let spacing: CGFloat
    let lightColor: Color
    let darkColor: Color
    let angle: Angle
    let uniforms: PokemonFoilUniforms

    var body: some View {
        Canvas { context, size in
            guard spacing > 0 else { return }

            let offsetX = (uniforms.pointer.x - 0.5) * spacing * 20
            let offsetY = (uniforms.pointer.y - 0.5) * spacing * 20
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

struct CosmosTextureLayer: View {
    let imageName: String
    let uniforms: PokemonFoilUniforms
    let offsetFraction: CGFloat

    var body: some View {
        GeometryReader { proxy in
            let pointerX = (uniforms.pointer.x - 0.5) * proxy.size.width * offsetFraction
            let pointerY = (uniforms.pointer.y - 0.5) * proxy.size.height * offsetFraction
            let seedX = (uniforms.cosmosBase.x - 0.5) * proxy.size.width
            let seedY = (uniforms.cosmosBase.y - 0.5) * proxy.size.height

            Image(imageName)
                .resizable()
                .scaledToFill()
                .frame(width: proxy.size.width, height: proxy.size.height)
                .offset(x: pointerX + seedX, y: pointerY + seedY)
                .clipped()
                .allowsHitTesting(false)
        }
    }
}

struct FoilTiledTexture: View {
    let config: PokemonFoilTextureLayer
    let uniforms: PokemonFoilUniforms

    var body: some View {
        GeometryReader { proxy in
            let baseDimension = max(min(proxy.size.width, proxy.size.height), 1)
            let tileScale = max(config.tileScale, 0.01)
            let tileWidth = max(baseDimension * tileScale, 1)
            let tileHeight = tileWidth
            let seedOffsetX = config.usesSeed ? (uniforms.randomSeed.x - 0.5) * tileWidth * 2 : 0
            let seedOffsetY = config.usesSeed ? (uniforms.randomSeed.y - 0.5) * tileHeight * 2 : 0

            Canvas { context, size in
                let image = context.resolve(Image(config.imageName))
                let pointerOffsetX = (uniforms.pointer.x - 0.5) * tileWidth * config.offsetMultiplier.x
                let pointerOffsetY = (uniforms.pointer.y - 0.5) * tileHeight * config.offsetMultiplier.y

                var x = -tileWidth * 2 + seedOffsetX + pointerOffsetX
                while x < size.width + tileWidth * 2 {
                    var y = -tileHeight * 2 + seedOffsetY + pointerOffsetY
                    while y < size.height + tileHeight * 2 {
                        context.draw(image, in: CGRect(x: x, y: y, width: tileWidth, height: tileHeight))
                        y += tileHeight
                    }
                    x += tileWidth
                }
            }
        }
        .blendMode(config.blendMode)
        .opacity(config.opacity)
        .allowsHitTesting(false)
    }
}

struct PokemonReverseFoilOverlay: View {
    let config: PokemonReverseFoilConfig
    let uniforms: PokemonFoilUniforms

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let offsetX = (uniforms.pointer.x - 0.5) * size.width * config.pointerOffsetFraction
            let offsetY = (uniforms.pointer.y - 0.5) * size.height * config.pointerOffsetFraction
            let startPoint = uniforms.highlightPoint
            let strength = uniforms.interactionStrength

            ZStack {
                Image(config.foilImageName)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size.width, height: size.height)
                    .offset(x: offsetX, y: offsetY)
                    .colorMultiply(Color.white.opacity(config.brightness))
                    .blendMode(.colorDodge)
                    .opacity(strength * 0.7)

                RadialGradient(
                    gradient: Gradient(colors: [
                        Color.white.opacity(0.5),
                        Color.black.opacity(0.4),
                        Color.white.opacity(0.1)
                    ]),
                    center: startPoint,
                    startRadius: 0,
                    endRadius: max(size.width, size.height)
                )
                .blendMode(.softLight)
                .opacity(strength * 0.35)

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
                .opacity(strength * 0.3)
            }
            .frame(width: size.width, height: size.height)
        }
    }
}

struct PokemonRealFoilOverlay: View {
    let foilImageName: String
    let maskImageName: String?
    let style: PokemonFoilStyle
    let uniforms: PokemonFoilUniforms
    let configuration: PokemonFoilConfiguration

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let offsetY = (uniforms.pointer.y - 0.5) * size.height * 2.0
            let strength = uniforms.interactionStrength

            ZStack {
                ZStack {
                    Image(foilImageName)
                        .resizable()
                        .scaledToFill()
                        .frame(width: size.width, height: size.height)

                    if style.isSunpillarFamily {
                        SunpillarStripeOverlay(colors: configuration.rainbowColors, uniforms: uniforms)
                    }

                    LinearGradient(
                        gradient: Gradient(stops: [
                            .init(color: Color(hue: 0.0, saturation: 1.0, brightness: 0.85), location: 0.0),
                            .init(color: Color(hue: 0.14, saturation: 1.0, brightness: 0.85), location: 0.14),
                            .init(color: Color(hue: 0.28, saturation: 1.0, brightness: 0.85), location: 0.28),
                            .init(color: Color(hue: 0.5, saturation: 1.0, brightness: 0.90), location: 0.42),
                            .init(color: Color(hue: 0.64, saturation: 1.0, brightness: 0.90), location: 0.57),
                            .init(color: Color(hue: 0.78, saturation: 1.0, brightness: 0.85), location: 0.71),
                            .init(color: Color(hue: 0.0, saturation: 1.0, brightness: 0.85), location: 1.0)
                        ]),
                        startPoint: .top,
                        endPoint: .bottom
                    )
                    .frame(width: size.width, height: size.height * 7)
                    .offset(y: offsetY)
                    .blendMode(.softLight)

                    RepeatingDiagonalPattern()
                        .frame(width: size.width * 3, height: size.height)
                        .offset(y: offsetY * 0.2)
                        .blendMode(.hardLight)

                    RadialGradient(
                        gradient: Gradient(colors: [
                            Color.black.opacity(0.1),
                            Color.black.opacity(0.15),
                            Color.black.opacity(0.25)
                        ]),
                        center: uniforms.highlightPoint,
                        startRadius: size.width * 0.12,
                        endRadius: size.width * 1.2
                    )
                }
                .blendMode(.hardLight)
                .brightness(0.4 + strength * 0.4)
                .contrast(1.4)
                .saturation(2.25)
                .opacity(strength)

                RadialGradient(
                    gradient: Gradient(colors: [
                        Color.white.opacity(1.0),
                        Color.black.opacity(0.0)
                    ]),
                    center: uniforms.highlightPoint,
                    startRadius: 0,
                    endRadius: size.width * 0.4
                )
                .blendMode(.overlay)
                .opacity(strength * 0.75)

                RadialGradient(
                    gradient: Gradient(colors: [
                        Color(white: 0.75),
                        Color(hue: 0.55, saturation: 0.05, brightness: 0.35),
                        Color(hue: 0.89, saturation: 0.4, brightness: 0.1)
                    ]),
                    center: uniforms.highlightPoint,
                    startRadius: size.width * 0.05,
                    endRadius: size.width * 1.5
                )
                .scaleEffect(1.2)
                .blendMode(.hardLight)
                .contrast(1.2)
                .saturation(1.0)
                .opacity(strength * 0.75)
            }
            .frame(width: size.width, height: size.height)
            .mask {
                if let maskImageName = maskImageName {
                    Image(maskImageName)
                        .resizable()
                        .scaledToFill()
                        .frame(width: size.width, height: size.height)
                } else {
                    Rectangle()
                }
            }
        }
    }
}

private struct SunpillarStripeOverlay: View {
    let colors: [Color]
    let uniforms: PokemonFoilUniforms

    var body: some View {
        GeometryReader { proxy in
            let height = proxy.size.height
            let spacing = max(height * 0.05, 2)
            let cycle = spacing * CGFloat(max(colors.count, 1))
            let rawOffset = uniforms.backgroundOffsetY * height * 3
            let wrappedOffset = (rawOffset.truncatingRemainder(dividingBy: cycle) + cycle).truncatingRemainder(dividingBy: cycle)

            Canvas { context, size in
                var y = -cycle + wrappedOffset
                var index = 0
                while y < size.height + cycle {
                    let color = colors[index % max(colors.count, 1)]
                    let rect = CGRect(x: 0, y: y, width: size.width, height: spacing)
                    context.fill(Path(rect), with: .color(color))
                    y += spacing
                    index += 1
                }
            }
        }
        .blendMode(.hue)
        .opacity(0.85)
    }
}

private struct RepeatingDiagonalPattern: View {
    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            Canvas { context, size in
                let spacing: CGFloat = 80
                let angle: CGFloat = 133 * .pi / 180

                for i in stride(from: -size.height, to: size.width + size.height, by: spacing) {
                    var path = Path()
                    path.move(to: CGPoint(x: i, y: 0))
                    path.addLine(to: CGPoint(x: i + size.height * tan(angle), y: size.height))

                    context.stroke(path, with: .color(Color(hue: 0.5, saturation: 0.29, brightness: 0.66).opacity(0.4)), lineWidth: 4)
                }
            }
        }
    }
}

import SwiftUI

struct PokemonFoilOverlay: View {
    let card: Card
    let style: PokemonFoilStyle
    let pointer: CGPoint
    let intensity: Double

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let configuration = style.configuration(for: card)
            let seeds = pokemonFoilSeeds(for: card.id)
            let uniforms = PokemonFoilUniforms(pointer: pointer, intensity: intensity, seed: seeds.seed, cosmosBase: seeds.cosmos)
            let textures = PokemonFoilStyle.textures(for: card)
            let sparkleStrength = max(uniforms.pointerFromCenter, uniforms.interactionStrength)

            let content = ZStack {
                Group {
                    if let textures = textures, let foilName = textures.foil {
                        let maskName = style.shouldApplyTextureMask(for: card) ? textures.mask : nil
                        if style == .fullCard, card.supertype?.lowercased() == "trainer" {
                            PokemonFullArtTrainerFoilOverlay(
                                foilImageName: foilName,
                                maskImageName: maskName,
                                uniforms: uniforms,
                                configuration: configuration,
                                stripeColors: style.fullArtStripeColors
                            )
                        } else {
                            PokemonRealFoilOverlay(
                                foilImageName: foilName,
                                maskImageName: maskName,
                                style: style,
                                uniforms: uniforms,
                                configuration: configuration
                            )
                        }
                    } else if let reverseFoil = configuration.reverseFoil {
                        PokemonReverseFoilOverlay(
                            config: reverseFoil,
                            uniforms: uniforms
                        )
                    } else {
                        ForEach(configuration.cosmosLayers.indices, id: \.self) { index in
                            let layer = configuration.cosmosLayers[index]
                            CosmosTextureLayer(
                                imageName: layer.imageName,
                                uniforms: uniforms,
                                offsetFraction: layer.offsetFraction
                            )
                            .blendMode(layer.blendMode)
                            .opacity(layer.opacity)
                        }

                        LinearGradient(
                            gradient: Gradient(colors: configuration.rainbowColors),
                            startPoint: uniforms.primaryGradientStart,
                            endPoint: uniforms.primaryGradientEnd
                        )
                        .blendMode(.colorDodge)

                        FoilScanlineOverlay(
                            spacing: configuration.scanlineSpacing,
                            lightColor: configuration.scanlineLight,
                            darkColor: configuration.scanlineDark,
                            angle: configuration.scanlineAngle,
                            uniforms: uniforms
                        )
                        .blendMode(.overlay)
                        .opacity(0.5)

                        LinearGradient(
                            gradient: Gradient(colors: configuration.secondaryGradient),
                            startPoint: uniforms.secondaryGradientStart,
                            endPoint: uniforms.secondaryGradientEnd
                        )
                        .blendMode(.screen)
                        .opacity(0.4)

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
                                        center: uniforms.highlightPoint
                                    ),
                                    lineWidth: min(size.width, size.height) * 0.08
                                )
                                .frame(width: min(size.width, size.height) * 0.9)
                                .opacity(configuration.sparkleRingOpacity * (0.3 + sparkleStrength * 0.7))
                                .blendMode(.screen)
                        }
                    }
                }

                ForEach(configuration.textureLayers) { layer in
                    FoilTiledTexture(config: layer, uniforms: uniforms)
                }
            }

            let highlightedContent = content
                .overlay(
                    RadialGradient(
                        gradient: Gradient(colors: [
                            Color.white.opacity(0.35),
                            Color.white.opacity(0.18),
                            Color.black.opacity(0.22)
                        ]),
                        center: uniforms.highlightPoint,
                        startRadius: 0,
                        endRadius: min(size.width, size.height) * configuration.highlightRadiusFactor
                    )
                    .blendMode(.overlay)
                    .opacity(0.35 * sparkleStrength)
                )

            let maskBuilder: () -> AnyView = {
                if let maskName = configuration.maskImageName {
                    return AnyView(
                        Image(maskName)
                            .resizable()
                            .scaledToFill()
                    )
                } else {
                    return style.maskView(for: card)
                }
            }

            ZStack {
                highlightedContent
                    .opacity(configuration.baseOpacity * uniforms.cardOpacity)

                if let glareConfig = configuration.glare {
                    PokemonFoilGlareView(config: glareConfig, uniforms: uniforms)
                }
            }
            .frame(width: size.width, height: size.height)
            .mask(
                maskBuilder()
                    .frame(width: size.width, height: size.height)
            )
        }
        .compositingGroup()
        .blendMode(.plusLighter)
        .allowsHitTesting(false)
    }
}

import SwiftUI
import CoreMotion
import Combine

/// Renders a card with a motion-driven tilt effect and optional drag override.
struct TiltedCardView: View {
    let card: Card
    var size: CGSize?
    var useFullResolution: Bool = true
    var maxTiltDegrees: Double = 18
    var enableMotion: Bool = true
    var enableDrag: Bool = true
    var showsShadow: Bool = true

    @StateObject private var motionManager = CardMotionManager()
    @State private var manualTilt: CardTilt?

    private var tiltFromMotion: CardTilt {
        guard enableMotion else { return .zero }
        return CardTilt(
            xRotation: (-motionManager.pitch.toDegrees).clamped(to: -maxTiltDegrees...maxTiltDegrees),
            yRotation: motionManager.roll.toDegrees.clamped(to: -maxTiltDegrees...maxTiltDegrees)
        )
    }

    var body: some View {
        GeometryReader { proxy in
            let resolvedSize = resolveSize(for: proxy.size)
            let currentTilt = manualTilt ?? tiltFromMotion

            let normalizedPointer = CGPoint(
                x: ((currentTilt.yRotation / maxTiltDegrees) + 1) * 0.5,
                y: ((-currentTilt.xRotation / maxTiltDegrees) + 1) * 0.5
            ).clamped(to: 0...1)
            let pointerDistance = sqrt(
                pow(Double(normalizedPointer.x) - 0.5, 2) +
                pow(Double(normalizedPointer.y) - 0.5, 2)
            ) * 2.0
            let foilIntensity = pointerDistance.clamped(to: 0...1)
            let foilStyle = PokemonFoilStyle.style(for: card)

            let dragGesture = DragGesture(minimumDistance: 0)
                .onChanged { value in
                    guard enableDrag, resolvedSize.width > 0, resolvedSize.height > 0 else { return }
                    var horizontalRatio = Double(value.translation.width / (resolvedSize.width / 2))
                    var verticalRatio = Double(value.translation.height / (resolvedSize.height / 2))
                    horizontalRatio = horizontalRatio.clamped(to: -1...1)
                    verticalRatio = verticalRatio.clamped(to: -1...1)

                    let newTilt = CardTilt(
                        xRotation: (-verticalRatio * maxTiltDegrees).clamped(to: -maxTiltDegrees...maxTiltDegrees),
                        yRotation: (horizontalRatio * maxTiltDegrees).clamped(to: -maxTiltDegrees...maxTiltDegrees)
                    )

                    withAnimation(.easeOut(duration: 0.1)) {
                        manualTilt = newTilt
                    }
                }
                .onEnded { _ in
                    guard enableDrag else { return }
                    withAnimation(.easeOut(duration: 0.3)) {
                        manualTilt = nil
                    }
                }

            CardArtworkImage(card: card, useFullResolution: useFullResolution)
                .aspectRatio(0.72, contentMode: .fit)
                .overlay {
                    if let style = foilStyle {
                        PokemonFoilOverlay(
                            style: style,
                            pointer: normalizedPointer,
                            intensity: foilIntensity
                        )
                    }
                }
                .frame(width: resolvedSize.width, height: resolvedSize.height)
                .rotation3DEffect(.degrees(currentTilt.xRotation), axis: (x: 1, y: 0, z: 0), perspective: 0.65)
                .rotation3DEffect(.degrees(currentTilt.yRotation), axis: (x: 0, y: 1, z: 0), perspective: 0.65)
                .shadow(color: .black.opacity(showsShadow ? 0.25 : 0), radius: 18, x: currentTilt.yRotation * 0.4, y: 12 + abs(currentTilt.xRotation) * 0.3)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                .contentShape(Rectangle())
                .gesture(enableDrag ? dragGesture : nil)
        }
        .aspectRatio(size.map { $0.width / $0.height } ?? 0.72, contentMode: .fit)
        .onAppear {
            if enableMotion {
                motionManager.start()
            }
        }
        .onDisappear {
            motionManager.stop()
        }
    }

    private func resolveSize(for availableSize: CGSize) -> CGSize {
        if let size {
            return size
        }

        guard availableSize.width > 0, availableSize.height > 0 else {
            return CGSize(width: 240, height: 240 / 0.72)
        }

        let aspect: CGFloat = 0.72
        let candidateWidth = min(availableSize.width, availableSize.height * aspect)
        let width = max(candidateWidth, 0)
        let height = width / aspect
        return CGSize(width: width, height: height)
    }
}

private final class CardMotionManager: ObservableObject {
    @Published private(set) var roll: Double = 0
    @Published private(set) var pitch: Double = 0

    private let motionManager = CMMotionManager()

    init(updateInterval: TimeInterval = 1.0 / 60.0) {
        motionManager.deviceMotionUpdateInterval = updateInterval
    }

    func start() {
        guard motionManager.isDeviceMotionAvailable, !motionManager.isDeviceMotionActive else { return }
        motionManager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let motion else { return }
            self.roll = motion.attitude.roll
            self.pitch = motion.attitude.pitch
        }
    }

    func stop() {
        guard motionManager.isDeviceMotionActive else { return }
        motionManager.stopDeviceMotionUpdates()
        self.roll = 0
        self.pitch = 0
    }
}

private struct CardTilt {
    var xRotation: Double
    var yRotation: Double

    static let zero = CardTilt(xRotation: 0, yRotation: 0)
}

private extension Double {
    var toDegrees: Double { self * 180.0 / .pi }
}

private extension Comparable {
    func clamped(to limits: ClosedRange<Self>) -> Self {
        min(max(self, limits.lowerBound), limits.upperBound)
    }
}

private extension CGPoint {
    func clamped(to range: ClosedRange<Double>) -> CGPoint {
        CGPoint(
            x: max(range.lowerBound, min(Double(x), range.upperBound)),
            y: max(range.lowerBound, min(Double(y), range.upperBound))
        )
    }
}

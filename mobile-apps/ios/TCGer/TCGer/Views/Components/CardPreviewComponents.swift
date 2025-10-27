import SwiftUI
import CoreMotion
import Combine

/// Shared card artwork loader used anywhere we need a consistent card image rendering.
struct CardArtworkImage: View {
    let card: Card
    let useFullResolution: Bool

    private var imageURL: URL? {
        if useFullResolution, let highRes = card.imageUrl, let url = URL(string: highRes) {
            return url
        }
        if let small = card.imageUrlSmall, let url = URL(string: small) {
            return url
        }
        if let fallback = card.imageUrl, let url = URL(string: fallback) {
            return url
        }
        return nil
    }

    var body: some View {
        CachedAsyncImage(url: imageURL) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .aspectRatio(contentMode: .fit)
            case .empty:
                Rectangle()
                    .fill(Color(.systemGray5))
                    .overlay(ProgressView())
            case .failure:
                Rectangle()
                    .fill(Color(.systemGray5))
                    .overlay(
                        Image(systemName: "photo")
                            .foregroundColor(.secondary)
                    )
            @unknown default:
                Rectangle()
                    .fill(Color(.systemGray5))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// A reusable preview view shown when the system context menu presents card artwork.
struct CardPreviewContextView: View {
    let card: Card
    @StateObject private var motionManager = CardMotionManager()
    @State private var manualTilt: CardTilt?

    private let maxTiltDegrees: Double = 18

    var body: some View {
        GeometryReader { proxy in
            let availableWidth = proxy.size.width
            let availableHeight = proxy.size.height

            // Provide sensible bounds so the preview feels full-size without exceeding the menu.
            let maxWidth = min(max(availableWidth - 48, 300), 360)
            let maxHeight = min(max(availableHeight - 48, 420), 520)
            let widthFromHeight = maxHeight * 0.72
            let targetWidth = min(maxWidth, widthFromHeight)
            let targetHeight = targetWidth / 0.72
            let cardSize = CGSize(width: targetWidth, height: targetHeight)

            let currentTilt = manualTilt ?? CardTilt(
                xRotation: (-motionManager.pitch.toDegrees).clamped(to: -maxTiltDegrees...maxTiltDegrees),
                yRotation: motionManager.roll.toDegrees.clamped(to: -maxTiltDegrees...maxTiltDegrees)
            )

            let xRotation = currentTilt.xRotation
            let yRotation = currentTilt.yRotation

            let dragGesture = DragGesture(minimumDistance: 0)
                .onChanged { value in
                    guard cardSize.width > 0, cardSize.height > 0 else { return }
                    var horizontalRatio = Double(value.translation.width / (cardSize.width / 2))
                    var verticalRatio = Double(value.translation.height / (cardSize.height / 2))
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
                    withAnimation(.easeOut(duration: 0.3)) {
                        manualTilt = nil
                    }
                }

            CardArtworkImage(card: card, useFullResolution: true)
                .aspectRatio(0.72, contentMode: .fit)
                .frame(width: targetWidth, height: targetHeight)
                .rotation3DEffect(.degrees(xRotation), axis: (x: 1, y: 0, z: 0), perspective: 0.65)
                .rotation3DEffect(.degrees(yRotation), axis: (x: 0, y: 1, z: 0), perspective: 0.65)
                .shadow(color: .black.opacity(0.25), radius: 18, x: yRotation * 0.4, y: 12 + abs(xRotation) * 0.3)
                .padding(28)
                .frame(width: proxy.size.width, height: proxy.size.height, alignment: .center)
                .gesture(dragGesture)
        }
        .frame(minWidth: 320, idealWidth: 340, maxWidth: 380, minHeight: 420, idealHeight: 460, maxHeight: 520)
        .onAppear {
            motionManager.start()
        }
        .onDisappear {
            motionManager.stop()
        }
    }
}

private struct CardPreviewContextMenuModifier: ViewModifier {
    let card: Card
    let onSelect: (() -> Void)?

    func body(content: Content) -> some View {
        content.contextMenu {
            if let onSelect {
                Button("Select this print", action: onSelect)
                Divider()
            }
            Button("Close", role: .cancel) { }
        } preview: {
            CardPreviewContextView(card: card)
        }
    }
}

extension View {
    /// Attaches a context menu preview for the given card, using an optional selection action.
    func cardPreviewContextMenu(card: Card, onSelect: (() -> Void)? = nil) -> some View {
        modifier(CardPreviewContextMenuModifier(card: card, onSelect: onSelect))
    }
}

extension Card {
    /// Convenience factory to build a preview-capable card from a collection entry.
    static func preview(from collectionCard: CollectionCard) -> Card {
        Card(
            id: collectionCard.cardId,
            name: collectionCard.name,
            tcg: collectionCard.tcg,
            setCode: collectionCard.setCode,
            setName: collectionCard.setName,
            rarity: collectionCard.rarity,
            imageUrl: collectionCard.imageUrl,
            imageUrlSmall: collectionCard.imageUrlSmall,
            price: collectionCard.price,
            collectorNumber: collectionCard.collectorNumber,
            releasedAt: nil
        )
    }
}

extension CollectionCard {
    var previewCard: Card { Card.preview(from: self) }
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

private extension Double {
    var toDegrees: Double { self * 180.0 / .pi }
}

private extension Comparable {
    func clamped(to limits: ClosedRange<Self>) -> Self {
        min(max(self, limits.lowerBound), limits.upperBound)
    }
}

private struct CardTilt {
    var xRotation: Double
    var yRotation: Double
}

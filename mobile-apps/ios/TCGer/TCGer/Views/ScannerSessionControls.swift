import SwiftUI
import UIKit

struct ScannerCameraToolbar: View {
    @ObservedObject var cameraController: CardScannerCameraController
    let scopeTitle: String?
    let onDismiss: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: "xmark")
                        .font(.headline)
                        .frame(width: 38, height: 38)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .foregroundStyle(.white)
                .accessibilityLabel("Close scanner")
            }

            if let scopeTitle {
                Text(scopeTitle)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(.ultraThinMaterial, in: Capsule())
            }

            Spacer()

            if cameraController.isTorchAvailable {
                Button(action: cameraController.toggleTorch) {
                    Image(systemName: cameraController.isTorchEnabled ? "flashlight.on.fill" : "flashlight.off.fill")
                        .font(.headline)
                        .frame(width: 38, height: 38)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .foregroundStyle(cameraController.isTorchEnabled ? Color.yellow : Color.white)
                .accessibilityLabel(cameraController.isTorchEnabled ? "Turn off flashlight" : "Turn on flashlight")
                .accessibilityValue(cameraController.isTorchEnabled ? "On" : "Off")
            }
        }
    }
}

struct ScannerSessionTray: View {
    let results: [CardScanResult]
    let pendingCardName: String?
    let pendingCount: Int
    let pendingRequired: Int
    let color: Color
    let onSelect: (CardScanResult) -> Void
    let onRemove: (CardScanResult.ID) -> Void
    let onClear: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Label("Scan Session", systemImage: "rectangle.stack.fill")
                    .font(.subheadline.weight(.semibold))
                Text("\(results.count)")
                    .font(.caption.bold())
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(color.opacity(0.22), in: Capsule())

                Spacer()

                if !results.isEmpty {
                    Button("Clear", action: onClear)
                        .font(.caption.weight(.semibold))
                        .accessibilityHint("Removes every card from this scan session")
                }
            }
            .foregroundStyle(.white)

            if let pendingCardName, pendingCount > 0 {
                HStack(spacing: 8) {
                    ProgressView(value: Double(pendingCount), total: Double(max(pendingRequired, 1)))
                        .tint(color)
                    Text("Hold still for \(pendingCardName) · \(pendingCount)/\(pendingRequired)")
                        .font(.caption)
                        .lineLimit(1)
                }
                .foregroundStyle(.white.opacity(0.9))
                .accessibilityElement(children: .combine)
            }

            if results.isEmpty {
                Text("Confirmed cards collect here while the camera stays open.")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.78))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 10) {
                        ForEach(Array(results.reversed())) { result in
                            ScannerSessionCard(
                                result: result,
                                color: color,
                                onSelect: { onSelect(result) },
                                onRemove: { onRemove(result.id) }
                            )
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Scan session with \(results.count) cards")
    }
}

private struct ScannerSessionCard: View {
    let result: CardScanResult
    let color: Color
    let onSelect: () -> Void
    let onRemove: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 9) {
                Image(uiImage: UIImage(cgImage: result.capturedImage))
                    .resizable()
                    .scaledToFill()
                    .frame(width: 38, height: 52)
                    .clipShape(RoundedRectangle(cornerRadius: 6))

                VStack(alignment: .leading, spacing: 3) {
                    Text(result.primary.details.identity.name)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    Text(result.primary.details.identity.setCode ?? result.mode.displayName)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(result.primary.confidence.score, format: .percent.precision(.fractionLength(0)))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(color)
                }
                .frame(width: 108, alignment: .leading)
            }
            .padding(8)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button(role: .destructive, action: onRemove) {
                Label("Remove from Session", systemImage: "trash")
            }
        }
        .accessibilityLabel(
            "\(result.primary.details.identity.name), " +
            "\(Int(result.primary.confidence.score * 100)) percent match"
        )
        .accessibilityHint("Shows scan details")
    }
}

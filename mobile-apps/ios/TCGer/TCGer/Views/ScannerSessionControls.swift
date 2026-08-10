import SwiftUI
import UIKit

struct ScannerCameraToolbar<LeadingContent: View>: View {
    @ObservedObject var cameraController: CardScannerCameraController
    let scopeTitle: String?
    let onDismiss: (() -> Void)?
    var dismissIcon: String = "xmark"
    @Binding var triggerMode: ScannerTriggerMode
    @Binding var automaticallyShowResults: Bool
    let showsTestInputs: Bool
    let isProcessing: Bool
    let onLoadPhoto: () -> Void
    let onLoadPhotos: () -> Void
    let onRunDemo: () -> Void
    @ViewBuilder let leadingContent: () -> LeadingContent

    var body: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 12) {
                toolbarContent
            }
        } else {
            toolbarContent
        }
    }

    private var toolbarContent: some View {
        HStack(spacing: 10) {
            if let onDismiss {
                Button(action: onDismiss) {
                    Image(systemName: dismissIcon)
                        .font(.headline)
                        .frame(width: 44, height: 44)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .foregroundStyle(.white)
                .accessibilityLabel("Close scanner")
            }

            leadingContent()

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

            Menu {
                Section("Single-card scan") {
                    ForEach(ScannerTriggerMode.allCases) { mode in
                        Button {
                            triggerMode = mode
                        } label: {
                            if triggerMode == mode {
                                Label(mode.displayName, systemImage: "checkmark")
                            } else {
                                Text(mode.displayName)
                            }
                        }
                        .disabled(isProcessing)
                    }
                }

                Section("Photo library") {
                    Button(action: onLoadPhoto) {
                        Label("Load Photo", systemImage: "photo")
                    }
                    .disabled(isProcessing)

                    Button(action: onLoadPhotos) {
                        Label("Load Photos in Bulk", systemImage: "photo.stack")
                    }
                    .disabled(isProcessing)
                }

                if showsTestInputs {
                    Section("Testing") {
                        Button(action: onRunDemo) {
                            Label("Demo", systemImage: "testtube.2")
                        }
                        .disabled(isProcessing)
                    }
                }

                Section("Results") {
                    Toggle(isOn: $automaticallyShowResults) {
                        Label("Open Results Automatically", systemImage: "rectangle.portrait.and.arrow.forward")
                    }
                    .disabled(isProcessing)
                }
            } label: {
                scannerOptionsLabel
            }
            .foregroundStyle(.primary)
            .accessibilityLabel("Scanner options")
            .accessibilityValue(
                "\(triggerMode.displayName) scan, automatic results "
                    + (automaticallyShowResults ? "on" : "off")
            )

            if cameraController.isTorchAvailable {
                Button(action: cameraController.toggleTorch) {
                    Image(systemName: cameraController.isTorchEnabled ? "flashlight.on.fill" : "flashlight.off.fill")
                        .font(.headline)
                        .frame(width: 44, height: 44)
                        .background(.ultraThinMaterial, in: Circle())
                }
                .foregroundStyle(cameraController.isTorchEnabled ? Color.yellow : Color.white)
                .accessibilityLabel(cameraController.isTorchEnabled ? "Turn off flashlight" : "Turn on flashlight")
                .accessibilityValue(cameraController.isTorchEnabled ? "On" : "Off")
            }
        }
    }

    @ViewBuilder
    private var scannerOptionsLabel: some View {
        if #available(iOS 26.0, *) {
            Image(systemName: "ellipsis")
                .font(.headline)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
                .glassEffect(.regular.interactive(), in: .circle)
        } else {
            Image(systemName: "ellipsis")
                .font(.headline)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
        }
    }
}

struct ScannerSessionTray: View {
    let results: [CardScanResult]
    let pendingCardName: String?
    let pendingCount: Int
    let pendingRequired: Int
    let color: Color
    let onReview: () -> Void
    let onSelect: (CardScanResult) -> Void
    let onRemove: (CardScanResult.ID) -> Void
    let onClear: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: onReview) {
                HStack(spacing: 6) {
                    Label("\(results.count)", systemImage: "rectangle.stack.fill")
                    Image(systemName: "chevron.right")
                        .font(.caption2.weight(.bold))
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 10)
                .frame(height: 42)
                .background(color.opacity(0.24), in: Capsule())
            }
            .buttonStyle(.plain)
            .disabled(results.isEmpty)
            .accessibilityLabel("Review \(results.count) scanned cards")
            .accessibilityHint("Select cards, correct matches, or add them to a binder")

            if let pendingCardName, pendingCount > 0 {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text("Hold steady")
                            .font(.caption.weight(.semibold))
                        Text(pendingCardName)
                            .font(.caption)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        Text("\(pendingCount)/\(pendingRequired)")
                            .font(.caption.monospacedDigit())
                    }
                    ProgressView(value: Double(pendingCount), total: Double(max(pendingRequired, 1)))
                        .tint(color)
                }
                .foregroundStyle(.white.opacity(0.9))
                .accessibilityElement(children: .combine)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: 8) {
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

            if !results.isEmpty {
                Button(action: onClear) {
                    Image(systemName: "xmark")
                        .font(.caption.weight(.bold))
                        .frame(width: 32, height: 32)
                        .background(Color.white.opacity(0.14), in: Circle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .accessibilityLabel("Clear scan session")
                .accessibilityHint("Removes every card from this scan session")
            }
        }
        .frame(height: 58)
        .padding(.horizontal, 8)
        .background(.ultraThinMaterial, in: Capsule())
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
                    .frame(width: 28, height: 40)
                    .clipShape(RoundedRectangle(cornerRadius: 5))

                VStack(alignment: .leading, spacing: 2) {
                    Text(result.primary.details.identity.name)
                        .font(.caption2.weight(.semibold))
                        .lineLimit(1)

                    HStack(spacing: 5) {
                        Text(result.primary.details.identity.setCode ?? result.mode.displayName)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                        Spacer(minLength: 2)
                        Text(result.primary.confidence.score, format: .percent.precision(.fractionLength(0)))
                            .monospacedDigit()
                            .foregroundStyle(color)
                    }
                    .font(.caption2)
                }
                .frame(width: 94, alignment: .leading)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
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

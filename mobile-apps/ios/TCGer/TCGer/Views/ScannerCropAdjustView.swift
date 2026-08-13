import SwiftUI
import UIKit

/// Manual perspective rescue for a failed or visibly poor automatic crop. The
/// editor only supplies a normalized quad; retry still runs through TCGer's
/// existing recognition coordinator and dev-mode recorder.
struct ScannerCropAdjustView: View {
    private enum Corner: String, CaseIterable, Identifiable {
        case topLeft = "TL"
        case topRight = "TR"
        case bottomRight = "BR"
        case bottomLeft = "BL"

        var id: Self { self }
    }

    @Environment(\.dismiss) private var dismiss
    let request: ScannerCropRescueRequest
    let color: Color
    let onRetry: (ScannerCropQuad) async -> Void

    @State private var quad: ScannerCropQuad
    @State private var selectedCorner: Corner = .topLeft
    @State private var isRetrying = false

    init(
        request: ScannerCropRescueRequest,
        color: Color,
        onRetry: @escaping (ScannerCropQuad) async -> Void
    ) {
        self.request = request
        self.color = color
        self.onRetry = onRetry
        _quad = State(initialValue: request.initialQuad)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Text("Drag each handle to the card's outside corners. Leave the full printed border inside the outline.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                canvas
                    .frame(maxHeight: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 16))

                cornerSelector

                HStack(spacing: 12) {
                    Button("Reset") {
                        quad = request.initialQuad
                    }
                    .buttonStyle(.bordered)

                    Button {
                        quad = quad.expandedOutward(by: 0.025)
                    } label: {
                        Label("Protect Border", systemImage: "arrow.up.left.and.arrow.down.right")
                    }
                    .buttonStyle(.bordered)

                    Button {
                        Task {
                            isRetrying = true
                            await onRetry(quad)
                            isRetrying = false
                            dismiss()
                        }
                    } label: {
                        if isRetrying {
                            ProgressView()
                        } else {
                            Text("Retry Scan")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(color)
                    .disabled(!quad.isValid || isRetrying)
                }
                .controlSize(.large)
            }
            .padding()
            .navigationTitle("Adjust Card Corners")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
        .interactiveDismissDisabled(isRetrying)
    }

    private var canvas: some View {
        GeometryReader { proxy in
            let imageSize = CGSize(width: request.image.width, height: request.image.height)
            let imageFrame = Self.aspectFitFrame(imageSize: imageSize, in: proxy.size)

            ZStack {
                Color.black
                Image(decorative: request.image, scale: 1)
                    .resizable()
                    .scaledToFit()

                quadPath(in: imageFrame)
                    .fill(color.opacity(0.14))
                quadPath(in: imageFrame)
                    .stroke(color, style: StrokeStyle(lineWidth: 3, lineJoin: .round))

                ForEach(Corner.allCases) { corner in
                    let point = screenPoint(point(for: corner), in: imageFrame)
                    ZStack {
                        Circle()
                            .fill(color.opacity(corner == selectedCorner ? 0.32 : 0.16))
                            .frame(width: 56, height: 56)
                        Circle()
                            .fill(color)
                            .frame(width: 28, height: 28)
                            .overlay(Circle().stroke(.white, lineWidth: 3))
                    }
                    .contentShape(Circle())
                    .position(point)
                    .gesture(
                        DragGesture(minimumDistance: 0)
                            .onChanged { value in
                                selectedCorner = corner
                                replace(corner, with: normalizedPoint(value.location, in: imageFrame))
                            }
                    )
                    .accessibilityLabel("\(corner.rawValue) card corner")
                    .accessibilityHint("Drag to the outside card corner")
                }
            }
        }
    }

    private var cornerSelector: some View {
        HStack(spacing: 8) {
            ForEach(Corner.allCases) { corner in
                Button(corner.rawValue) {
                    selectedCorner = corner
                }
                .buttonStyle(.bordered)
                .tint(corner == selectedCorner ? color : .secondary)
                .accessibilityLabel("Select \(corner.rawValue) corner")
            }
        }
    }

    private func quadPath(in frame: CGRect) -> Path {
        let points = quad.corners.map { screenPoint($0, in: frame) }
        var path = Path()
        guard let first = points.first else { return path }
        path.move(to: first)
        points.dropFirst().forEach { path.addLine(to: $0) }
        path.closeSubpath()
        return path
    }

    private func point(for corner: Corner) -> CGPoint {
        switch corner {
        case .topLeft: return quad.topLeft
        case .topRight: return quad.topRight
        case .bottomRight: return quad.bottomRight
        case .bottomLeft: return quad.bottomLeft
        }
    }

    private func replace(_ corner: Corner, with point: CGPoint) {
        switch corner {
        case .topLeft: quad.topLeft = point
        case .topRight: quad.topRight = point
        case .bottomRight: quad.bottomRight = point
        case .bottomLeft: quad.bottomLeft = point
        }
    }

    private func screenPoint(_ point: CGPoint, in frame: CGRect) -> CGPoint {
        CGPoint(x: frame.minX + point.x * frame.width, y: frame.minY + point.y * frame.height)
    }

    private func normalizedPoint(_ point: CGPoint, in frame: CGRect) -> CGPoint {
        guard frame.width > 0, frame.height > 0 else { return .zero }
        return CGPoint(
            x: min(0.995, max(0.005, (point.x - frame.minX) / frame.width)),
            y: min(0.995, max(0.005, (point.y - frame.minY) / frame.height))
        )
    }

    private static func aspectFitFrame(imageSize: CGSize, in available: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0,
              available.width > 0, available.height > 0
        else { return CGRect(origin: .zero, size: available) }
        let scale = min(available.width / imageSize.width, available.height / imageSize.height)
        let fitted = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: (available.width - fitted.width) / 2,
            y: (available.height - fitted.height) / 2,
            width: fitted.width,
            height: fitted.height
        )
    }
}

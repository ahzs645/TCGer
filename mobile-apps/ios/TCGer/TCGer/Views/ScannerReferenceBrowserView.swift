import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Steps through a reference folder one image at a time, running the production
/// coordinator on each and comparing the result against the frame's label.
///
/// The aggregate replay report answers "did anything change"; this answers "why
/// did *this* frame fail", which is what threshold and crop decisions need.
struct ScannerReferenceBrowserView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @StateObject private var model = ScannerReferenceBrowserModel()

    var body: some View {
        Group {
            if let set = model.selectedSet {
                browser(for: set)
            } else {
                setPicker
            }
        }
        .navigationTitle(model.selectedSet?.name ?? "Reference Sets")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.selectedSet != nil {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sets") { model.selectSet(nil) }
                }
            }
        }
        .onAppear { model.configure(environment: environmentStore) }
    }

    // MARK: Set picker

    private var setPicker: some View {
        List {
            if model.sets.isEmpty {
                Section {
                    Text(model.discoveryMessage)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(model.sets) { set in
                Button {
                    model.selectSet(set)
                } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(set.name)
                            .font(.callout.weight(.semibold))
                            .foregroundStyle(.primary)
                        Text("\(set.kind.rawValue) · \(set.items.count) images · \(set.labeledCount) labeled")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section {
                Button("Rescan Folders", systemImage: "arrow.clockwise") { model.discover() }
                Button("Choose Folder…", systemImage: "folder") { model.showingImporter = true }
            } footer: {
                Text(ScannerReferenceBrowserModel.rootsFooter)
            }
        }
        .fileImporter(
            isPresented: $model.showingImporter,
            allowedContentTypes: [.folder],
            allowsMultipleSelection: false
        ) { result in
            if case .success(let urls) = result, let url = urls.first {
                model.discover(in: url)
            }
        }
    }

    // MARK: Browser

    private func browser(for set: ScannerReferenceSet) -> some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(spacing: 14) {
                    imagePane
                    verdictPane
                    if model.isRunningAll || model.summary != nil {
                        summaryPane
                    }
                    candidatesPane
                }
                .padding(16)
            }
            navigationBar(for: set)
        }
    }

    private var imagePane: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12).fill(Color(.secondarySystemBackground))
            if let image = model.currentImage {
                GeometryReader { geo in
                    let frame = Self.aspectFitRect(
                        imageSize: CGSize(width: image.width, height: image.height),
                        in: geo.size
                    )
                    Image(decorative: image, scale: 1)
                        .resizable()
                        .frame(width: frame.width, height: frame.height)
                        .position(x: frame.midX, y: frame.midY)
                    // Ground truth in green, what the cropper chose in orange.
                    ForEach(Array(model.currentItem?.annotations.enumerated() ?? [].enumerated()), id: \.offset) { _, box in
                        Self.boxPath(box, in: frame)
                            .stroke(Color.green, lineWidth: 2)
                    }
                    if let detected = model.detectedQuad {
                        Self.quadPath(detected, in: frame)
                            .stroke(Color.orange, lineWidth: 2)
                    }
                }
            } else {
                ProgressView()
            }
        }
        .frame(height: 320)
    }

    private var verdictPane: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let item = model.currentItem {
                HStack {
                    Text(item.name)
                        .font(.caption.monospaced())
                        .lineLimit(2)
                        .foregroundStyle(.secondary)
                    Spacer()
                    if let verdict = model.currentVerdict {
                        Text(verdict.rawValue)
                            .font(.caption.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 3)
                            .background(Self.color(for: verdict).opacity(0.18), in: Capsule())
                            .foregroundStyle(Self.color(for: verdict))
                    }
                }

                LabeledRow(label: "Expected", value: item.expectation.label)
                if let baseline = item.baselineCardID {
                    LabeledRow(
                        label: "Recorded",
                        value: item.baselineConfidence.map {
                            String(format: "%@ · %.2f", baseline, $0)
                        } ?? baseline
                    )
                }
                LabeledRow(
                    label: "Scanned",
                    value: model.currentResultSummary ?? (model.isScanning ? "Scanning…" : "Not scanned")
                )
                if let notes = item.notes {
                    Text(notes).font(.caption).foregroundStyle(.secondary)
                }
            }

            if let cropped = model.croppedImage {
                HStack(alignment: .top, spacing: 10) {
                    Image(decorative: cropped, scale: 1)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 72, height: 100)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                    Text("Crop sent to the encoder. A crop that is not the whole card face is a localization failure, not a recognition one.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var candidatesPane: some View {
        VStack(alignment: .leading, spacing: 6) {
            if !model.currentCandidates.isEmpty {
                Text("Top candidates").font(.caption.weight(.semibold))
                ForEach(Array(model.currentCandidates.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }

    private var summaryPane: some View {
        VStack(alignment: .leading, spacing: 8) {
            if model.isRunningAll {
                ProgressView(value: model.runProgress) {
                    Text("Running set… \(model.completedCount)/\(model.totalToRun)")
                        .font(.caption)
                }
            }
            if let summary = model.summary {
                Text(summary)
                    .font(.caption.monospacedDigit())
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !model.failures.isEmpty {
                Toggle("Failures only (\(model.failures.count))", isOn: $model.failuresOnly)
                    .font(.caption)
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 10))
    }

    private func navigationBar(for set: ScannerReferenceSet) -> some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Button {
                    model.step(-1)
                } label: {
                    Image(systemName: "chevron.left").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)

                Text("\(model.position + 1) / \(model.visibleItems.count)")
                    .font(.caption.monospacedDigit())
                    .frame(minWidth: 72)

                Button {
                    model.step(1)
                } label: {
                    Image(systemName: "chevron.right").frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }

            HStack(spacing: 12) {
                Button {
                    Task { await model.scanCurrent() }
                } label: {
                    Label("Scan", systemImage: "viewfinder").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isScanning || model.isRunningAll)

                Button {
                    if model.isRunningAll {
                        model.cancelRun()
                    } else {
                        Task { await model.runAll() }
                    }
                } label: {
                    Label(
                        model.isRunningAll ? "Stop" : "Run All (\(set.items.count))",
                        systemImage: model.isRunningAll ? "stop.fill" : "play.fill"
                    )
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(model.isScanning && !model.isRunningAll)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.bar)
    }

    // MARK: Geometry helpers

    /// Vision reports normalized coordinates from the bottom-left; SwiftUI draws
    /// from the top-left, and the image is letterboxed inside its pane.
    private static func aspectFitRect(imageSize: CGSize, in bounds: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return .zero }
        let scale = min(bounds.width / imageSize.width, bounds.height / imageSize.height)
        let size = CGSize(width: imageSize.width * scale, height: imageSize.height * scale)
        return CGRect(
            x: (bounds.width - size.width) / 2,
            y: (bounds.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }

    private static func point(_ normalized: CGPoint, in frame: CGRect) -> CGPoint {
        CGPoint(
            x: frame.minX + normalized.x * frame.width,
            y: frame.minY + (1 - normalized.y) * frame.height
        )
    }

    private static func boxPath(_ box: CGRect, in frame: CGRect) -> Path {
        quadPath(
            [
                CGPoint(x: box.minX, y: box.maxY),
                CGPoint(x: box.maxX, y: box.maxY),
                CGPoint(x: box.maxX, y: box.minY),
                CGPoint(x: box.minX, y: box.minY)
            ],
            in: frame
        )
    }

    private static func quadPath(_ corners: [CGPoint], in frame: CGRect) -> Path {
        var path = Path()
        let points = corners.map { point($0, in: frame) }
        guard let first = points.first else { return path }
        path.move(to: first)
        for next in points.dropFirst() { path.addLine(to: next) }
        path.closeSubpath()
        return path
    }

    private static func color(for verdict: ScannerReferenceVerdict) -> Color {
        switch verdict {
        case .correct, .declined: return .green
        case .wrongPrinting, .wrongCard, .falsePositive: return .red
        case .missed: return .orange
        case .matched, .noMatch: return .secondary
        }
    }
}

private struct LabeledRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 72, alignment: .leading)
            Text(value)
                .font(.caption.monospaced())
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }
}

import SwiftUI

struct RecentDebugCapturesSheet: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore

    @State private var captures: [APIService.ScanDebugCaptureResponse] = []
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var selectedCapture: APIService.ScanDebugCaptureResponse?

    let color: Color

    var body: some View {
        NavigationView {
            Group {
                if let token = environmentStore.authToken {
                    content(token: token)
                } else {
                    ContentUnavailableView(
                        "Login Required",
                        systemImage: "person.crop.circle.badge.exclamationmark",
                        description: Text("Sign in before browsing saved debug captures.")
                    )
                }
            }
            .navigationTitle("Recent Debug Captures")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await reload() }
                    } label: {
                        if isLoading {
                            ProgressView()
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .disabled(isLoading || environmentStore.authToken == nil)
                }
            }
        }
        .task(id: environmentStore.authToken) {
            await reload()
        }
        .sheet(item: $selectedCapture) { capture in
            DebugCaptureDetailSheet(capture: capture, color: color) { updatedCapture in
                replaceCapture(updatedCapture)
            }
            .environmentObject(environmentStore)
        }
    }

    @ViewBuilder
    private func content(token _: String) -> some View {
        if isLoading && captures.isEmpty {
            VStack(spacing: 12) {
                ProgressView()
                Text("Loading recent captures...")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
        } else if let errorMessage {
            ContentUnavailableView(
                "Unable to Load Captures",
                systemImage: "exclamationmark.triangle",
                description: Text(errorMessage)
            )
        } else if captures.isEmpty {
            ContentUnavailableView(
                "No Saved Captures",
                systemImage: "tray",
                description: Text("Run a scan with Save Debug Capture enabled to populate this list.")
            )
        } else {
            ScrollView {
                LazyVStack(spacing: 12) {
                    ForEach(captures) { capture in
                        Button {
                            selectedCapture = capture
                        } label: {
                            DebugCaptureRow(capture: capture, color: color)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding()
            }
            .refreshable {
                await reload()
            }
        }
    }

    @MainActor
    private func reload() async {
        guard let token = environmentStore.authToken else {
            captures = []
            errorMessage = nil
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            captures = try await APIService().listScanDebugCaptures(
                config: environmentStore.serverConfiguration,
                token: token,
                limit: 20
            )
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func replaceCapture(_ capture: APIService.ScanDebugCaptureResponse) {
        guard let index = captures.firstIndex(where: { $0.id == capture.id }) else {
            captures.insert(capture, at: 0)
            return
        }
        captures[index] = capture
    }
}

private struct DebugCaptureRow: View {
    let capture: APIService.ScanDebugCaptureResponse
    let color: Color

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            CachedAsyncImage(url: previewURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                case .failure:
                    Color.red.opacity(0.08)
                        .overlay(Image(systemName: "exclamationmark.triangle").foregroundColor(.red))
                default:
                    Color.gray.opacity(0.12)
                        .overlay(ProgressView())
                }
            }
            .frame(width: 84, height: 116)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(Color.gray.opacity(0.18), lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(capture.bestMatch?.name ?? "No Match")
                            .font(.headline)
                            .foregroundColor(.primary)
                            .multilineTextAlignment(.leading)
                        Text(matchSubtitle)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }

                    Spacer()

                    statusBadge
                }

                HStack(spacing: 10) {
                    if let score = capture.bestMatch?.confidence {
                        Text("\(Int(round(score * 100)))%")
                    }
                    if let distance = capture.bestMatch?.distance {
                        Text("d \(Int(round(distance)))")
                    }
                    Text(formattedTimestamp(capture.createdAt))
                }
                .font(.caption)
                .foregroundColor(.secondary)

                if !capture.reviewTags.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(capture.reviewTags) { tag in
                                Text(tag.displayLabel)
                                    .font(.caption2.weight(.medium))
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 5)
                                    .background(color.opacity(0.12))
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var previewURL: URL? {
        let candidates: [String?] = [
            capture.artifactImages.correctedImageUrl,
            capture.artifactImages.artworkImageUrl,
            capture.sourceImageUrl
        ]
        for candidate in candidates {
            guard let candidate, !candidate.isEmpty else { continue }
            if let url = URL(string: candidate) {
                return url
            }
        }
        return nil
    }

    private var matchSubtitle: String {
        let tcg = capture.bestMatch?.tcg?.capitalized ?? capture.requestedTcg?.capitalized ?? "Unknown"
        let externalId = capture.bestMatch?.externalId ?? "No ID"
        return "\(tcg) • \(externalId)"
    }

    @ViewBuilder
    private var statusBadge: some View {
        Text(capture.feedbackStatus.displayLabel)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(statusColor.opacity(0.14))
            .foregroundColor(statusColor)
            .clipShape(Capsule())
    }

    private var statusColor: Color {
        switch capture.feedbackStatus {
        case .correct:
            return .green
        case .incorrect:
            return .red
        case .needsReview:
            return .orange
        case .unreviewed:
            return .secondary
        }
    }

    private func formattedTimestamp(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return value
    }
}

private struct DebugCaptureDetailSheet: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss

    @State private var capture: APIService.ScanDebugCaptureResponse
    @State private var isUpdating = false
    @State private var errorMessage: String?

    let color: Color
    let onUpdated: (APIService.ScanDebugCaptureResponse) -> Void

    init(
        capture: APIService.ScanDebugCaptureResponse,
        color: Color,
        onUpdated: @escaping (APIService.ScanDebugCaptureResponse) -> Void
    ) {
        _capture = State(initialValue: capture)
        self.color = color
        self.onUpdated = onUpdated
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    heroSection
                    metadataSection
                    reviewSection
                    if hasArtifactImages {
                        DisclosureGroup("Artifact Crops") {
                            artifactStrip
                                .padding(.top, 8)
                        }
                    }
                    if let timings = capture.diagnostics?.timings {
                        metricsSection(title: "Timings", rows: timingRows(for: timings))
                    }
                    if let geometry = capture.diagnostics?.geometry {
                        metricsSection(title: "Geometry", rows: geometryRows(for: geometry))
                    }
                    if let pipeline = capture.pipeline {
                        metricsSection(title: "Pipeline", rows: pipelineRows(for: pipeline))
                    }
                }
                .padding()
            }
            .navigationTitle(capture.bestMatch?.name ?? "Debug Capture")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isUpdating {
                        ProgressView()
                    }
                }
            }
        }
    }

    private var heroSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            CachedAsyncImage(url: primaryPreviewURL) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                case .failure:
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.red.opacity(0.08))
                        .overlay(Image(systemName: "exclamationmark.triangle").foregroundColor(.red))
                default:
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color.gray.opacity(0.12))
                        .overlay(ProgressView())
                }
            }
            .frame(maxWidth: .infinity, minHeight: 220)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .stroke(color.opacity(0.2), lineWidth: 1)
            )

            HStack {
                Text(capture.feedbackStatus.displayLabel)
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(statusColor.opacity(0.14))
                    .foregroundColor(statusColor)
                    .clipShape(Capsule())

                Spacer()

                if let score = capture.bestMatch?.confidence {
                    Text("\(Int(round(score * 100)))%")
                        .font(.headline)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundColor(.red)
            }
        }
    }

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Metadata")
                .font(.headline)
            DebugMetricRow(label: "Capture ID", value: capture.id)
            if let name = capture.bestMatch?.name {
                DebugMetricRow(label: "Best Match", value: name)
            }
            if let externalId = capture.bestMatch?.externalId {
                DebugMetricRow(label: "Card ID", value: externalId)
            }
            if let distance = capture.bestMatch?.distance {
                DebugMetricRow(label: "Distance", value: String(Int(round(distance))))
            }
            if let source = capture.captureSource {
                DebugMetricRow(label: "Source", value: source)
            }
            DebugMetricRow(label: "Created", value: formattedTimestamp(capture.createdAt))
            if let notes = capture.notes, !notes.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Notes")
                        .font(.footnote)
                        .foregroundColor(.secondary)
                    Text(notes)
                        .font(.subheadline)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var reviewSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Review")
                .font(.headline)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach([CardScanDebugFeedbackStatus.correct, .incorrect, .needsReview, .unreviewed], id: \.rawValue) { status in
                    Button {
                        Task { await updateCapture(feedbackStatus: status, reviewTags: nil) }
                    } label: {
                        Text(status.displayLabel)
                            .font(.footnote.weight(.medium))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(capture.feedbackStatus == status ? statusColor(for: status).opacity(0.18) : Color(.tertiarySystemBackground))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(capture.feedbackStatus == status ? statusColor(for: status) : Color.gray.opacity(0.2), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(isUpdating)
                }
            }

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 130), spacing: 8)], spacing: 8) {
                ForEach(CardScanReviewTag.allCases) { tag in
                    let selected = capture.reviewTags.contains(tag)
                    Button {
                        var tags = capture.reviewTags
                        if selected {
                            tags.removeAll { $0 == tag }
                        } else {
                            tags.append(tag)
                        }
                        Task { await updateCapture(feedbackStatus: nil, reviewTags: tags) }
                    } label: {
                        Text(tag.displayLabel)
                            .font(.caption.weight(.medium))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 9)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(selected ? color.opacity(0.16) : Color(.tertiarySystemBackground))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 10)
                                    .stroke(selected ? color : Color.gray.opacity(0.2), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(isUpdating)
                }
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var artifactStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 12) {
                ForEach(artifactItems, id: \.title) { item in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(item.title)
                            .font(.caption.weight(.medium))
                        CachedAsyncImage(url: item.url) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                            case .failure:
                                Color.red.opacity(0.08)
                                    .overlay(Image(systemName: "exclamationmark.triangle").foregroundColor(.red))
                            default:
                                Color.gray.opacity(0.12)
                                    .overlay(ProgressView())
                            }
                        }
                        .frame(width: 140, height: 196)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func metricsSection(title: String, rows: [DebugMetric]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            ForEach(rows) { row in
                DebugMetricRow(label: row.label, value: row.value)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private var primaryPreviewURL: URL? {
        artifactItems.first?.url
    }

    private var artifactItems: [DebugArtifact] {
        [
            DebugArtifact(title: "Original", url: URL(string: capture.sourceImageUrl)),
            DebugArtifact(title: "Corrected", url: makeURL(capture.artifactImages.correctedImageUrl)),
            DebugArtifact(title: "Artwork", url: makeURL(capture.artifactImages.artworkImageUrl)),
            DebugArtifact(title: "Title", url: makeURL(capture.artifactImages.titleImageUrl)),
            DebugArtifact(title: "Footer", url: makeURL(capture.artifactImages.footerImageUrl))
        ]
        .filter { $0.url != nil }
    }

    private var hasArtifactImages: Bool {
        !artifactItems.isEmpty
    }

    private var statusColor: Color {
        statusColor(for: capture.feedbackStatus)
    }

    private func updateCapture(
        feedbackStatus: CardScanDebugFeedbackStatus?,
        reviewTags: [CardScanReviewTag]?
    ) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "You need to be logged in to update captures."
            return
        }

        isUpdating = true
        defer { isUpdating = false }

        do {
            let updated = try await APIService().updateScanDebugCapture(
                config: environmentStore.serverConfiguration,
                token: token,
                captureId: capture.id,
                feedbackStatus: feedbackStatus,
                reviewTags: reviewTags
            )
            capture = updated
            onUpdated(updated)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func statusColor(for status: CardScanDebugFeedbackStatus) -> Color {
        switch status {
        case .correct:
            return .green
        case .incorrect:
            return .red
        case .needsReview:
            return .orange
        case .unreviewed:
            return .secondary
        }
    }

    private func timingRows(for timings: APIService.ScanTimingMetricsResponse) -> [DebugMetric] {
        let entries: [(String, Double?)] = [
            ("Preprocess", timings.preprocessMs),
            ("Perspective", timings.perspectiveCorrectionMs),
            ("Quality", timings.qualityMs),
            ("Hash", timings.hashMs),
            ("Feature Hash", timings.featureHashMs),
            ("Ranking", timings.rankingMs),
            ("Artwork Prefilter", timings.artworkPrefilterMs),
            ("Artwork Rerank", timings.artworkRerankMs),
            ("OCR", timings.ocrMs),
            ("Total", timings.totalMs)
        ]

        return entries.compactMap { entry in
            guard let value = formatDuration(entry.1) else { return nil }
            return DebugMetric(label: entry.0, value: value)
        }
    }

    private func geometryRows(for geometry: APIService.ScanGeometryResponse) -> [DebugMetric] {
        var rows: [DebugMetric] = []
        if let corrected = geometry.perspectiveCorrected {
            rows.append(DebugMetric(label: "Perspective", value: corrected ? "Corrected" : "Raw"))
        }
        if let contourAreaRatio = geometry.contourAreaRatio {
            rows.append(DebugMetric(label: "Contour Area", value: String(format: "%.3f", contourAreaRatio)))
        }
        if let contourConfidence = geometry.contourConfidence {
            rows.append(DebugMetric(label: "Contour Confidence", value: String(format: "%.3f", contourConfidence)))
        }
        if let rotationAngle = geometry.rotationAngle {
            rows.append(DebugMetric(label: "Rotation", value: String(format: "%.1f°", rotationAngle)))
        }
        if let cropAspectRatio = geometry.cropAspectRatio {
            rows.append(DebugMetric(label: "Crop Aspect", value: String(format: "%.3f", cropAspectRatio)))
        }
        if let cropWidth = geometry.cropWidth, let cropHeight = geometry.cropHeight {
            rows.append(DebugMetric(label: "Crop Size", value: "\(Int(cropWidth))×\(Int(cropHeight))"))
        }
        if let cropCandidateScore = geometry.cropCandidateScore {
            rows.append(DebugMetric(label: "Crop Score", value: String(format: "%.3f", cropCandidateScore)))
        }
        if let maskVariant = geometry.maskVariant, !maskVariant.isEmpty {
            rows.append(DebugMetric(label: "Mask", value: maskVariant))
        }
        return rows
    }

    private func pipelineRows(for pipeline: APIService.ScanPipelineSnapshotResponse) -> [DebugMetric] {
        var rows: [DebugMetric] = [
            DebugMetric(label: "Git SHA", value: shortIdentifier(pipeline.build.gitSha)),
            DebugMetric(label: "pHash", value: pipeline.matcher.phashVersion),
            DebugMetric(label: "Artwork", value: pipeline.matcher.artworkVersion),
            DebugMetric(label: "Feature Hash", value: pipeline.matcher.featureHashVersion),
            DebugMetric(label: "Hash DB", value: formatRevision(pipeline.hashDatabase.dataset)),
            DebugMetric(label: "Artwork DB", value: formatRevision(pipeline.artworkDatabase.dataset))
        ]
        if let imageTag = pipeline.build.imageTag, !imageTag.isEmpty {
            rows.insert(DebugMetric(label: "Image", value: imageTag), at: 1)
        }
        if let backendMode = pipeline.build.backendMode, !backendMode.isEmpty {
            rows.insert(DebugMetric(label: "Backend", value: backendMode), at: 2)
        }
        return rows
    }

    private func makeURL(_ value: String?) -> URL? {
        guard let value, !value.isEmpty else { return nil }
        return URL(string: value)
    }

    private func formattedTimestamp(_ value: String) -> String {
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: value) {
            return date.formatted(date: .abbreviated, time: .shortened)
        }
        return value
    }

    private func shortIdentifier(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "unknown" }
        if value.count <= 12 {
            return value
        }
        return String(value.prefix(7))
    }

    private func formatRevision(_ revision: APIService.ScanDatasetRevisionResponse?) -> String {
        guard let revision else { return "unknown" }
        if let total = revision.total {
            return "\(revision.revision) · \(total) entries"
        }
        return revision.revision
    }

    private func formatDuration(_ milliseconds: Double?) -> String? {
        guard let milliseconds, milliseconds.isFinite else { return nil }
        if milliseconds >= 1000 {
            return String(format: "%.2fs", milliseconds / 1000)
        }
        return String(format: "%.0fms", milliseconds)
    }
}

private struct DebugArtifact {
    let title: String
    let url: URL?
}

private struct DebugMetric: Identifiable {
    let id = UUID()
    let label: String
    let value: String
}

private struct DebugMetricRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.footnote)
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.system(.footnote, design: .monospaced))
                .multilineTextAlignment(.trailing)
        }
    }
}

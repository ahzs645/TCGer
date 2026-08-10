import SwiftUI
import UIKit

struct BinderPagesView: View {
    private struct RescanTarget: Identifiable {
        let pageNumber: Int
        var id: Int { pageNumber }
    }

    let collection: Collection
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @Environment(\.dismiss) private var dismiss
    @State private var pages: [SavedBinderPage] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var rescanTarget: RescanTarget?
    @State private var removingImagePageNumber: Int?

    private let apiService = APIService()

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView("Loading binder pages…")
                } else if pages.isEmpty {
                    ContentUnavailableView(
                        "No Saved Pages",
                        systemImage: "rectangle.stack.badge.plus",
                        description: Text("Use Binder mode in the scanner, then save a page layout to build this reference.")
                    )
                } else {
                    ScrollView {
                        LazyVStack(spacing: 16) {
                            ForEach(pages) { page in
                                pageCard(page)
                            }
                        }
                        .padding()
                    }
                    .refreshable { await loadPages() }
                }
            }
            .navigationTitle("\(collection.name) Pages")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .task { await loadPages() }
        .fullScreenCover(item: $rescanTarget, onDismiss: {
            Task { await loadPages() }
        }) { target in
            CardScannerView(
                startingBinderID: collection.id,
                startingBinderPageNumber: target.pageNumber
            )
            .environmentObject(environmentStore)
        }
        .alert(
            "Binder Pages Error",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "An unknown error occurred.")
        }
    }

    private func pageCard(_ page: SavedBinderPage) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Page \(page.pageNumber)")
                        .font(.title3.weight(.semibold))
                    Text("Revision \(page.revision) · \(page.placements.count) cards")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Rescan") {
                    rescanTarget = RescanTarget(pageNumber: page.pageNumber)
                }
                .buttonStyle(.bordered)
            }

            BinderPageSnapshot(
                imageURL: resolvedImageURL(page.imageUrl),
                placements: page.placements
            )

            if page.placements.isEmpty {
                Text("No included cards were stored for this page.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(page.placements) { placement in
                    HStack {
                        Text("\(placement.slotIndex + 1)")
                            .font(.caption.monospacedDigit().weight(.bold))
                            .frame(width: 24, height: 24)
                            .background(Color.accentColor.opacity(0.14), in: Circle())
                        VStack(alignment: .leading, spacing: 2) {
                            Text(placement.name).font(.subheadline.weight(.medium))
                            Text([placement.setCode, placement.status.capitalized].compactMap { $0 }.joined(separator: " · "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                    }
                }
            }

            if page.imageUrl != nil {
                Button(role: .destructive) {
                    Task { await removeImage(from: page) }
                } label: {
                    if removingImagePageNumber == page.pageNumber {
                        ProgressView()
                    } else {
                        Label("Remove saved page photo", systemImage: "photo.badge.minus")
                    }
                }
                .font(.footnote)
                .disabled(removingImagePageNumber != nil)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 16))
    }

    private func resolvedImageURL(_ value: String?) -> URL? {
        guard let value else { return nil }
        if let url = URL(string: value), url.scheme != nil { return url }
        guard var components = environmentStore.serverConfiguration.normalizedURL.flatMap({
            URLComponents(url: $0, resolvingAgainstBaseURL: false)
        }) else { return nil }
        components.path = value.hasPrefix("/") ? value : "/\(value)"
        components.query = nil
        return components.url
    }

    @MainActor
    private func loadPages() async {
        isLoading = true
        defer { isLoading = false }
        do {
            pages = try await apiService.getBinderPages(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken,
                binderId: collection.id
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func removeImage(from page: SavedBinderPage) async {
        removingImagePageNumber = page.pageNumber
        defer { removingImagePageNumber = nil }
        do {
            try await apiService.removeBinderPageImage(
                config: environmentStore.serverConfiguration,
                token: environmentStore.authToken,
                binderId: collection.id,
                pageNumber: page.pageNumber
            )
            await loadPages()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct BinderPageSnapshot: View {
    let imageURL: URL?
    let placements: [BinderPagePlacement]

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                snapshotImage
                ForEach(placements) { placement in
                    let rect = placementRect(placement, size: geometry.size)
                    RoundedRectangle(cornerRadius: 4)
                        .stroke(placement.status == "matched" ? Color.green : Color.orange, lineWidth: 2)
                        .frame(width: rect.width, height: rect.height)
                        .position(x: rect.midX, y: rect.midY)
                    Text("\(placement.slotIndex + 1)")
                        .font(.caption2.bold())
                        .foregroundStyle(.white)
                        .frame(width: 20, height: 20)
                        .background(Color.accentColor, in: Circle())
                        .position(x: rect.minX + 10, y: rect.minY + 10)
                }
            }
            .clipped()
        }
        .aspectRatio(0.75, contentMode: .fit)
        .background(Color.black.opacity(0.88), in: RoundedRectangle(cornerRadius: 12))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    @ViewBuilder
    private var snapshotImage: some View {
        if let imageURL, imageURL.isFileURL,
           let image = UIImage(contentsOfFile: imageURL.path) {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
        } else if let imageURL {
            AsyncImage(url: imageURL) { phase in
                if let image = phase.image {
                    image.resizable().scaledToFit()
                } else if phase.error != nil {
                    placeholder
                } else {
                    ProgressView().tint(.white)
                }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        VStack(spacing: 8) {
            Image(systemName: "photo.slash")
            Text("Page photo not stored")
                .font(.caption)
        }
        .foregroundStyle(.white.opacity(0.72))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func placementRect(_ placement: BinderPagePlacement, size: CGSize) -> CGRect {
        let points = [
            placement.quad.topLeft,
            placement.quad.topRight,
            placement.quad.bottomRight,
            placement.quad.bottomLeft
        ].map { CGPoint(x: $0.x * size.width, y: (1 - $0.y) * size.height) }
        let xs = points.map(\.x)
        let ys = points.map(\.y)
        return CGRect(
            x: xs.min() ?? 0,
            y: ys.min() ?? 0,
            width: (xs.max() ?? 0) - (xs.min() ?? 0),
            height: (ys.max() ?? 0) - (ys.min() ?? 0)
        )
    }
}

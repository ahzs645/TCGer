import SwiftUI
import PhotosUI

struct ImageUploadSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let binderId: String
    let collectionId: String
    let existingImageUrls: [String]
    let onImagesChanged: () -> Void

    @State private var selectedItems: [PhotosPickerItem] = []
    @State private var isUploading = false
    @State private var uploadProgress: String?
    @State private var errorMessage: String?
    @State private var deletingIndex: Int?

    private let apiService = APIService()

    var body: some View {
        NavigationView {
            List {
                // Existing Images
                if !existingImageUrls.isEmpty {
                    Section {
                        ForEach(Array(existingImageUrls.enumerated()), id: \.offset) { index, urlString in
                            HStack {
                                if let url = imageURL(urlString) {
                                    CachedAsyncImage(url: url) { phase in
                                        switch phase {
                                        case .success(let image):
                                            image
                                                .resizable()
                                                .aspectRatio(contentMode: .fill)
                                        case .empty, .failure:
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
                                    .frame(width: 60, height: 60)
                                    .cornerRadius(8)
                                }

                                Text("Image \(index + 1)")
                                    .font(.subheadline)

                                Spacer()

                                if deletingIndex == index {
                                    ProgressView()
                                        .scaleEffect(0.8)
                                } else {
                                    Button(role: .destructive) {
                                        Task { await deleteImage(at: index) }
                                    } label: {
                                        Image(systemName: "trash")
                                            .foregroundColor(.red)
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    } header: {
                        Text("Existing Photos (\(existingImageUrls.count))")
                    }
                }

                // Upload Section
                Section {
                    PhotosPicker(
                        selection: $selectedItems,
                        maxSelectionCount: 5,
                        matching: .images
                    ) {
                        HStack {
                            Image(systemName: "photo.on.rectangle.angled")
                                .foregroundColor(.accentColor)
                            Text("Select Photos")
                            Spacer()
                            if isUploading {
                                ProgressView()
                                    .scaleEffect(0.8)
                            }
                        }
                    }
                    .disabled(isUploading)
                    .onChange(of: selectedItems) { _, newItems in
                        Task { await uploadSelectedItems(newItems) }
                    }

                    if let progress = uploadProgress {
                        Text(progress)
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                } header: {
                    Text("Add Photos")
                } footer: {
                    Text("Select up to 5 photos at a time. Supported formats: JPEG, PNG, WebP. Max 10MB per image.")
                }

                if let error = errorMessage {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("Card Photos")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func imageURL(_ urlString: String) -> URL? {
        if urlString.hasPrefix("http") {
            return URL(string: urlString)
        }
        let baseURL = environmentStore.serverConfiguration.baseURL
        return URL(string: "\(baseURL)/\(urlString)")
    }

    @MainActor
    private func uploadSelectedItems(_ items: [PhotosPickerItem]) async {
        guard !items.isEmpty else { return }
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        isUploading = true
        errorMessage = nil

        for (index, item) in items.enumerated() {
            uploadProgress = "Uploading \(index + 1) of \(items.count)..."

            do {
                guard let data = try await item.loadTransferable(type: Data.self) else {
                    continue
                }

                let filename = "photo_\(index).jpg"
                _ = try await apiService.uploadImage(
                    config: environmentStore.serverConfiguration,
                    token: token,
                    binderId: binderId,
                    collectionId: collectionId,
                    imageData: data,
                    filename: filename
                )
            } catch {
                errorMessage = "Failed to upload image \(index + 1): \(error.localizedDescription)"
            }
        }

        selectedItems = []
        uploadProgress = nil
        isUploading = false
        onImagesChanged()
    }

    @MainActor
    private func deleteImage(at index: Int) async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Not authenticated"
            return
        }

        deletingIndex = index
        errorMessage = nil

        do {
            try await apiService.deleteImage(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: binderId,
                collectionId: collectionId,
                imageIndex: index
            )
            onImagesChanged()
        } catch {
            errorMessage = "Failed to delete image: \(error.localizedDescription)"
        }

        deletingIndex = nil
    }
}

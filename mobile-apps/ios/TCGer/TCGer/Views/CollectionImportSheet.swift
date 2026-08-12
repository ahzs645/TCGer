import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct CollectionImportSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let collections: [Collection]
    let onImported: () async -> Void

    @State private var sourceContent = ""
    @State private var filename = ""
    @State private var format: APIService.CollectionImportSourceFormat = .auto
    @State private var resolutionsText = "{}"
    @State private var selectedBinderId: String?
    @State private var createMissingBinders = false
    @State private var preview: APIService.CollectionImportPreview?
    @State private var showingFileImporter = false
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var successMessage: String?
    @State private var templateShare: ImportTemplateShare?

    private let apiService = APIService()

    private var options: APIService.CollectionImportOptions {
        APIService.CollectionImportOptions(
            defaultBinderId: selectedBinderId,
            createMissingBinders: createMissingBinders
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button {
                        showingFileImporter = true
                    } label: {
                        Label(
                            filename.isEmpty ? "Choose file" : filename,
                            systemImage: "doc.badge.plus"
                        )
                    }
                    if !sourceContent.isEmpty {
                        Text("\(sourceContent.utf8.count.formatted()) bytes loaded")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    Picker("Source format", selection: $format) {
                        ForEach(APIService.CollectionImportSourceFormat.allCases) { format in
                            Text(format.label).tag(format)
                        }
                    }
                    .onChange(of: format) { _, _ in
                        preview = nil
                        successMessage = nil
                    }

                    Button {
                        Task { await downloadTemplate() }
                    } label: {
                        Label("Download CSV template", systemImage: "arrow.down.doc")
                    }
                    .disabled(isWorking)
                } header: {
                    Text("Import source")
                } footer: {
                    if environmentStore.serverConfiguration.isOnDevice {
                        Text("On-device mode supports CSV. Connect to a server for JSON, Cardmarket text, and exact-print resolution.")
                    } else {
                        Text("Supports TCGer CSV, JSON, and Cardmarket Yu-Gi-Oh singles text. Auto-detect uses the file name and content.")
                    }
                }

                Section("Import destination") {
                    Picker("Default binder", selection: $selectedBinderId) {
                        Text("Library").tag(String?.some(Collection.unsortedBinderId))
                        ForEach(collections.filter { !$0.isUnsortedBinder }) { collection in
                            Text(collection.name).tag(String?.some(collection.id))
                        }
                    }
                    Toggle("Create missing named binders", isOn: $createMissingBinders)
                }

                Section {
                    Button {
                        Task { await runPreview() }
                    } label: {
                        if isWorking {
                            ProgressView()
                                .frame(maxWidth: .infinity)
                        } else {
                            Text("Validate and preview")
                                .frame(maxWidth: .infinity)
                        }
                    }
                    .disabled(sourceContent.isEmpty || isWorking)
                }

                if let preview {
                    Section("Summary") {
                        LabeledContent("Source rows", value: preview.sourceRows.formatted())
                        LabeledContent("Merged rows", value: preview.rows.count.formatted())
                        LabeledContent("Copies", value: preview.totalCopies.formatted())
                    }

                    if !preview.issues.isEmpty {
                        Section("Fix before importing") {
                            ForEach(preview.issues) { issue in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(
                                        "Row \(issue.row)"
                                            + (issue.field.map { " · \($0)" } ?? "")
                                    )
                                    .font(.caption)
                                    .fontWeight(.semibold)
                                    Text(issue.message)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }

                    if let ambiguities = preview.ambiguities, !ambiguities.isEmpty {
                        Section("Exact printing required") {
                            ForEach(ambiguities) { ambiguity in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("Row \(ambiguity.sourceRow): \(ambiguity.query.name)")
                                        .font(.subheadline.weight(.semibold))
                                    Text([
                                        ambiguity.query.collectorNumber,
                                        ambiguity.query.setCode,
                                        ambiguity.query.rarity
                                    ].compactMap { $0 }.joined(separator: " · "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    Text(ambiguity.message)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Text("Resolution map (source row → exact card fields)")
                                .font(.caption.weight(.semibold))
                            TextEditor(text: $resolutionsText)
                                .font(.caption.monospaced())
                                .frame(minHeight: 110)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(.separator, lineWidth: 0.5)
                                }
                            Text("Example: {\"3\":{\"externalId\":\"exact-card-id\",\"setCode\":\"LOB\"}}")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }

                    if !preview.rows.isEmpty {
                        Section("Preview") {
                            ForEach(preview.rows.prefix(25)) { row in
                                HStack {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(row.cardName)
                                            .lineLimit(1)
                                        Text(
                                            "\(row.tcg.capitalized) · \(row.setCode ?? "No set")"
                                        )
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text("×\(row.quantity)")
                                        .font(.subheadline.monospacedDigit())
                                }
                            }
                            if preview.rows.count > 25 {
                                Text("\(preview.rows.count - 25) more rows")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    if preview.valid {
                        Section {
                            Button {
                                Task { await commitImport() }
                            } label: {
                                Text("Import \(preview.totalCopies) copies")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(isWorking)
                        }
                    }
                }

                if let successMessage {
                    Section {
                        Label(successMessage, systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }
            }
            .navigationTitle("Import Collection")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .fileImporter(
                isPresented: $showingFileImporter,
                allowedContentTypes: [.commaSeparatedText, .json, .plainText],
                allowsMultipleSelection: false
            ) { result in
                loadFile(result)
            }
            .alert(
                "Import Error",
                isPresented: Binding(
                    get: { errorMessage != nil },
                    set: { if !$0 { errorMessage = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .sheet(item: $templateShare) { share in
                ImportTemplateShareSheet(data: share.data, filename: share.filename)
            }
        }
    }

    private func loadFile(_ result: Result<[URL], Error>) {
        do {
            guard let url = try result.get().first else { return }
            let accessing = url.startAccessingSecurityScopedResource()
            defer {
                if accessing {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            let data = try Data(contentsOf: url)
            guard data.count <= 1_000_000 else {
                throw ImportFileError.tooLarge
            }
            guard let content = String(data: data, encoding: .utf8) else {
                throw ImportFileError.notUTF8
            }
            sourceContent = content
            filename = url.lastPathComponent
            preview = nil
            successMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func runPreview() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Sign in to import a collection."
            return
        }
        isWorking = true
        successMessage = nil
        do {
            let resolutions = try parseResolutions()
            preview = try await apiService.previewCollectionImport(
                config: environmentStore.serverConfiguration,
                token: token,
                content: sourceContent,
                format: format,
                fileName: filename.isEmpty ? nil : filename,
                resolutions: resolutions,
                options: options
            )
        } catch {
            errorMessage = error.localizedDescription
        }
        isWorking = false
    }

    @MainActor
    private func commitImport() async {
        guard let token = environmentStore.authToken else { return }
        isWorking = true
        do {
            let resolutions = try parseResolutions()
            let result = try await apiService.commitCollectionImport(
                config: environmentStore.serverConfiguration,
                token: token,
                content: sourceContent,
                format: format,
                fileName: filename.isEmpty ? nil : filename,
                resolutions: resolutions,
                options: options
            )
            if result.valid {
                successMessage = "Imported \(result.importedCopies) copies."
                await onImported()
            } else {
                preview = APIService.CollectionImportPreview(
                    valid: result.valid,
                    rows: result.rows,
                    issues: result.issues,
                    sourceRows: result.sourceRows,
                    totalCopies: result.totalCopies,
                    format: result.format,
                    failures: result.failures,
                    ambiguities: result.ambiguities
                )
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isWorking = false
    }

    private func parseResolutions() throws -> [String: APIService.CollectionImportResolution] {
        let trimmed = resolutionsText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [:] }
        guard let data = trimmed.data(using: .utf8) else { throw ImportFileError.invalidResolutions }
        do {
            return try JSONDecoder().decode(
                [String: APIService.CollectionImportResolution].self,
                from: data
            )
        } catch {
            throw ImportFileError.invalidResolutions
        }
    }

    @MainActor
    private func downloadTemplate() async {
        guard let token = environmentStore.authToken else {
            errorMessage = "Sign in to download the template."
            return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let data = try await apiService.collectionImportTemplate(
                config: environmentStore.serverConfiguration,
                token: token
            )
            templateShare = ImportTemplateShare(data: data, filename: "tcger-import-template.csv")
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum ImportFileError: LocalizedError {
    case tooLarge
    case notUTF8
    case invalidResolutions

    var errorDescription: String? {
        switch self {
        case .tooLarge:
            return "Import files are limited to 1 MB."
        case .notUTF8:
            return "The selected file must use UTF-8 text encoding."
        case .invalidResolutions:
            return "The resolution map must be a JSON object keyed by source row, with an externalId for every entry."
        }
    }
}

private struct ImportTemplateShare: Identifiable {
    let id = UUID()
    let data: Data
    let filename: String
}

private struct ImportTemplateShareSheet: UIViewControllerRepresentable {
    let data: Data
    let filename: String

    func makeUIViewController(context: Context) -> UIActivityViewController {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        try? data.write(to: url, options: .atomic)
        return UIActivityViewController(activityItems: [url], applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}

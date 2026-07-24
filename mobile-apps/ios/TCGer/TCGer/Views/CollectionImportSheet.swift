import SwiftUI
import UniformTypeIdentifiers

struct CollectionImportSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var environmentStore: EnvironmentStore

    let collections: [Collection]
    let onImported: () async -> Void

    @State private var csv = ""
    @State private var filename = ""
    @State private var selectedBinderId: String?
    @State private var createMissingBinders = false
    @State private var preview: APIService.CollectionImportPreview?
    @State private var showingFileImporter = false
    @State private var isWorking = false
    @State private var errorMessage: String?
    @State private var successMessage: String?

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
                Section("CSV file") {
                    Button {
                        showingFileImporter = true
                    } label: {
                        Label(
                            filename.isEmpty ? "Choose CSV file" : filename,
                            systemImage: "doc.badge.plus"
                        )
                    }
                    if !csv.isEmpty {
                        Text("\(csv.utf8.count.formatted()) bytes loaded")
                            .font(.caption)
                            .foregroundStyle(.secondary)
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
                    .disabled(csv.isEmpty || isWorking)
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
                allowedContentTypes: [.commaSeparatedText, .plainText],
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
            csv = content
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
            preview = try await apiService.previewCollectionImport(
                config: environmentStore.serverConfiguration,
                token: token,
                csv: csv,
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
            let result = try await apiService.commitCollectionImport(
                config: environmentStore.serverConfiguration,
                token: token,
                csv: csv,
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
                    totalCopies: result.totalCopies
                )
            }
        } catch {
            errorMessage = error.localizedDescription
        }
        isWorking = false
    }
}

private enum ImportFileError: LocalizedError {
    case tooLarge
    case notUTF8

    var errorDescription: String? {
        switch self {
        case .tooLarge:
            return "CSV files are limited to 1 MB."
        case .notUTF8:
            return "The selected CSV must use UTF-8 text encoding."
        }
    }
}

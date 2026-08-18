import SwiftUI
import Vision
import VisionKit

struct ManualOnlineCodeSheet: View {
    @Environment(\.dismiss) private var dismiss
    let games: [TCGGame]
    let onSave: (TCGGame, [String], String?, String?) async throws -> Void

    @State private var selectedGame: TCGGame
    @State private var input = ""
    @State private var productName = ""
    @State private var notes = ""
    @State private var isSaving = false
    @State private var errorMessage: String?

    private var codes: [String] { OnlineCodeParser.parse(input) }

    init(
        games: [TCGGame],
        defaultGame: TCGGame,
        onSave: @escaping (TCGGame, [String], String?, String?) async throws -> Void
    ) {
        self.games = games
        self.onSave = onSave
        _selectedGame = State(initialValue: defaultGame)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Game") {
                    Picker("Game", selection: $selectedGame) {
                        ForEach(games) { game in
                            Text(game.displayName).tag(game)
                        }
                    }
                }
                Section("Codes") {
                    TextEditor(text: $input)
                        .font(.body.monospaced())
                        .frame(minHeight: 180)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                    Text("\(codes.count) unique valid code\(codes.count == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Section("Details") {
                    TextField("Product or set (optional)", text: $productName)
                    TextField("Notes (optional)", text: $notes, axis: .vertical)
                        .lineLimit(2...5)
                }
            }
            .navigationTitle("Add Codes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") {
                        Task { await save() }
                    }
                    .disabled(codes.isEmpty || codes.count > 250 || isSaving)
                }
            }
            .alert("Couldn’t Save Codes", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await onSave(
                selectedGame,
                codes,
                productName.nonemptyOnlineCodeValue,
                notes.nonemptyOnlineCodeValue
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct OnlineCodeEditorSheet: View {
    @Environment(\.dismiss) private var dismiss
    let code: OnlineCode
    let onSave: (OnlineCodeStatus, String?, String?) async throws -> Void

    @State private var status: OnlineCodeStatus
    @State private var productName: String
    @State private var notes: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        code: OnlineCode,
        onSave: @escaping (OnlineCodeStatus, String?, String?) async throws -> Void
    ) {
        self.code = code
        self.onSave = onSave
        _status = State(initialValue: code.status)
        _productName = State(initialValue: code.productName ?? "")
        _notes = State(initialValue: code.notes ?? "")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Code") {
                    Text(code.code).font(.body.monospaced()).textSelection(.enabled)
                }
                Section("Status") {
                    Picker("Status", selection: $status) {
                        ForEach(OnlineCodeStatus.allCases) { value in
                            Label(value.title, systemImage: value.systemImage).tag(value)
                        }
                    }
                }
                Section("Details") {
                    TextField("Product or set", text: $productName)
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(2...5)
                }
            }
            .navigationTitle("Edit Online Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }
                        .disabled(isSaving)
                }
            }
            .alert("Couldn’t Update Code", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await onSave(
                status,
                productName.nonemptyOnlineCodeValue,
                notes.nonemptyOnlineCodeValue
            )
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct OnlineCodeScannerSheet: View {
    @Environment(\.dismiss) private var dismiss
    let games: [TCGGame]
    let onSave: (TCGGame, [String]) async throws -> Void

    @State private var selectedGame: TCGGame
    @State private var scannedCodes: [String] = []
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(
        games: [TCGGame],
        defaultGame: TCGGame,
        onSave: @escaping (TCGGame, [String]) async throws -> Void
    ) {
        self.games = games
        self.onSave = onSave
        _selectedGame = State(initialValue: defaultGame)
    }

    var body: some View {
        NavigationStack {
            Group {
                if DataScannerViewController.isSupported,
                   DataScannerViewController.isAvailable {
                    OnlineCodeDataScanner { value in
                        let normalized = OnlineCodeParser.normalize(value)
                        guard scannedCodes.count < 250,
                              !scannedCodes.contains(where: {
                                  OnlineCodeParser.normalize($0) == normalized
                              }) else { return }
                        scannedCodes.append(value.trimmingCharacters(in: .whitespacesAndNewlines))
                        HapticManager.impact(.light)
                    }
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .top) {
                        VStack(spacing: AppSpacing.small) {
                            Picker("Game", selection: $selectedGame) {
                                ForEach(games) { game in
                                    Text(game.shortName).tag(game)
                                }
                            }
                            .pickerStyle(.menu)
                            .padding(.horizontal, AppSpacing.medium)
                            .padding(.vertical, AppSpacing.compact)
                            .background(.ultraThinMaterial, in: Capsule())

                            Label("\(scannedCodes.count) captured", systemImage: "viewfinder")
                                .font(.callout.weight(.semibold))
                                .padding(.horizontal, AppSpacing.medium)
                                .padding(.vertical, AppSpacing.small)
                                .background(.ultraThinMaterial, in: Capsule())
                        }
                        .padding()
                    }
                    .overlay(alignment: .bottom) {
                        Text("Printed codes and QR codes are recognized automatically.")
                            .font(.caption)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, AppSpacing.medium)
                            .padding(.vertical, AppSpacing.small)
                            .background(.ultraThinMaterial, in: Capsule())
                            .padding()
                    }
                } else {
                    ContentUnavailableView(
                        "Code Scanner Unavailable",
                        systemImage: "viewfinder",
                        description: Text("This device cannot run the live code scanner.")
                    )
                }
            }
            .navigationTitle("Scan Codes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save \(scannedCodes.count)") {
                        Task { await save() }
                    }
                    .disabled(scannedCodes.isEmpty || isSaving)
                }
            }
            .alert("Couldn’t Save Codes", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    @MainActor
    private func save() async {
        isSaving = true
        defer { isSaving = false }
        do {
            try await onSave(selectedGame, scannedCodes)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct OnlineCodeDataScanner: UIViewControllerRepresentable {
    let onCode: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onCode: onCode) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [
                .barcode(symbologies: [.qr]),
                .text(languages: ["en-US"])
            ],
            qualityLevel: .accurate,
            recognizesMultipleItems: true,
            isHighFrameRateTrackingEnabled: true,
            isPinchToZoomEnabled: true,
            isGuidanceEnabled: true,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {
        guard !controller.isScanning else { return }
        try? controller.startScanning()
    }

    static func dismantleUIViewController(
        _ controller: DataScannerViewController,
        coordinator: Coordinator
    ) {
        controller.stopScanning()
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onCode: (String) -> Void

        init(onCode: @escaping (String) -> Void) {
            self.onCode = onCode
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didAdd addedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            process(addedItems)
        }

        func dataScanner(
            _ dataScanner: DataScannerViewController,
            didUpdate updatedItems: [RecognizedItem],
            allItems: [RecognizedItem]
        ) {
            process(updatedItems)
        }

        private func process(_ items: [RecognizedItem]) {
            for item in items {
                switch item {
                case .barcode(let barcode):
                    guard let value = barcode.payloadStringValue,
                          !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    else { continue }
                    onCode(value)
                case .text(let text):
                    OnlineCodeParser.extractCandidates(from: text.transcript).forEach(onCode)
                @unknown default:
                    continue
                }
            }
        }
    }
}

enum OnlineCodeParser {
    static func normalize(_ value: String) -> String {
        value
            .components(separatedBy: .whitespacesAndNewlines)
            .joined()
            .uppercased()
    }

    static func parse(_ input: String) -> [String] {
        var seen = Set<String>()
        return input
            .components(separatedBy: CharacterSet(charactersIn: "\n,;"))
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { value in
                let normalized = normalize(value)
                return normalized.count >= 4 && seen.insert(normalized).inserted
            }
    }

    static func extractCandidates(from recognizedText: String) -> [String] {
        let canonicalText = recognizedText
            .uppercased()
            .replacingOccurrences(of: "[‐‑‒–—―]", with: "-", options: .regularExpression)
            .replacingOccurrences(of: "\\s*-\\s*", with: "-", options: .regularExpression)
        let range = NSRange(canonicalText.startIndex..., in: canonicalText)
        let patterns = [
            #"(?<![A-Z0-9])[A-Z0-9]{3,6}(?:-[A-Z0-9]{3,6}){2,5}(?![A-Z0-9])"#,
            #"(?<![A-Z0-9])[A-Z0-9]{5}(?:\s+[A-Z0-9]{5}){4}(?![A-Z0-9])"#
        ]
        var seen = Set<String>()
        return patterns.flatMap { pattern -> [String] in
            guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
            return expression.matches(in: canonicalText, range: range).compactMap { match in
                guard let swiftRange = Range(match.range, in: canonicalText) else { return nil }
                let candidate = canonicalText[swiftRange]
                    .split(whereSeparator: { $0 == "-" || $0.isWhitespace })
                    .joined(separator: "-")
                guard candidate.contains(where: \.isNumber), seen.insert(candidate).inserted else {
                    return nil
                }
                return candidate
            }
        }
    }
}

private extension String {
    var nonemptyOnlineCodeValue: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

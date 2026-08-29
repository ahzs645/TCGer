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
    @State private var gameMode = OnlineCodeScannerGameMode.automatic
    @State private var automaticallyDetectedGame: TCGGame?
    @State private var scannedCodes: [String] = []
    @State private var isReviewingCodes = false
    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var scanNotice: String?

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
                    OnlineCodeDataScanner(onCode: capture)
                    .ignoresSafeArea(edges: .bottom)
                    .overlay(alignment: .top) {
                        scannerToolbar
                            .padding(.horizontal, AppSpacing.large)
                            .padding(.top, AppSpacing.small)
                    }
                    .overlay(alignment: .bottom) {
                        scannerBottomOverlay
                            .padding(.horizontal, AppSpacing.large)
                            .padding(.bottom, AppSpacing.small)
                    }
                } else {
                    ContentUnavailableView(
                        "Code Scanner Unavailable",
                        systemImage: "viewfinder",
                        description: Text("This device cannot run the live code scanner.")
                    )
                    .overlay(alignment: .topLeading) {
                        Button { dismiss() } label: {
                            adaptiveCircleLabel(systemImage: "xmark")
                        }
                        .accessibilityLabel("Close code scanner")
                        .padding(AppSpacing.large)
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
            .alert("Couldn’t Save Codes", isPresented: Binding(
                get: { errorMessage != nil },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .sheet(isPresented: $isReviewingCodes) {
                OnlineCodeCaptureReviewSheet(
                    codes: $scannedCodes,
                    game: selectedGame,
                    wasDetectedAutomatically: gameMode == .automatic
                        && automaticallyDetectedGame != nil
                )
                .presentationDetents([.medium, .large])
            }
            .onChange(of: scannedCodes, initial: false) { _, codes in
                reconcileAutomaticGame(for: codes)
            }
        }
    }

    @ViewBuilder
    private var scannerToolbar: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: AppSpacing.medium) {
                scannerToolbarContent
            }
        } else {
            scannerToolbarContent
        }
    }

    private var scannerToolbarContent: some View {
        HStack(spacing: AppSpacing.small) {
            Button { dismiss() } label: {
                adaptiveCircleLabel(systemImage: "xmark")
            }
            .accessibilityLabel("Close code scanner")

            gameModeMenu

            Spacer(minLength: AppSpacing.small)

            if #available(iOS 26.0, *) {
                saveButton
                    .buttonStyle(.glassProminent)
            } else {
                saveButton
                    .buttonStyle(.borderedProminent)
            }
        }
    }

    private var saveButton: some View {
        Button(isSaving ? "Saving…" : "Save \(scannedCodes.count)") {
            Task { await save() }
        }
        .font(.callout.weight(.semibold))
        .frame(minHeight: 44)
        .disabled(scannedCodes.isEmpty || isSaving)
        .accessibilityHint("Saves the captured codes to the Code Vault")
    }

    private var gameModeMenu: some View {
        Menu {
            Button {
                enableAutomaticGameDetection()
            } label: {
                if gameMode == .automatic {
                    Label("Automatic", systemImage: "checkmark")
                } else {
                    Label("Automatic", systemImage: "wand.and.stars")
                }
            }

            Divider()

            ForEach(games) { game in
                Button {
                    select(game)
                } label: {
                    if gameMode == .game(game) {
                        Label(game.displayName, systemImage: "checkmark")
                    } else {
                        Text(game.displayName)
                    }
                }
            }
        } label: {
            adaptiveGameModeLabel
        }
        .accessibilityLabel("Code game")
        .accessibilityValue(gameModeAccessibilityValue)
    }

    @ViewBuilder
    private var adaptiveGameModeLabel: some View {
        if #available(iOS 26.0, *) {
            gameModeLabelContent
                .glassEffect(.regular.interactive(), in: .capsule)
        } else {
            gameModeLabelContent
                .background(.ultraThinMaterial, in: Capsule())
        }
    }

    private var gameModeLabelContent: some View {
        VStack(spacing: AppSpacing.compact) {
            Image(systemName: gameMode == .automatic ? "wand.and.stars" : "rectangle.stack")
                .font(.body.weight(.semibold))
            Text(gameModeTitle)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
        }
        .foregroundStyle(.primary)
        .frame(width: 108, height: 48)
        .contentShape(Capsule())
    }

    @ViewBuilder
    private func adaptiveCircleLabel(systemImage: String) -> some View {
        if #available(iOS 26.0, *) {
            Image(systemName: systemImage)
                .font(.headline)
                .foregroundStyle(.primary)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
                .glassEffect(.regular.interactive(), in: .circle)
        } else {
            Image(systemName: systemImage)
                .font(.headline)
                .foregroundStyle(.white)
                .frame(width: 44, height: 44)
                .background(.ultraThinMaterial, in: Circle())
        }
    }

    @ViewBuilder
    private var scannerBottomOverlay: some View {
        VStack(spacing: AppSpacing.small) {
            if !scannedCodes.isEmpty {
                capturedCodesTray
            }
            scannerStatusLabel
        }
    }

    @ViewBuilder
    private var capturedCodesTray: some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: AppSpacing.small) {
                capturedCodesTrayContent
            }
        } else {
            capturedCodesTrayContent
        }
    }

    private var capturedCodesTrayContent: some View {
        HStack(spacing: AppSpacing.small) {
            Button {
                isReviewingCodes = true
            } label: {
                adaptiveTrayLabel(
                    title: "\(scannedCodes.count) captured",
                    systemImage: "viewfinder",
                    trailingImage: "chevron.up"
                )
            }
            .accessibilityHint("Review or remove captured codes")

            Button(role: .destructive) {
                clearCapturedCodes()
            } label: {
                adaptiveTrayLabel(title: "Clear", systemImage: "trash", color: .red)
            }
            .accessibilityHint("Removes all captured codes")
        }
    }

    @ViewBuilder
    private func adaptiveTrayLabel(
        title: String,
        systemImage: String,
        trailingImage: String? = nil,
        color: Color = .primary
    ) -> some View {
        let content = HStack(spacing: AppSpacing.small) {
            Image(systemName: systemImage)
            Text(title)
                .contentTransition(.numericText())
            if let trailingImage {
                Image(systemName: trailingImage)
                    .font(.caption2.weight(.bold))
            }
        }
        .font(.callout.weight(.semibold))
        .foregroundStyle(color)
        .padding(.horizontal, AppSpacing.medium)
        .frame(height: 44)
        .contentShape(Capsule())

        if #available(iOS 26.0, *) {
            content.glassEffect(.regular.interactive(), in: .capsule)
        } else {
            content.background(.ultraThinMaterial, in: Capsule())
        }
    }

    @ViewBuilder
    private var scannerStatusLabel: some View {
        let content = Text(scannerStatusText)
            .font(.caption)
            .multilineTextAlignment(.center)
            .foregroundStyle(.primary)
            .padding(.horizontal, AppSpacing.medium)
            .padding(.vertical, AppSpacing.small)

        if #available(iOS 26.0, *) {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content.background(.ultraThinMaterial, in: Capsule())
        }
    }

    private var gameModeTitle: String {
        switch gameMode {
        case .automatic:
            if let automaticallyDetectedGame {
                return "Auto · \(automaticallyDetectedGame.shortName)"
            }
            return "Automatic"
        case .game(let game):
            return game.shortName
        }
    }

    private var gameModeAccessibilityValue: String {
        switch gameMode {
        case .automatic:
            if let automaticallyDetectedGame {
                return "Automatic, detected \(automaticallyDetectedGame.displayName)"
            }
            return "Automatic detection"
        case .game(let game):
            return game.displayName
        }
    }

    private var scannerStatusText: String {
        if let scanNotice { return scanNotice }
        if gameMode == .automatic, let automaticallyDetectedGame {
            return "\(automaticallyDetectedGame.shortName) detected automatically."
        }
        if gameMode == .automatic {
            return "Printed codes and QR codes are recognized and assigned a game automatically."
        }
        return "Printed codes and QR codes are recognized automatically."
    }

    private func capture(_ value: String) {
        let inferredGame = OnlineCodeGameDetector.detect(from: value)
        let code = OnlineCodeParser.canonicalCode(value)
        let normalized = OnlineCodeParser.normalize(code)
        guard scannedCodes.count < 250,
              normalized.count >= 4,
              !scannedCodes.contains(where: {
                  OnlineCodeParser.normalize($0) == normalized
              }) else { return }

        if gameMode == .automatic, let inferredGame, games.contains(inferredGame) {
            if let automaticallyDetectedGame,
               automaticallyDetectedGame != inferredGame,
               !scannedCodes.isEmpty {
                let notice = "\(automaticallyDetectedGame.shortName) codes are already captured. Save or clear them before scanning \(inferredGame.shortName)."
                if scanNotice != notice {
                    scanNotice = notice
                    HapticManager.notification(.warning)
                }
                return
            }
            automaticallyDetectedGame = inferredGame
            selectedGame = inferredGame
        }

        scanNotice = nil
        scannedCodes.append(code)
        HapticManager.impact(.light)
    }

    private func select(_ game: TCGGame) {
        selectedGame = game
        gameMode = .game(game)
        scanNotice = nil
        HapticManager.selection()
    }

    private func enableAutomaticGameDetection() {
        gameMode = .automatic
        reconcileAutomaticGame(for: scannedCodes)
        scanNotice = nil
        HapticManager.selection()
    }

    private func reconcileAutomaticGame(for codes: [String]) {
        guard gameMode == .automatic else { return }
        guard !codes.isEmpty else {
            automaticallyDetectedGame = nil
            return
        }

        let detectedGames = Set(codes.compactMap { code in
            OnlineCodeGameDetector.detect(from: code)
        })
            .intersection(games)
        guard detectedGames.count == 1, let game = detectedGames.first else {
            automaticallyDetectedGame = nil
            return
        }
        automaticallyDetectedGame = game
        selectedGame = game
    }

    private func clearCapturedCodes() {
        scannedCodes.removeAll()
        automaticallyDetectedGame = nil
        scanNotice = nil
        HapticManager.impact(.light)
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

private enum OnlineCodeScannerGameMode: Hashable {
    case automatic
    case game(TCGGame)
}

private struct OnlineCodeCaptureReviewSheet: View {
    @Environment(\.dismiss) private var dismiss
    @Binding var codes: [String]
    let game: TCGGame
    let wasDetectedAutomatically: Bool

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(codes, id: \.self) { code in
                        Text(code)
                            .font(.subheadline.monospaced().weight(.semibold))
                            .textSelection(.enabled)
                    }
                    .onDelete { offsets in
                        codes.remove(atOffsets: offsets)
                        if codes.isEmpty { dismiss() }
                    }
                } header: {
                    Text("Captured Codes")
                } footer: {
                    Text(
                        wasDetectedAutomatically
                            ? "\(game.displayName) was identified automatically."
                            : "These codes will be saved as \(game.displayName)."
                    )
                }
            }
            .navigationTitle("Review Codes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
                ToolbarItem(placement: .destructiveAction) {
                    Button("Clear All", role: .destructive) {
                        codes.removeAll()
                        dismiss()
                    }
                    .disabled(codes.isEmpty)
                }
            }
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

nonisolated enum OnlineCodeParser {
    private static let redemptionCodeParameters = [
        "2d_code", "code", "redeem_code", "redemption_code"
    ]

    static func canonicalCode(_ value: String) -> String {
        let cleaned = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[‐‑‒–—―]", with: "-", options: .regularExpression)
        guard !cleaned.isEmpty else { return "" }

        if let components = URLComponents(string: cleaned),
           let queryItems = components.queryItems,
           let candidate = queryItems.first(where: {
               redemptionCodeParameters.contains($0.name.lowercased())
           })?.value?.trimmingCharacters(in: .whitespacesAndNewlines),
           !candidate.isEmpty {
            return candidate.replacingOccurrences(
                of: "[‐‑‒–—―]",
                with: "-",
                options: .regularExpression
            )
        }

        return cleaned
    }

    static func normalize(_ value: String) -> String {
        canonicalCode(value)
            .components(separatedBy: .whitespacesAndNewlines)
            .joined()
            .uppercased()
    }

    static func parse(_ input: String) -> [String] {
        var seen = Set<String>()
        return input
            .components(separatedBy: CharacterSet(charactersIn: "\n,;"))
            .map(canonicalCode)
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

enum OnlineCodeGameDetector {
    /// Infers a game only when the QR destination or printed-code shape is
    /// distinctive. Unknown formats intentionally remain user-selectable.
    static func detect(from value: String) -> TCGGame? {
        let cleaned = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "[‐‑‒–—―]", with: "-", options: .regularExpression)
        guard !cleaned.isEmpty else { return nil }

        if let components = URLComponents(string: cleaned),
           let host = components.host?.lowercased() {
            let path = components.path.lowercased()
            if host == "pokemon.com" || host.hasSuffix(".pokemon.com") {
                return .pokemon
            }
            if host == "magic.wizards.com"
                || (host.hasSuffix(".wizards.com")
                    && path.range(of: "(?:mtg|arena)", options: .regularExpression) != nil) {
                return .magic
            }
        }

        let code = OnlineCodeParser.normalize(cleaned)
        if code.range(
            of: #"^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){2}-[A-Z0-9]{3}$"#,
            options: .regularExpression
        ) != nil {
            return .pokemon
        }
        if code.range(
            of: #"^[A-Z0-9]{5}(?:-[A-Z0-9]{5}){4}$"#,
            options: .regularExpression
        ) != nil {
            return .magic
        }

        return nil
    }
}

private extension String {
    var nonemptyOnlineCodeValue: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}

import SwiftUI
import UIKit

struct CardScannerView: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @StateObject private var viewModel = CardScannerViewModel()
    @State private var selectedCardForBinder: Card?

    var body: some View {
        ZStack {
            CardScannerCameraPreview(controller: viewModel.cameraController)
                .ignoresSafeArea()

            VStack {
                topStatusOverlay
                Spacer()
                framingOverlay
                bottomControls
            }
            .padding()
        }
        .onAppear {
            viewModel.updateEnvironment(environmentStore)
            syncSelectedModeWithModules()
        }
        .onChange(of: environmentStore.authToken, initial: false) { _, _ in
            viewModel.updateEnvironment(environmentStore)
        }
        .onChange(of: environmentStore.enabledYugioh, initial: false) { _, _ in
            syncSelectedModeWithModules()
        }
        .onChange(of: environmentStore.enabledMagic, initial: false) { _, _ in
            syncSelectedModeWithModules()
        }
        .onChange(of: environmentStore.enabledPokemon, initial: false) { _, _ in
            syncSelectedModeWithModules()
        }
        .sheet(item: $viewModel.latestResult, onDismiss: {
            viewModel.clearResult()
        }) { result in
            ScanResultSheet(
                result: result,
                color: accentColor(for: viewModel.selectedMode),
                onAddToBinder: { candidate in
                    guard let card = candidate.details.sourceCard ?? makeCard(from: candidate) else {
                        return
                    }
                    selectedCardForBinder = card
                }
            )
            .presentationDetents([.medium, .large])
        }
        .sheet(item: $selectedCardForBinder) { card in
            AddCardToBinderSheet(card: card) { binderId, quantity, condition, language, notes in
                await addCardToBinder(
                    card: card,
                    binderId: binderId,
                    quantity: quantity,
                    condition: condition,
                    language: language,
                    notes: notes
                )
            }
        }
        .alert(isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Alert(
                title: Text("Scan Failed"),
                message: Text(viewModel.errorMessage ?? "An unknown error occurred."),
                dismissButton: .default(Text("OK"), action: {
                    viewModel.clearResult()
                })
            )
        }
    }

    @ViewBuilder
    private var topStatusOverlay: some View {
        switch viewModel.state {
        case .unauthorized:
            Text("Camera access is required. Enable it in Settings to scan cards.")
                .font(.subheadline)
                .foregroundColor(.white)
                .padding(12)
                .background(Color.black.opacity(0.6))
                .cornerRadius(12)
        case .processing:
            HStack(spacing: 8) {
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                Text("Identifying card...")
                    .font(.callout)
                    .foregroundColor(.white)
            }
            .padding(12)
            .background(Color.black.opacity(0.6))
            .cornerRadius(12)
        case .error(let message):
            Text(message)
                .font(.subheadline)
                .foregroundColor(.white)
                .padding(12)
                .background(Color.red.opacity(0.7))
                .cornerRadius(12)
        default:
            if !hasEnabledScanModes {
                Text("Enable at least one TCG module in Settings to scan cards.")
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .padding(12)
                    .background(Color.black.opacity(0.6))
                    .cornerRadius(12)
            } else if !isModeSupported {
                Text("\(viewModel.selectedMode.displayName) scanning is coming soon.")
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .padding(12)
                    .background(Color.black.opacity(0.6))
                    .cornerRadius(12)
            } else if !viewModel.supportsLivePreview(viewModel.selectedMode) {
                Text("Tap the shutter to scan \(viewModel.selectedMode.displayName) cards.")
                    .font(.subheadline)
                    .foregroundColor(.white)
                    .padding(12)
                    .background(Color.black.opacity(0.6))
                    .cornerRadius(12)
            } else if viewModel.isAnalyzingFrame {
                HStack(spacing: 8) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    Text("Scanning...")
                        .font(.callout)
                        .foregroundColor(.white)
                }
                .padding(12)
                .background(Color.black.opacity(0.6))
                .cornerRadius(12)
            } else {
                EmptyView()
            }
        }
    }

    private var framingOverlay: some View {
        GeometryReader { geometry in
            let width = min(geometry.size.width - 32, geometry.size.height * 0.7)
            let height = width * 1.4
            RoundedRectangle(cornerRadius: 18)
                .strokeBorder(accentColor(for: viewModel.selectedMode).opacity(0.9), lineWidth: 3)
                .frame(width: width, height: height)
                .overlay(
                    Text(viewModel.selectedMode.description)
                        .font(.footnote)
                        .foregroundColor(.white)
                        .padding(8)
                        .background(Color.black.opacity(0.55))
                        .cornerRadius(10)
                        .padding(.top, height / 2 + 24),
                    alignment: .bottom
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var bottomControls: some View {
        VStack(spacing: 16) {
            if hasEnabledScanModes {
                Picker("Mode", selection: $viewModel.selectedMode) {
                    ForEach(availableScanModes) { mode in
                        Text(mode.displayName).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal)
            } else {
                Text("Turn on at least one game module in Settings to access scanning.")
                    .font(.footnote)
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }

            Button(action: {
                viewModel.capturePhoto()
            }) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.15))
                        .frame(width: 84, height: 84)
                    Circle()
                        .fill(accentColor(for: viewModel.selectedMode))
                        .frame(width: 68, height: 68)
                    if isProcessingPhoto {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    } else {
                        Image(systemName: "camera.aperture")
                            .font(.title)
                            .foregroundColor(.white)
                    }
                }
            }
            .disabled(
                isProcessingPhoto ||
                isUnauthorized ||
                isErrorState ||
                viewModel.latestResult != nil ||
                !isModeSupported ||
                !hasEnabledScanModes
            )
            .buttonStyle(.plain)
            .padding(.bottom, 12)
        }
    }

    private func accentColor(for mode: ScanMode) -> Color {
        switch mode {
        case .pokemon: return Color.red
        case .yugioh: return Color.purple
        case .mtg: return Color.green
        }
    }

    private func makeCard(from candidate: CardScanCandidate) -> Card? {
        let details = candidate.details
        guard details.identity.game != .all else { return nil }
        return Card(
            id: details.identity.id,
            name: details.identity.name,
            tcg: details.identity.game.rawValue,
            setCode: details.identity.setCode,
            setName: details.identity.setName,
            rarity: details.rarity,
            imageUrl: details.imageURL?.absoluteString,
            imageUrlSmall: details.imageURL?.absoluteString,
            price: details.price
        )
    }

    @MainActor
    private func addCardToBinder(
        card: Card,
        binderId: String,
        quantity: Int,
        condition: String?,
        language: String?,
        notes: String?
    ) async {
        guard let token = environmentStore.authToken else {
            viewModel.errorMessage = "Not authenticated."
            return
        }

        let apiService = APIService()
        do {
            try await apiService.addCardToBinder(
                config: environmentStore.serverConfiguration,
                token: token,
                binderId: binderId,
                cardId: card.id,
                quantity: quantity,
                condition: condition,
                language: language,
                notes: notes,
                price: card.price,
                acquisitionPrice: nil,
                card: card
            )
        } catch {
            viewModel.errorMessage = error.localizedDescription
        }
    }
}

private extension CardScannerView {
    var availableScanModes: [ScanMode] {
        ScanMode.allCases.filter { environmentStore.isGameEnabled($0.tcgGame) }
    }

    var hasEnabledScanModes: Bool {
        !availableScanModes.isEmpty
    }

    func syncSelectedModeWithModules() {
        let modes = availableScanModes
        guard !modes.isEmpty else { return }
        if !modes.contains(viewModel.selectedMode) {
            viewModel.selectedMode = modes[0]
        }
    }

    var isModeSupported: Bool {
        viewModel.isModeSupported(viewModel.selectedMode)
    }

    var isProcessingPhoto: Bool {
        if case .processing = viewModel.state {
            return true
        }
        return false
    }

    var isUnauthorized: Bool {
        if case .unauthorized = viewModel.state {
            return true
        }
        return false
    }

    var isErrorState: Bool {
        if case .error = viewModel.state {
            return true
        }
        return false
    }
}

private struct ScanResultSheet: View {
    @EnvironmentObject private var environmentStore: EnvironmentStore
    @State private var selectedCandidate: CardScanCandidate
    let result: CardScanResult
    let color: Color
    let onAddToBinder: (CardScanCandidate) -> Void

    init(
        result: CardScanResult,
        color: Color,
        onAddToBinder: @escaping (CardScanCandidate) -> Void
    ) {
        self.result = result
        self.color = color
        self.onAddToBinder = onAddToBinder
        _selectedCandidate = State(initialValue: result.primary)
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    headerSection
                    confidenceSection
                    if !result.alternatives.isEmpty {
                        alternativesSection
                    }
                }
                .padding()
            }
            .navigationTitle("Scan Result")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add to Binder") {
                        onAddToBinder(selectedCandidate)
                    }
                    .disabled(candidateCard == nil)
                }
            }
        }
    }

    private var candidateCard: Card? {
        selectedCandidate.details.sourceCard ?? {
            let details = selectedCandidate.details
            guard details.identity.game != .all else { return nil }
            return Card(
                id: details.identity.id,
                name: details.identity.name,
                tcg: details.identity.game.rawValue,
                setCode: details.identity.setCode,
                setName: details.identity.setName,
                rarity: details.rarity,
                imageUrl: details.imageURL?.absoluteString,
                imageUrlSmall: details.imageURL?.absoluteString,
                price: details.price
            )
        }()
    }

    private var headerSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let preview = capturedImage {
                preview
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(color.opacity(0.25), lineWidth: 2)
                    )
            } else {
                RoundedRectangle(cornerRadius: 12)
                    .fill(color.opacity(0.15))
                    .frame(height: 200)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text(selectedCandidate.details.identity.name)
                    .font(.title3)
                    .fontWeight(.semibold)
                    .foregroundColor(.primary)
                    .multilineTextAlignment(.leading)
                if let setName = selectedCandidate.details.identity.setName {
                    Text(setName)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                }
                Text(selectedCandidate.details.identity.game.displayName)
                    .font(.caption)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(color.opacity(0.18))
                    .clipShape(Capsule())
            }

            if let rarity = selectedCandidate.details.rarity {
                Label(rarity, systemImage: "star.fill")
                    .foregroundColor(color)
                    .font(.subheadline)
            }

            if environmentStore.showPricing, let price = selectedCandidate.details.price {
                Label(String(format: "$%.2f", price), systemImage: "dollarsign.circle")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var confidenceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Confidence")
                .font(.headline)
            Text(String(format: "%.0f%%", selectedCandidate.confidence.score * 100))
                .font(.title2)
                .fontWeight(.semibold)
            if let reason = selectedCandidate.confidence.reason {
                Text(reason)
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }

    private var alternativesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Alternatives")
                .font(.headline)
            ForEach(result.alternatives, id: \.id) { candidate in
                Button {
                    selectedCandidate = candidate
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(candidate.details.identity.name)
                                .font(.subheadline)
                                .foregroundColor(.primary)
                            if let setName = candidate.details.identity.setName {
                                Text(setName)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                        }
                        Spacer()
                        Text(String(format: "%.0f%%", candidate.confidence.score * 100))
                            .font(.footnote)
                            .foregroundColor(.secondary)
                        if candidate.id == selectedCandidate.id {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundColor(color)
                        }
                    }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(candidate.id == selectedCandidate.id ? color : Color.gray.opacity(0.3), lineWidth: candidate.id == selectedCandidate.id ? 2 : 1)
                    )
                }
                .buttonStyle(.plain)
            }
        }
        .padding()
        .background(Color(.secondarySystemBackground))
        .cornerRadius(12)
    }
}

private extension ScanResultSheet {
    var capturedImage: Image? {
        Image(
            uiImage: UIImage(cgImage: result.capturedImage)
        )
    }
}

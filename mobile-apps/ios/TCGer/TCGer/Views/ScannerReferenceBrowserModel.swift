import Combine
import CoreGraphics
import Foundation
import SwiftUI
@preconcurrency import Vision

/// Drives `ScannerReferenceBrowserView`: discovers reference folders, runs the
/// production coordinator over their images, and judges each result against the
/// frame's label.
@MainActor
final class ScannerReferenceBrowserModel: ObservableObject {
    static let rootsFooter = """
        Sets are read from the app's Documents folder, and in Simulator also \
        from ~/Downloads/Reference on the Mac.
        """

    @Published private(set) var sets: [ScannerReferenceSet] = []
    @Published private(set) var selectedSet: ScannerReferenceSet?
    @Published private(set) var discoveryMessage = "Looking for reference folders…"
    @Published var showingImporter = false

    @Published private(set) var position = 0
    @Published private(set) var currentImage: CGImage?
    @Published private(set) var croppedImage: CGImage?
    @Published private(set) var detectedQuad: [CGPoint]?
    @Published private(set) var currentCandidates: [String] = []
    @Published private(set) var currentResultSummary: String?
    @Published private(set) var isScanning = false

    @Published private(set) var outcomes: [Int: ScannerReferenceVerdict] = [:]
    @Published private(set) var isRunningAll = false
    @Published private(set) var completedCount = 0
    @Published private(set) var totalToRun = 0
    @Published private(set) var summary: String?
    @Published var failuresOnly = false {
        didSet { position = 0; loadCurrent() }
    }

    private let coordinator = CardScannerCoordinator(
        strategies: [BoardCardEmbeddingScannerStrategy()],
        apiService: APIService()
    )
    private let cropper = CardCropper()
    private weak var environmentStore: EnvironmentStore?
    private var runTask: Task<Void, Never>?

    var visibleItems: [ScannerReferenceItem] {
        guard let selectedSet else { return [] }
        guard failuresOnly else { return selectedSet.items }
        return selectedSet.items.filter { outcomes[$0.id]?.isFailure == true }
    }

    var currentItem: ScannerReferenceItem? {
        let items = visibleItems
        guard items.indices.contains(position) else { return items.first }
        return items[position]
    }

    var currentVerdict: ScannerReferenceVerdict? {
        currentItem.flatMap { outcomes[$0.id] }
    }

    var failures: [ScannerReferenceItem] {
        (selectedSet?.items ?? []).filter { outcomes[$0.id]?.isFailure == true }
    }

    var runProgress: Double {
        totalToRun > 0 ? Double(completedCount) / Double(totalToRun) : 0
    }

    func configure(environment: EnvironmentStore) {
        environmentStore = environment
        if sets.isEmpty { discover() }
    }

    // MARK: Discovery

    func discover(in explicitRoot: URL? = nil) {
        let roots = explicitRoot.map { [$0] } ?? ScannerReferenceLibrary.defaultRoots()
        var accessed: [URL] = []
        for root in roots where root.startAccessingSecurityScopedResource() {
            accessed.append(root)
        }
        defer { accessed.forEach { $0.stopAccessingSecurityScopedResource() } }

        sets = roots.flatMap { ScannerReferenceLibrary.sets(in: $0) }
        discoveryMessage = roots.isEmpty
            ? "No reference folder found. Use Choose Folder to point at one."
            : "No image sets under \(roots.map(\.lastPathComponent).joined(separator: ", "))."
    }

    func selectSet(_ set: ScannerReferenceSet?) {
        cancelRun()
        selectedSet = set
        position = 0
        outcomes = [:]
        summary = nil
        failuresOnly = false
        loadCurrent()
    }

    // MARK: Navigation

    func step(_ delta: Int) {
        let count = visibleItems.count
        guard count > 0 else { return }
        position = (position + delta + count) % count
        loadCurrent()
    }

    private func loadCurrent() {
        croppedImage = nil
        detectedQuad = nil
        currentCandidates = []
        currentResultSummary = nil
        guard let item = currentItem else {
            currentImage = nil
            return
        }
        currentImage = item.loadImage()
    }

    // MARK: Scanning

    func scanCurrent() async {
        guard let item = currentItem, let image = currentImage ?? item.loadImage() else { return }
        isScanning = true
        defer { isScanning = false }

        // Show what the cropper actually selected: a wrong crop and a wrong
        // match look identical in the result alone.
        let observations = (try? cropper.detectRectangles(in: image)) ?? []
        if let best = CardCropper.preferredObservation(from: observations) {
            detectedQuad = [best.topLeft, best.topRight, best.bottomRight, best.bottomLeft]
        } else {
            detectedQuad = nil
        }
        croppedImage = (try? cropper.bestCrop(from: image)) ?? nil

        // Deliberately .photoCapture, not .importedPhoto: the browser exists to
        // explain the Roboflow replay reports, so it must scan exactly like the
        // replay harness. The importedPhoto whole-frame fallback would diverge
        // from the numbers being investigated.
        let result = await coordinator.scan(image: image, context: makeContext(), source: .photoCapture)
        apply(result: result, to: item)
    }

    func runAll() async {
        guard let set = selectedSet else { return }
        let items = visibleItems.isEmpty ? set.items : visibleItems
        isRunningAll = true
        completedCount = 0
        totalToRun = items.count
        let context = makeContext()

        runTask = Task { [weak self] in
            guard let self else { return }
            for item in items {
                if Task.isCancelled { break }
                guard let image = item.loadImage() else {
                    await MainActor.run { self.completedCount += 1 }
                    continue
                }
                let result = await self.coordinator.scan(
                    image: image,
                    context: context,
                    source: .photoCapture
                )
                await MainActor.run {
                    self.record(result: result, for: item)
                    self.completedCount += 1
                }
            }
            await MainActor.run {
                self.isRunningAll = false
                self.updateSummary()
                self.loadCurrent()
            }
        }
        await runTask?.value
    }

    func cancelRun() {
        runTask?.cancel()
        runTask = nil
        isRunningAll = false
    }

    // MARK: Result handling

    private func apply(result: Result<CardScanResult, CardScannerError>, to item: ScannerReferenceItem) {
        record(result: result, for: item)
        switch result {
        case .success(let scan):
            currentResultSummary = String(
                format: "%@ · %@ · %.3f",
                scan.primary.details.identity.id,
                scan.primary.details.identity.name,
                scan.primary.confidence.score
            )
            currentCandidates = ([scan.primary] + scan.alternatives).prefix(5).map { candidate in
                String(
                    format: "%@ %@ %.3f",
                    candidate.details.identity.id,
                    candidate.details.identity.name,
                    candidate.confidence.score
                )
            }
        case .failure(let error):
            currentResultSummary = "no match (\(error.shortDescription))"
            currentCandidates = []
        }
        updateSummary()
    }

    private func record(result: Result<CardScanResult, CardScannerError>, for item: ScannerReferenceItem) {
        let cardID: String?
        let name: String?
        switch result {
        case .success(let scan):
            cardID = scan.primary.details.identity.id
            name = scan.primary.details.identity.name
        case .failure:
            cardID = nil
            name = nil
        }
        outcomes[item.id] = ScannerReferenceVerdict.judge(
            expectation: item.expectation,
            resultCardID: cardID,
            resultName: name,
            expectedName: nil
        )
    }

    /// Reports labeled outcomes separately from unlabeled ones. Card backs,
    /// multi-card scenes, and printings outside the index are declines the
    /// scanner is supposed to produce, so folding them into one recall number
    /// hides both the real recall and the real false-positive rate.
    private func updateSummary() {
        let judged = outcomes.values
        guard !judged.isEmpty else {
            summary = nil
            return
        }
        let positives = judged.filter { $0 == .correct || $0 == .wrongPrinting || $0 == .wrongCard || $0 == .missed }
        let negatives = judged.filter { $0 == .declined || $0 == .falsePositive }
        var parts: [String] = []
        if !positives.isEmpty {
            let correct = judged.filter { $0 == .correct }.count
            parts.append(String(
                format: "labeled cards %d/%d correct (%.0f%%)",
                correct,
                positives.count,
                Double(correct) / Double(positives.count) * 100
            ))
            let wrongPrinting = judged.filter { $0 == .wrongPrinting }.count
            if wrongPrinting > 0 { parts.append("\(wrongPrinting) wrong printing") }
            let wrongCard = judged.filter { $0 == .wrongCard }.count
            if wrongCard > 0 { parts.append("\(wrongCard) wrong card") }
        }
        if !negatives.isEmpty {
            let declined = judged.filter { $0 == .declined }.count
            parts.append(String(
                format: "hard negatives %d/%d declined (%.0f%%)",
                declined,
                negatives.count,
                Double(declined) / Double(negatives.count) * 100
            ))
        }
        let unlabeledMatched = judged.filter { $0 == .matched }.count
        let unlabeledNoMatch = judged.filter { $0 == .noMatch }.count
        if unlabeledMatched + unlabeledNoMatch > 0 {
            parts.append("unlabeled \(unlabeledMatched) matched / \(unlabeledNoMatch) no match")
        }
        summary = parts.joined(separator: " · ")
    }

    private func makeContext() -> CardScannerContext {
        CardScannerContext(
            mode: .pokemon,
            enginePreference: .localOnly,
            // The browser runs the local-only pipeline, so the server config is
            // never used; `.onDevice` keeps it from implying a backend.
            serverConfiguration: environmentStore?.serverConfiguration ?? .onDevice,
            authToken: environmentStore?.authToken,
            showPricing: false,
            saveDebugCapture: false,
            captureNotes: nil,
            setCode: nil
        )
    }
}

private extension CardScannerError {
    var shortDescription: String {
        switch self {
        case .rejectedInput: return "gate rejected"
        case .noMatch: return "below threshold"
        case .ineligibleMode: return "ineligible"
        default: return "\(self)"
        }
    }
}

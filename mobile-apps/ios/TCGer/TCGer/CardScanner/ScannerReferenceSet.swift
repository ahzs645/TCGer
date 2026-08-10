import CoreGraphics
import Foundation
import ImageIO

/// A browsable folder of reference images with optional ground truth.
///
/// Three on-disk shapes are recognized, so existing evidence folders work
/// without being reorganized:
///
/// - a device recording (`results.json` + frames), whose recorded predictions
///   act as a regression baseline;
/// - a Roboflow replay corpus (`roboflow-ios-replay.json` + `datasets/`), which
///   carries localization boxes;
/// - any folder of images, optionally alongside a `scanner-labels.json`.
///
/// `scanner-labels.json` is the only place expectations live. Categorizing a
/// frame as a card back, a multi-card scene, or a printing outside the bundled
/// index keeps those out of the recall denominator instead of counting every
/// abstention as the same failure.
nonisolated struct ScannerReferenceSet: Identifiable {
    enum Kind: String {
        case recording = "Device recording"
        case replayCorpus = "Replay corpus"
        case images = "Image folder"
    }

    let id: String
    let name: String
    let kind: Kind
    let rootURL: URL
    let items: [ScannerReferenceItem]

    var labeledCount: Int { items.filter { $0.expectation != .unlabeled }.count }
}

/// What a frame should produce. Everything except `.card` is a case the
/// single-card recognizer is expected to decline.
nonisolated enum ScannerReferenceExpectation: Equatable {
    case card(id: String, name: String?)
    case cardBack
    case multipleCards
    case foreignLanguage
    case outsideIndex
    case unlabeled

    var isNegative: Bool {
        switch self {
        case .cardBack, .multipleCards, .foreignLanguage, .outsideIndex: return true
        case .card, .unlabeled: return false
        }
    }

    var expectedCardID: String? {
        if case .card(let id, _) = self { return id }
        return nil
    }

    var label: String {
        switch self {
        case .card(let id, _): return id
        case .cardBack: return "Card back"
        case .multipleCards: return "Multiple cards"
        case .foreignLanguage: return "Foreign language"
        case .outsideIndex: return "Outside index"
        case .unlabeled: return "Unlabeled"
        }
    }
}

nonisolated struct ScannerReferenceItem: Identifiable {
    let id: Int
    let name: String
    let imageURL: URL
    let expectation: ScannerReferenceExpectation
    let notes: String?
    /// A previous run's prediction for this frame, when the folder carries one.
    let baselineCardID: String?
    let baselineConfidence: Double?
    /// Ground-truth card boxes in Vision's normalized, bottom-left origin space.
    let annotations: [CGRect]

    func loadImage() -> CGImage? {
        guard let source = CGImageSourceCreateWithURL(imageURL as CFURL, nil) else { return nil }
        return CGImageSourceCreateImageAtIndex(source, 0, nil)
    }
}

/// The outcome of scanning one reference item, judged against its expectation.
nonisolated enum ScannerReferenceVerdict: String {
    case correct = "Correct"
    case wrongPrinting = "Wrong printing"
    case wrongCard = "Wrong card"
    case missed = "Missed"
    case declined = "Declined"
    case falsePositive = "False positive"
    case matched = "Matched"
    case noMatch = "No match"

    /// Only outcomes that contradict the ground truth. Unlabeled frames are
    /// informational and never count as failures.
    var isFailure: Bool {
        switch self {
        case .wrongPrinting, .wrongCard, .missed, .falsePositive: return true
        case .correct, .declined, .matched, .noMatch: return false
        }
    }

    var isPass: Bool {
        switch self {
        case .correct, .declined: return true
        default: return false
        }
    }

    static func judge(
        expectation: ScannerReferenceExpectation,
        resultCardID: String?,
        resultName: String?,
        expectedName: String?
    ) -> ScannerReferenceVerdict {
        switch expectation {
        case .unlabeled:
            return resultCardID == nil ? .noMatch : .matched
        case .cardBack, .multipleCards, .foreignLanguage, .outsideIndex:
            return resultCardID == nil ? .declined : .falsePositive
        case .card(let id, let name):
            guard let resultCardID else { return .missed }
            if resultCardID == id { return .correct }
            let expectedName = name ?? expectedName
            if let expectedName, let resultName,
               CardTitleOCR.normalizedName(expectedName) == CardTitleOCR.normalizedName(resultName) {
                return .wrongPrinting
            }
            return .wrongCard
        }
    }
}

// MARK: - Discovery

nonisolated enum ScannerReferenceLibrary {
    static let labelsFilename = "scanner-labels.json"
    private static let imageExtensions: Set<String> = ["jpg", "jpeg", "png", "heic"]

    /// Folders searched when no explicit root is chosen. On Simulator the Mac's
    /// home directory is exposed as `SIMULATOR_HOST_HOME`, so reference folders
    /// on the host are readable without copying them into the container.
    static func defaultRoots() -> [URL] {
        var roots: [URL] = []
        if let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            roots.append(documents)
        }
#if targetEnvironment(simulator)
        if let hostHome = ProcessInfo.processInfo.environment["SIMULATOR_HOST_HOME"] {
            roots.append(URL(fileURLWithPath: hostHome).appendingPathComponent("Downloads/Reference"))
        }
#endif
        return roots.filter { FileManager.default.fileExists(atPath: $0.path) }
    }

    /// Returns every reference set directly inside `root`, plus `root` itself
    /// when it is a reference set. Nesting stops there: these folders hold
    /// thousands of images and a deep walk would stall the browser.
    static func sets(in root: URL) -> [ScannerReferenceSet] {
        var found: [ScannerReferenceSet] = []
        if let set = makeSet(at: root) { found.append(set) }
        let children = (try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        for child in children where isDirectory(child) {
            if let set = makeSet(at: child) {
                found.append(set)
            } else {
                // One more level: dataset roots keep their corpus in a
                // subfolder next to unrelated build artifacts.
                let grandchildren = (try? FileManager.default.contentsOfDirectory(
                    at: child,
                    includingPropertiesForKeys: [.isDirectoryKey],
                    options: [.skipsHiddenFiles]
                )) ?? []
                found.append(contentsOf: grandchildren.filter(isDirectory).compactMap(makeSet))
            }
        }
        return found.uniqued(by: \.id).sorted { $0.name < $1.name }
    }

    static func makeSet(at url: URL) -> ScannerReferenceSet? {
        guard isDirectory(url) else { return nil }
        let labels = loadLabels(near: url)
        if let set = makeRecordingSet(at: url, labels: labels) { return set }
        if let set = makeReplaySet(at: url, labels: labels) { return set }
        return makeImageSet(at: url, labels: labels)
    }

    // MARK: Recording bundles

    private static func makeRecordingSet(
        at url: URL,
        labels: [String: ScannerReferenceLabel]
    ) -> ScannerReferenceSet? {
        let manifest = url.appendingPathComponent("results.json")
        guard FileManager.default.fileExists(atPath: manifest.path),
              let data = try? Data(contentsOf: manifest),
              let bundle = try? JSONDecoder().decode(RecordedScanBundle.self, from: data)
        else { return nil }

        let items = bundle.frames.compactMap { frame -> ScannerReferenceItem? in
            let imageURL = url.appendingPathComponent(frame.imageFile)
            guard FileManager.default.fileExists(atPath: imageURL.path) else { return nil }
            let key = imageURL.deletingPathExtension().lastPathComponent
            return ScannerReferenceItem(
                id: frame.index,
                name: imageURL.lastPathComponent,
                imageURL: imageURL,
                expectation: labels[key]?.expectation
                    ?? recordedExpectation(for: frame),
                notes: labels[key]?.notes,
                baselineCardID: frame.identified ? frame.bestMatchCardId : nil,
                baselineConfidence: frame.confidence,
                annotations: []
            )
        }
        guard !items.isEmpty else { return nil }
        return ScannerReferenceSet(
            id: url.path,
            name: url.lastPathComponent,
            kind: .recording,
            rootURL: url,
            items: items
        )
    }

    /// A recording's own prediction is a baseline, not ground truth, so an
    /// unlabeled frame stays unlabeled — only explicit human labels in
    /// `results.json` become expectations.
    private static func recordedExpectation(for frame: RecordedScanFrame) -> ScannerReferenceExpectation {
        if frame.expectedNoMatch == true { return .outsideIndex }
        if let expected = frame.expectedCardId {
            return .card(id: expected, name: nil)
        }
        return .unlabeled
    }

    // MARK: Replay corpora

    private static func makeReplaySet(
        at url: URL,
        labels: [String: ScannerReferenceLabel]
    ) -> ScannerReferenceSet? {
        let manifest = url.appendingPathComponent("roboflow-ios-replay.json")
        guard FileManager.default.fileExists(atPath: manifest.path),
              let data = try? Data(contentsOf: manifest),
              let corpus = try? JSONDecoder().decode(ReplayCorpusManifest.self, from: data)
        else { return nil }

        let items = corpus.records.enumerated().compactMap { index, record -> ScannerReferenceItem? in
            let imageURL = url.appendingPathComponent(record.imagePath)
            let key = labelKey(for: imageURL)
            let width = CGFloat(record.width)
            let height = CGFloat(record.height)
            guard width > 0, height > 0 else { return nil }
            return ScannerReferenceItem(
                id: index,
                name: "\(record.dataset)/\(imageURL.lastPathComponent)",
                imageURL: imageURL,
                expectation: labels[key]?.expectation ?? .unlabeled,
                notes: labels[key]?.notes,
                baselineCardID: nil,
                baselineConfidence: nil,
                // COCO boxes are pixels from the top-left; Vision normalizes
                // from the bottom-left.
                annotations: record.annotations.compactMap { annotation in
                    guard annotation.bbox.count == 4 else { return nil }
                    return CGRect(
                        x: annotation.bbox[0] / width,
                        y: 1 - (annotation.bbox[1] + annotation.bbox[3]) / height,
                        width: annotation.bbox[2] / width,
                        height: annotation.bbox[3] / height
                    )
                }
            )
        }
        guard !items.isEmpty else { return nil }
        return ScannerReferenceSet(
            id: url.path,
            name: url.lastPathComponent,
            kind: .replayCorpus,
            rootURL: url,
            items: items
        )
    }

    // MARK: Plain image folders

    private static func makeImageSet(
        at url: URL,
        labels: [String: ScannerReferenceLabel]
    ) -> ScannerReferenceSet? {
        var files = imageFiles(in: url)
        if files.isEmpty {
            files = imageFiles(in: url.appendingPathComponent("images"))
        }
        guard !files.isEmpty else { return nil }
        let items = files.sorted { $0.lastPathComponent < $1.lastPathComponent }
            .enumerated()
            .map { index, imageURL in
                let key = labelKey(for: imageURL)
                return ScannerReferenceItem(
                    id: index,
                    name: imageURL.lastPathComponent,
                    imageURL: imageURL,
                    expectation: labels[key]?.expectation ?? .unlabeled,
                    notes: labels[key]?.notes,
                    baselineCardID: nil,
                    baselineConfidence: nil,
                    annotations: []
                )
            }
        return ScannerReferenceSet(
            id: url.path,
            name: url.lastPathComponent,
            kind: .images,
            rootURL: url,
            items: items
        )
    }

    private static func imageFiles(in url: URL) -> [URL] {
        let contents = (try? FileManager.default.contentsOfDirectory(
            at: url,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )) ?? []
        return contents.filter { imageExtensions.contains($0.pathExtension.lowercased()) }
    }

    // MARK: Labels

    /// Roboflow appends a content hash to every filename (`name.rf.<hash>.jpg`).
    /// Labels key off the stem before it so they survive a re-export.
    static func labelKey(for imageURL: URL) -> String {
        let filename = imageURL.lastPathComponent
        if let range = filename.range(of: ".rf.") {
            return String(filename[filename.startIndex..<range.lowerBound])
        }
        return imageURL.deletingPathExtension().lastPathComponent
    }

    private static func loadLabels(near url: URL) -> [String: ScannerReferenceLabel] {
        for candidate in [url, url.appendingPathComponent("images")] {
            let file = candidate.appendingPathComponent(labelsFilename)
            guard let data = try? Data(contentsOf: file),
                  let document = try? JSONDecoder().decode(ScannerReferenceLabelFile.self, from: data)
            else { continue }
            return document.labels
        }
        return [:]
    }

    private static func isDirectory(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory)
        return exists && isDirectory.boolValue
    }
}

// MARK: - Label file

nonisolated struct ScannerReferenceLabelFile: Codable {
    let schemaVersion: Int
    let labels: [String: ScannerReferenceLabel]
}

nonisolated struct ScannerReferenceLabel: Codable {
    /// `singleCard`, `cardBack`, `multiCard`, `foreignLanguage`, `outsideIndex`.
    let category: String
    let cardId: String?
    let name: String?
    let notes: String?

    var expectation: ScannerReferenceExpectation {
        switch category {
        case "singleCard":
            guard let cardId else { return .unlabeled }
            return .card(id: cardId, name: name)
        case "cardBack": return .cardBack
        case "multiCard": return .multipleCards
        case "foreignLanguage": return .foreignLanguage
        case "outsideIndex": return .outsideIndex
        default: return .unlabeled
        }
    }
}

// MARK: - Replay manifest

private nonisolated struct ReplayCorpusManifest: Decodable {
    struct Record: Decodable {
        let dataset: String
        let imagePath: String
        let width: Int
        let height: Int
        let annotations: [Annotation]
    }

    struct Annotation: Decodable {
        let bbox: [Double]
    }

    let records: [Record]
}

private extension Array {
    nonisolated func uniqued<Value: Hashable>(by keyPath: KeyPath<Element, Value>) -> [Element] {
        var seen: Set<Value> = []
        return filter { seen.insert($0[keyPath: keyPath]).inserted }
    }
}

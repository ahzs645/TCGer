import CoreGraphics
import Foundation
import ImageIO

/// One analyzed frame from a device scanner recording. The original decision
/// is retained as a baseline so future model/index builds can be compared.
nonisolated struct RecordedScanFrame: Codable {
    let index: Int
    let timestampSeconds: Double
    let mode: String
    let pipeline: String
    let elapsedMs: Double
    let detectedCount: Int
    let segmentationConfidence: Double?
    let quad: [[Double]]?
    let identified: Bool
    let bestMatchName: String?
    let bestMatchCardId: String?
    let bestMatchSetCode: String?
    let bestMatchSetName: String?
    let confidence: Double?
    let strategy: String?
    let alternatives: [String]
    /// Stable IDs were added after the original recorder format. Older bundles
    /// only contain alternative display names and continue to decode normally.
    let alternativeCardIds: [String]?
    /// Optional human labels. When absent, the recorded prediction remains the
    /// regression baseline so existing exported bundles stay useful.
    let expectedCardId: String?
    let expectedNoMatch: Bool?
    let imageFile: String
}

nonisolated struct RecordedScanBundle: Codable {
    struct Summary: Codable {
        let capturedAt: String
        let frameCount: Int
        let mode: String
        let pipeline: String
        let app: String
    }

    let summary: Summary
    let frames: [RecordedScanFrame]
}

struct ScannerReplayImport {
    let recording: RecordedScanBundle
    let images: [String: CGImage]
}

struct ScannerReplayFrameComparison: Identifiable {
    let id: Int
    let imageFile: String
    let baselineCardID: String?
    let expectedCardID: String?
    let expectsNoMatch: Bool
    let currentCardID: String?
    let currentTopFiveCardIDs: [String]
    let currentName: String?
    let currentConfidence: Double?
    let baselineStrategy: String?
    let currentStrategy: String?
    let elapsedMs: Double

    var isStable: Bool { baselineCardID == currentCardID }
    var isTopOneCorrect: Bool {
        expectsNoMatch ? currentCardID == nil : expectedCardID == currentCardID
    }
    var isTopFiveCorrect: Bool {
        expectsNoMatch ? currentCardID == nil : expectedCardID.map(currentTopFiveCardIDs.contains) ?? false
    }
    var isFalsePositiveRegression: Bool { expectsNoMatch && currentCardID != nil }
    var isMissRegression: Bool { expectedCardID != nil && currentCardID == nil }
    var didStrategyChange: Bool {
        guard let baselineStrategy, let currentStrategy else { return false }
        return baselineStrategy != currentStrategy
    }
}

struct ScannerReplayReport: Identifiable {
    let id = UUID()
    let totalFrames: Int
    let processedFrames: Int
    let stableFrames: Int
    let changedFrames: Int
    let topOneCorrectFrames: Int
    let positiveReferenceFrames: Int
    let topFiveHits: Int
    let falsePositiveRegressions: Int
    let missRegressions: Int
    let strategyChangedFrames: Int
    let meanLatencyMs: Double
    let p95LatencyMs: Double
    let comparisons: [ScannerReplayFrameComparison]

    var stabilityRate: Double {
        guard processedFrames > 0 else { return 0 }
        return Double(stableFrames) / Double(processedFrames)
    }

    var accuracyRate: Double {
        guard processedFrames > 0 else { return 0 }
        return Double(topOneCorrectFrames) / Double(processedFrames)
    }

    var topFiveRecall: Double {
        guard positiveReferenceFrames > 0 else { return 0 }
        return Double(topFiveHits) / Double(positiveReferenceFrames)
    }
}

struct CardScannerReplayRunner {
    let coordinator: CardScannerCoordinator

    func run(
        replay: ScannerReplayImport,
        context: CardScannerContext
    ) async -> ScannerReplayReport {
        var comparisons: [ScannerReplayFrameComparison] = []
        comparisons.reserveCapacity(replay.recording.frames.count)

        for frame in replay.recording.frames {
            guard let image = replay.images[frame.imageFile]
                ?? replay.images[URL(fileURLWithPath: frame.imageFile).lastPathComponent]
            else { continue }

            let started = ContinuousClock.now
            let result = await coordinator.scan(
                image: image,
                context: context,
                source: .livePreview
            )
            let elapsed = started.duration(to: .now)
            let elapsedMs = Double(elapsed.components.seconds) * 1_000
                + Double(elapsed.components.attoseconds) / 1_000_000_000_000_000

            let candidates: [CardScanCandidate]
            switch result {
            case .success(let scan): candidates = [scan.primary] + scan.alternatives
            case .failure: candidates = []
            }
            let candidate = candidates.first
            let baselineCardID = frame.identified ? frame.bestMatchCardId : nil
            let explicitlyNegative = frame.expectedNoMatch == true
            let expectedCardID = explicitlyNegative ? nil : (frame.expectedCardId ?? baselineCardID)
            let expectsNoMatch = explicitlyNegative
                || (frame.expectedCardId == nil && frame.expectedNoMatch == nil && baselineCardID == nil)

            comparisons.append(ScannerReplayFrameComparison(
                id: frame.index,
                imageFile: frame.imageFile,
                baselineCardID: baselineCardID,
                expectedCardID: expectedCardID,
                expectsNoMatch: expectsNoMatch,
                currentCardID: candidate?.details.identity.id,
                currentTopFiveCardIDs: candidates.prefix(5).map { $0.details.identity.id },
                currentName: candidate?.details.identity.name,
                currentConfidence: candidate?.confidence.score,
                baselineStrategy: frame.strategy,
                currentStrategy: candidate?.originatingStrategy.displayName,
                elapsedMs: elapsedMs
            ))
        }

        let latencies = comparisons.map(\.elapsedMs).sorted()
        let mean = latencies.isEmpty ? 0 : latencies.reduce(0, +) / Double(latencies.count)
        let p95Index = latencies.isEmpty
            ? 0
            : min(latencies.count - 1, Int((Double(latencies.count) * 0.95).rounded(.up)) - 1)
        let p95 = latencies.isEmpty ? 0 : latencies[p95Index]
        let stable = comparisons.filter(\.isStable).count
        let positiveReferences = comparisons.filter { $0.expectedCardID != nil }

        return ScannerReplayReport(
            totalFrames: replay.recording.frames.count,
            processedFrames: comparisons.count,
            stableFrames: stable,
            changedFrames: comparisons.count - stable,
            topOneCorrectFrames: comparisons.filter(\.isTopOneCorrect).count,
            positiveReferenceFrames: positiveReferences.count,
            topFiveHits: positiveReferences.filter(\.isTopFiveCorrect).count,
            falsePositiveRegressions: comparisons.filter(\.isFalsePositiveRegression).count,
            missRegressions: comparisons.filter(\.isMissRegression).count,
            strategyChangedFrames: comparisons.filter(\.didStrategyChange).count,
            meanLatencyMs: mean,
            p95LatencyMs: p95,
            comparisons: comparisons
        )
    }
}

enum ScannerReplayImportError: LocalizedError {
    case manifestMissing
    case manifestInvalid(Error)
    case framesMissing(expected: Int, loaded: Int)

    var errorDescription: String? {
        switch self {
        case .manifestMissing:
            return "Select an extracted scanner recording folder, or select results.json together with its frame images."
        case .manifestInvalid(let error):
            return "The scanner recording manifest is invalid: \(error.localizedDescription)"
        case .framesMissing(let expected, let loaded):
            return "The recording contains \(expected) frame references, but only \(loaded) images could be loaded."
        }
    }
}

enum ScannerReplayDocumentLoader {
    static func load(urls: [URL]) throws -> ScannerReplayImport {
        let securityScopedURLs = urls.filter { $0.startAccessingSecurityScopedResource() }
        defer { securityScopedURLs.forEach { $0.stopAccessingSecurityScopedResource() } }

        var files: [URL] = []
        for url in urls {
            files.append(contentsOf: expandedFiles(at: url))
        }
        guard let manifestURL = files.first(where: { $0.lastPathComponent == "results.json" })
            ?? files.first(where: { $0.pathExtension.lowercased() == "json" })
        else {
            throw ScannerReplayImportError.manifestMissing
        }

        let recording: RecordedScanBundle
        do {
            recording = try JSONDecoder().decode(
                RecordedScanBundle.self,
                from: try coordinatedData(from: manifestURL)
            )
        } catch {
            throw ScannerReplayImportError.manifestInvalid(error)
        }

        var images: [String: CGImage] = [:]
        let imageURLs = files.filter { ["jpg", "jpeg", "png", "heic"].contains($0.pathExtension.lowercased()) }
        for url in imageURLs {
            guard let source = CGImageSourceCreateWithData(try coordinatedData(from: url) as CFData, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { continue }
            images[url.lastPathComponent] = image
            if let frame = recording.frames.first(where: {
                URL(fileURLWithPath: $0.imageFile).lastPathComponent == url.lastPathComponent
            }) {
                images[frame.imageFile] = image
            }
        }

        guard images.count >= min(1, recording.frames.count) else {
            throw ScannerReplayImportError.framesMissing(
                expected: recording.frames.count,
                loaded: images.count
            )
        }
        return ScannerReplayImport(recording: recording, images: images)
    }

    private static func expandedFiles(at url: URL) -> [URL] {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) else {
            return []
        }
        guard isDirectory.boolValue else { return [url] }
        let keys: [URLResourceKey] = [.isRegularFileKey]
        let enumerator = FileManager.default.enumerator(
            at: url,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        )
        return (enumerator?.allObjects as? [URL] ?? []).filter { candidate in
            (try? candidate.resourceValues(forKeys: Set(keys)).isRegularFile) == true
        }
    }

    private static func coordinatedData(from url: URL) throws -> Data {
        return try Data(contentsOf: url)
    }
}

import CoreGraphics
import Foundation
import ImageIO
import XCTest
@testable import TCGer

/// Measures the `ScannerPerfOptions` speedups against recorded single-card
/// shutter captures, one flag at a time, over one warm coordinator so the
/// numbers isolate each flag's effect rather than cold-load costs.
///
/// Point DEVMODE_SESSIONS_DIR at a folder of scan-session-* directories via
/// `TEST_RUNNER_DEVMODE_SESSIONS_DIR=... xcodebuild test`. Optional:
/// `TEST_RUNNER_PERF_BENCH_FRAME_CAP` (default 24). Skips when unset.
///
/// This harness reports timing and outcome drift; accuracy regressions are
/// DevModeSessionReplayTests' job.
@MainActor
final class ScannerPerfOptionsBenchmarkTests: XCTestCase {
    private struct ResultsDocument: Decodable {
        struct Frame: Decodable {
            let imageFile: String
            let index: Int
            let pipeline: String?
        }
        let frames: [Frame]
    }

    private struct EvidenceRecord: Decodable {
        let imageFile: String
        let outcome: String
    }

    private struct Config {
        let name: String
        let enabledKeys: [String]
    }

    private static let allPerfKeys = [
        ScannerPerfOptions.vectorizedANNDefaultsKey,
        ScannerPerfOptions.allowedIndexCacheDefaultsKey,
        ScannerPerfOptions.stagedHypothesesDefaultsKey,
        ScannerPerfOptions.batchedOrientationDefaultsKey,
        ScannerPerfOptions.concurrentOrientationsDefaultsKey,
        ScannerPerfOptions.warmStartDefaultsKey,
    ]

    override func tearDown() {
        Self.allPerfKeys.forEach { UserDefaults.standard.removeObject(forKey: $0) }
        super.tearDown()
    }

    func testBenchmarkPerfOptionConfigurations() async throws {
        guard let dir = ProcessInfo.processInfo.environment["DEVMODE_SESSIONS_DIR"] else {
            throw XCTSkip("Set DEVMODE_SESSIONS_DIR to an unzipped Export All archive to run.")
        }
        let cap = ProcessInfo.processInfo.environment["PERF_BENCH_FRAME_CAP"]
            .flatMap(Int.init) ?? 24
        let frames = try collectSingleCardFrames(from: dir, cap: cap)
        XCTAssertFalse(frames.isEmpty, "no single-card photoCapture frames found under \(dir)")
        print("PERFBENCH frames: \(frames.count) single-card captures")

        let configs = [
            Config(name: "baseline (all off)", enabledKeys: []),
            Config(name: "vectorizedANN", enabledKeys: [ScannerPerfOptions.vectorizedANNDefaultsKey]),
            Config(name: "allowedIndexCache", enabledKeys: [ScannerPerfOptions.allowedIndexCacheDefaultsKey]),
            Config(name: "stagedHypotheses", enabledKeys: [ScannerPerfOptions.stagedHypothesesDefaultsKey]),
            Config(name: "batchedOrientation", enabledKeys: [ScannerPerfOptions.batchedOrientationDefaultsKey]),
            Config(name: "concurrentOrientations", enabledKeys: [ScannerPerfOptions.concurrentOrientationsDefaultsKey]),
            Config(name: "all on", enabledKeys: Self.allPerfKeys),
        ]

        let coordinator = CardScannerCoordinator.makeDefault()
        var outcomesByConfig: [String: [String]] = [:]
        var baselineOutcomes: [String] = []

        for config in configs {
            Self.allPerfKeys.forEach { UserDefaults.standard.set(false, forKey: $0) }
            config.enabledKeys.forEach { UserDefaults.standard.set(true, forKey: $0) }

            // Untimed warm-up: model/index cold loads and this config's lazy
            // representations (flat ANN buffer, index memo) build here.
            _ = await scan(frames[0].image, with: coordinator)

            var durations: [Double] = []
            var outcomes: [String] = []
            for frame in frames {
                let started = Date()
                let cardID = await scan(frame.image, with: coordinator)
                durations.append(Date().timeIntervalSince(started) * 1_000)
                outcomes.append(cardID ?? "noMatch")
            }
            outcomesByConfig[config.name] = outcomes
            if config.name.hasPrefix("baseline") { baselineOutcomes = outcomes }

            let sorted = durations.sorted()
            let median = sorted[sorted.count / 2]
            let p90 = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.9))]
            let mean = durations.reduce(0, +) / Double(durations.count)
            let drift = zip(outcomes, baselineOutcomes).filter { $0 != $1 }.count
            print(String(
                format: "PERFBENCH %@: median %.0fms  p90 %.0fms  mean %.0fms  total %.1fs  outcome drift %d/%d",
                config.name, median, p90, mean,
                durations.reduce(0, +) / 1_000, drift, outcomes.count
            ))
            for (index, pair) in zip(outcomes, baselineOutcomes).enumerated() where pair.0 != pair.1 {
                print("PERFBENCH   drift \(frames[index].key): \(pair.1) -> \(pair.0)")
            }
        }

        // The pure-performance flags must not change outcomes. Staged
        // hypotheses may (ordering change) — reported above, judged by the
        // replay suite, not asserted here.
        for name in ["vectorizedANN", "allowedIndexCache", "batchedOrientation", "concurrentOrientations"] {
            XCTAssertEqual(
                outcomesByConfig[name], baselineOutcomes,
                "\(name) is a pure optimization and must not change scan outcomes"
            )
        }
    }

    /// Per-stage profile under the current defaults: scans the corpus frames
    /// with a diagnostics collector attached and aggregates the recorded
    /// embed/ANN/OCR/detect milliseconds — the split that says whether the
    /// model, retrieval, or OCR deserves the next optimization (or a model
    /// retrain). Simulator proportions are CPU-skewed; the device recording
    /// pipeline now captures the same fields for ground truth.
    func testStageTimingProfile() async throws {
        guard let dir = ProcessInfo.processInfo.environment["DEVMODE_SESSIONS_DIR"] else {
            throw XCTSkip("Set DEVMODE_SESSIONS_DIR to an unzipped Export All archive to run.")
        }
        let cap = ProcessInfo.processInfo.environment["PERF_BENCH_FRAME_CAP"]
            .flatMap(Int.init) ?? 16
        let frames = try collectSingleCardFrames(from: dir, cap: cap)
        XCTAssertFalse(frames.isEmpty)

        let coordinator = CardScannerCoordinator.makeDefault()
        _ = await scan(frames[0].image, with: coordinator)

        var totals: [String: Double] = [:]
        var elapsedTotal: Double = 0
        for frame in frames {
            let diagnostics = ScanDiagnostics()
            var context = CardScannerContext.test(engine: .localOnly)
            context.diagnostics = diagnostics
            let started = Date()
            _ = await coordinator.scan(image: frame.image, context: context, source: .photoCapture)
            elapsedTotal += Date().timeIntervalSince(started) * 1_000
            for (stage, ms) in diagnostics.stageTimings {
                totals[stage, default: 0] += ms
            }
            for attempt in diagnostics.attempts {
                totals["embed", default: 0] += attempt.embedMs ?? 0
                totals["ann", default: 0] += attempt.annMs ?? 0
                totals["titleOCR", default: 0] += attempt.titleOCRMs ?? 0
                totals["footerOCR", default: 0] += attempt.footerOCRMs ?? 0
            }
        }
        let accounted = totals.values.reduce(0, +)
        print(String(format: "STAGEPROF frames %d  wall %.1fs  accounted %.1fs (%.0f%%)",
                     frames.count, elapsedTotal / 1_000, accounted / 1_000,
                     100 * accounted / max(elapsedTotal, 1)))
        for (stage, ms) in totals.sorted(by: { $0.value > $1.value }) {
            print(String(format: "STAGEPROF   %@ %.1fs (%.0f%% of wall)",
                         stage, ms / 1_000, 100 * ms / max(elapsedTotal, 1)))
        }
    }

    private struct BenchFrame {
        let key: String
        let image: CGImage
    }

    private func scan(_ image: CGImage, with coordinator: CardScannerCoordinator) async -> String? {
        let result = await coordinator.scan(
            image: image,
            context: .test(engine: .localOnly),
            source: .photoCapture
        )
        guard case .success(let scan) = result else { return nil }
        return scan.primary.details.identity.id
    }

    /// Single-card shutter captures only: binder pages and manual-correction
    /// records are excluded via the evidence sidecar, live frames via the
    /// recorded pipeline tag. The cap samples evenly across the corpus so one
    /// long session cannot dominate.
    private func collectSingleCardFrames(from dir: String, cap: Int) throws -> [BenchFrame] {
        let root = URL(fileURLWithPath: dir, isDirectory: true)
        let sessions = ((try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey]
        )) ?? []).filter {
            FileManager.default.fileExists(atPath: $0.appendingPathComponent("results.json").path)
        }.sorted { $0.lastPathComponent < $1.lastPathComponent }

        var candidates: [(key: String, url: URL)] = []
        for session in sessions {
            guard let document = try? JSONDecoder().decode(
                ResultsDocument.self,
                from: Data(contentsOf: session.appendingPathComponent("results.json"))
            ) else { continue }
            let evidence = (try? JSONDecoder().decode(
                [EvidenceRecord].self,
                from: Data(contentsOf: session.appendingPathComponent("evidence.json"))
            )) ?? []
            let excluded = Set(evidence.lazy.filter {
                $0.outcome.hasPrefix("binderPage") || $0.outcome.hasPrefix("manualCorrection")
            }.map(\.imageFile))
            for frame in document.frames.sorted(by: { $0.index < $1.index }) {
                guard frame.pipeline?.contains("photoCapture") == true,
                      !excluded.contains(frame.imageFile)
                else { continue }
                candidates.append((
                    key: "\(session.lastPathComponent)/\(frame.imageFile)",
                    url: session.appendingPathComponent(frame.imageFile)
                ))
            }
        }

        let stride = max(1, candidates.count / max(1, cap))
        var frames: [BenchFrame] = []
        for (offset, candidate) in candidates.enumerated()
        where offset % stride == 0 && frames.count < cap {
            guard let source = CGImageSourceCreateWithURL(candidate.url as CFURL, nil),
                  let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
            else { continue }
            frames.append(BenchFrame(key: candidate.key, image: image))
        }
        return frames
    }
}

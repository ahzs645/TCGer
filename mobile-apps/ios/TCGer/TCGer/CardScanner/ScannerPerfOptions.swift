import Foundation

/// Scanner performance options, individually toggleable so the speedups can
/// be A/B measured against the unmodified pipeline.
///
/// Validated options are ON by default (device session 2026-08-21 plus the
/// 287-frame replay matrix: identical outcome summaries, with every
/// divergent frame equal-or-better); options whose benefit is still
/// hardware-dependent stay opt-in. An explicit UserDefaults value always
/// wins over the default, so a toggle switched off in the dev-mode Speed
/// section stays off.
///
/// Two control surfaces, in precedence order:
/// 1. Environment variables (`SCANNER_PERF_*` = "1"/"true"/"0"/"false") so
///    xcodebuild test runs can drive a configuration via `TEST_RUNNER_`
///    passthrough without touching persisted state.
/// 2. `UserDefaults` keys, surfaced as toggles in the Scanner Options
///    popover's Speed section (visible only with Scanner Debug enabled).
///
/// The flags are read at call time on purpose: a benchmark can flip one
/// between passes over the same warm coordinator and isolate that flag's
/// effect from cold-load costs.
nonisolated enum ScannerPerfOptions {
    /// ANN retrieval as one vDSP matrix-vector product over a flat,
    /// contiguous row-major buffer with precomputed row norms, followed by an
    /// exact scalar-Double re-rank of the shortlist so returned distances are
    /// bit-identical to the legacy path. ON by default.
    static let vectorizedANNDefaultsKey = "scannerPerfVectorizedANN"
    static var isVectorizedANNEnabled: Bool {
        flag(vectorizedANNDefaultsKey, environment: "SCANNER_PERF_VECTORIZED_ANN", defaultValue: true)
    }

    /// Memoize `CardIndexMetadataStore.physicalCardIndices` per
    /// (game, setCode) instead of re-filtering all catalog entries and
    /// rebuilding a Set on every crop-attempt recognition. ON by default.
    static let allowedIndexCacheDefaultsKey = "scannerPerfAllowedIndexCache"
    static var isAllowedIndexCacheEnabled: Bool {
        flag(allowedIndexCacheDefaultsKey, environment: "SCANNER_PERF_ALLOWED_INDEX_CACHE", defaultValue: true)
    }

    /// Staged crop hypotheses — embed and recognize the baseline crop first
    /// and only build the alternate-box / whole-frame hypotheses when the
    /// previous one abstained, instead of embedding every hypothesis (and
    /// both orientations of each) up front. Replay-validated 2026-08-21:
    /// identical summary to the legacy order over 287 frames, with all nine
    /// divergent frames equal-or-better. ON by default.
    static let stagedHypothesesDefaultsKey = "scannerPerfStagedHypotheses"
    static var isStagedHypothesesEnabled: Bool {
        flag(stagedHypothesesDefaultsKey, environment: "SCANNER_PERF_STAGED_HYPOTHESES", defaultValue: true)
    }

    /// Run the 0°/180° orientation pair of one crop through a single Core ML
    /// batch prediction. OPT-IN: the CPU-only Simulator control run measured
    /// it slightly slower than serial requests; its case rests on device ANE
    /// batch dispatch and is still unproven there.
    static let batchedOrientationDefaultsKey = "scannerPerfBatchedOrientation"
    static var isBatchedOrientationEnabled: Bool {
        flag(batchedOrientationDefaultsKey, environment: "SCANNER_PERF_BATCHED_ORIENTATION", defaultValue: false)
    }

    /// Warm start: preload the heavy scanner assets (embedding model + ANE
    /// compilation, detector/Vision first-use, ANN index, catalog metadata)
    /// in the background when the scanner opens, instead of lazily inside the
    /// first shutter press. Device evidence 2026-08-21: the first capture of
    /// a session took 3.3 s where an identical warm capture took 258 ms.
    /// ON by default.
    static let warmStartDefaultsKey = "scannerPerfWarmStart"
    static var isWarmStartEnabled: Bool {
        flag(warmStartDefaultsKey, environment: "SCANNER_PERF_WARM_START", defaultValue: true)
    }

    /// Evaluate the two semantic orientations of one crop hypothesis
    /// concurrently instead of serially. Combination policy is unchanged —
    /// both orientations still always run and arbitrate afterwards — so
    /// outcomes are order-independent; only wall time changes. Default is
    /// data-driven per the benchmark/replay runs recorded in the README.
    static let concurrentOrientationsDefaultsKey = "scannerPerfConcurrentOrientations"
    static var isConcurrentOrientationsEnabled: Bool {
        flag(concurrentOrientationsDefaultsKey, environment: "SCANNER_PERF_CONCURRENT_ORIENTATIONS", defaultValue: true)
    }

    /// Fast shutter capture: `.balanced` photo quality prioritization and a
    /// sensor still capped near the pipeline's real input size, instead of
    /// `.quality` (multi-frame fusion, 300–1200 ms of post-shutter
    /// processing) at maximum sensor dimensions. The decode path downsamples
    /// every capture to 2048 px before recognition, so the extra pixels and
    /// fusion latency were being paid and then discarded. ON by default.
    static let fastCaptureDefaultsKey = "scannerPerfFastCapture"
    static var isFastCaptureEnabled: Bool {
        flag(fastCaptureDefaultsKey, environment: "SCANNER_PERF_FAST_CAPTURE", defaultValue: true)
    }

    private static func flag(
        _ defaultsKey: String,
        environment name: String,
        defaultValue: Bool
    ) -> Bool {
        if let raw = ProcessInfo.processInfo.environment[name] {
            switch raw.lowercased() {
            case "1", "true", "yes": return true
            case "0", "false", "no": return false
            default: break
            }
        }
        guard UserDefaults.standard.object(forKey: defaultsKey) != nil else {
            return defaultValue
        }
        return UserDefaults.standard.bool(forKey: defaultsKey)
    }
}

import Foundation

/// Experimental scanner performance options, each individually toggleable so
/// the speedups can be A/B measured against the unmodified pipeline. Every
/// option defaults to OFF: with no flag set the scanner behaves exactly as it
/// did before these options existed.
///
/// Two control surfaces, in precedence order:
/// 1. Environment variables (`SCANNER_PERF_*` = "1"/"true"/"0"/"false") so
///    xcodebuild test runs can drive a configuration via `TEST_RUNNER_`
///    passthrough without touching persisted state.
/// 2. `UserDefaults` keys, for in-process toggling (benchmarks, a future
///    debug-menu switch).
///
/// The flags are read at call time on purpose: a benchmark can flip one
/// between passes over the same warm coordinator and isolate that flag's
/// effect from cold-load costs.
nonisolated enum ScannerPerfOptions {
    /// Item 1: ANN retrieval as one vDSP matrix-vector product over a flat,
    /// contiguous row-major buffer with precomputed row norms, instead of the
    /// per-row scalar Double cosine loop.
    static let vectorizedANNDefaultsKey = "scannerPerfVectorizedANN"
    static var isVectorizedANNEnabled: Bool {
        flag(vectorizedANNDefaultsKey, environment: "SCANNER_PERF_VECTORIZED_ANN")
    }

    /// Item 2: memoize `CardIndexMetadataStore.physicalCardIndices` per
    /// (game, setCode) instead of re-filtering all catalog entries and
    /// rebuilding a Set on every crop-attempt recognition.
    static let allowedIndexCacheDefaultsKey = "scannerPerfAllowedIndexCache"
    static var isAllowedIndexCacheEnabled: Bool {
        flag(allowedIndexCacheDefaultsKey, environment: "SCANNER_PERF_ALLOWED_INDEX_CACHE")
    }

    /// Item 3: staged crop hypotheses — embed and recognize the baseline crop
    /// first and only build the alternate-box / whole-frame hypotheses when
    /// the previous one abstained, instead of embedding every hypothesis (and
    /// both orientations of each) up front. Changes hypothesis evaluation
    /// order from gate-score-sorted to fixed priority, so it must be validated
    /// against the replay matrix before shipping on by default.
    static let stagedHypothesesDefaultsKey = "scannerPerfStagedHypotheses"
    static var isStagedHypothesesEnabled: Bool {
        flag(stagedHypothesesDefaultsKey, environment: "SCANNER_PERF_STAGED_HYPOTHESES")
    }

    /// Item 5: run the 0°/180° orientation pair of one crop through a single
    /// Core ML batch prediction instead of two serial requests. Batching
    /// amortizes per-request dispatch overhead (largest on ANE device builds).
    static let batchedOrientationDefaultsKey = "scannerPerfBatchedOrientation"
    static var isBatchedOrientationEnabled: Bool {
        flag(batchedOrientationDefaultsKey, environment: "SCANNER_PERF_BATCHED_ORIENTATION")
    }

    /// Warm start: preload the heavy scanner assets (embedding model + ANE
    /// compilation, detector/Vision first-use, ANN index, catalog metadata)
    /// in the background when the scanner opens, instead of lazily inside the
    /// first shutter press. Device evidence 2026-08-21: the first capture of
    /// a session took 3.3 s where an identical warm capture took 258 ms.
    static let warmStartDefaultsKey = "scannerPerfWarmStart"
    static var isWarmStartEnabled: Bool {
        flag(warmStartDefaultsKey, environment: "SCANNER_PERF_WARM_START")
    }

    private static func flag(_ defaultsKey: String, environment name: String) -> Bool {
        if let raw = ProcessInfo.processInfo.environment[name] {
            switch raw.lowercased() {
            case "1", "true", "yes": return true
            case "0", "false", "no": return false
            default: break
            }
        }
        return UserDefaults.standard.bool(forKey: defaultsKey)
    }
}

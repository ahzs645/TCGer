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
    /// User-facing master switch for all on-device title and collector-number
    /// OCR. Unlike the developer-only speed toggles below, this is a durable
    /// product preference surfaced in Settings and Scanner Options. Visual
    /// retrieval continues to run when disabled; it simply cannot use text
    /// evidence to rescue or disambiguate a match.
    static let ocrEnabledDefaultsKey = "scannerOCREnabled"
    static var isOCREnabled: Bool {
        flag(ocrEnabledDefaultsKey, environment: "SCANNER_OCR_ENABLED", defaultValue: true)
    }

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

    /// Warm start: after the first camera frame, preload only the selected
    /// game's primary recognizer in the background. An early shutter press
    /// captures immediately and awaits the same single-flight preparation
    /// task. Device evidence 2026-08-21: the first capture of a session took
    /// 3.3 s where an identical warm capture took 258 ms. ON by default.
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

    /// Fast-first footer OCR: read the collector number with `.fast` (a
    /// different, much cheaper Vision pipeline) and fall back to `.accurate`
    /// only when the fast pass extracts nothing usable. The NNN/NNN regex
    /// layer is the error corrector, mirroring Apple's real-time phone-number
    /// sample. A fast reading that fails to confirm any shortlist candidate
    /// gets one `.accurate` rescue read, so accuracy-bearing decisions never
    /// rest on the fast pass alone. Replay-validated identical to baseline
    /// 2026-08-22; −20% median in the Simulator control. ON by default.
    static let fastFooterOCRDefaultsKey = "scannerPerfFastFooterOCR"
    static var isFastFooterOCREnabled: Bool {
        flag(fastFooterOCRDefaultsKey, environment: "SCANNER_PERF_FAST_FOOTER_OCR", defaultValue: true)
    }

    /// Lean OCR strips: the FAST footer pass reads the unscaled strip with a
    /// raised `minimumTextHeight` instead of the 4x upscale. Applies only in
    /// combination with `isFastFooterOCREnabled`; `.accurate` reads always
    /// keep their upscale — the original full-lean variant measurably lost
    /// labeled accepts on the replay corpus when accurate reads went lean
    /// too (2026-08-22), which is why it was scoped down. The fast-only
    /// variant replayed byte-identical to baseline. ON by default.
    static let leanOCRStripsDefaultsKey = "scannerPerfLeanOCRStrips"
    static var isLeanOCRStripsEnabled: Bool {
        flag(leanOCRStripsDefaultsKey, environment: "SCANNER_PERF_LEAN_OCR_STRIPS", defaultValue: true)
    }

    /// Footer-first OCR ordering: when OCR evidence is needed, read the
    /// (cheap) collector number before the (expensive) title, skip the title
    /// pass entirely once the collector number confirms a candidate, and
    /// re-match the same footer reading after a title constraint instead of
    /// reading again. Vision serializes text requests globally, so the win
    /// comes from running fewer passes, not from parallelism. Targets the
    /// device profile's biggest line item (title OCR, 31–44% of scan wall
    /// time). Replay-validated identical to baseline 2026-08-22. ON by
    /// default.
    static let footerFirstOCRDefaultsKey = "scannerPerfFooterFirstOCR"
    static var isFooterFirstOCREnabled: Bool {
        flag(footerFirstOCRDefaultsKey, environment: "SCANNER_PERF_FOOTER_FIRST_OCR", defaultValue: true)
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

# Scanner performance chart map

All recognition charts use one model run per row/point and the same reviewed
iOS replay cohort. Canonical reference, synthetic/augmented, and real-camera
results must be rendered as separate cohorts rather than pooled.

| Output | Analytical question | Form | Fields | Supported reading |
| --- | --- | --- | --- | --- |
| `model-metrics.png` | How do runs compare on recognition quality? | Grouped horizontal line-bars | precision, recall, F1 | Overall run comparison on a common denominator |
| `name-vs-printing.png` | Is the Pokémon recognized when the exact printing is not? | Paired dot-and-interval | name recall, exact-printing recall, Wilson intervals | Identity-stage gap and sampling uncertainty |
| `speed-vs-quality.png` | What quality/latency trade-off does each run make? | Labelled scatter | mean elapsed milliseconds, F1 | Faster/high-quality candidates and dominated runs |
| `failure-composition.png` | What outcomes make up each scored cohort? | 100% stacked horizontal bars | correct, declined, wrong, false positive, missed | Error composition with raw counts |
| `positive-card-stages.png` | Where do positive-card recognition results drop? | Ordered stage bars | positives, accepted positives, correct name, correct printing | Recognition-only progression for the best-F1 run |

The shared palette uses blue, gold, orange, olive, pink, and neutral grey with
direct labels/ordering so color is not the only distinction. Each output is a
1200×620 PNG; `model-performance-dashboard.png` combines all five charts and a
coverage-notes panel. The final QA surface is the dashboard PNG opened at full
resolution and the individual PNGs at laptop width.

A detector-to-rectification funnel is intentionally omitted until geometry
runs provide mask IoU, corner error, and rectification-validity measurements.

## Extended diagnostic dashboards

| Dashboard | Analytical question | Forms | Data sufficiency and fallback |
| --- | --- | --- | --- |
| Decision quality | How should acceptance thresholds be selected, and can confidence be trusted? | risk-coverage lines, quantile reliability diagram, model-by-threshold heatmap, ranked accepted-error bars | Uses accepted predictions from the 43-image scored replay cohort; calibration is marked exploratory while accepted n is small |
| Geometry | Are masks, boundaries, corners, and rectifications accurate? | reference coverage bars, perspective histogram, IoU/corner ECDFs, failure composition | Reference panels render now; prediction panels show an explicit availability state until `import-geometry` supplies results |
| Robustness | Which data sources and perspective conditions cause failures? | source-metric heatmap, provenance interval bars, perspective-tercile bars, condition coverage | Uses the best-F1 run and retains per-cell n; blur/glare/occlusion remain unavailable until tagged |
| OCR/reference | Does OCR add name or exact-print evidence? | separate-cohort benchmark bars and instrumentation coverage panels | Existing Sinnoh video summary stays separate; an evidence curve is omitted until per-sample OCR text/token counts are logged |
| Session stability | Are repeated attempts stable within real device sessions, and which recorded capture conditions coincide with abstentions? | frame-confidence timeline, attempt outcome bars, capture-condition outcome composition, quad-jitter distribution, within-frame agreement ranking | Capture evidence is currently available for 92 recent attempt crops; diagnostic only because real-session originals are not yet human-labelled |

These dashboards use the existing 1200×620 panel footprint and are combined as
two-column PNGs for FiftyOne's `ImageView`. Lines use direct labels or distinct
markers; heatmaps print values and denominators; unavailable panels state the
missing fields rather than rendering zeros.

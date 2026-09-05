# Shared card-geometry bake-off — 2026-09-04

**Recommendation:** ship none of the candidates; retain the current detector and the 0°/180° recognition safety net.

The comparison is bound to one production training corpus, one real evaluation corpus, one synthetic duel-field corpus, and one effective fairness identity:

- Training corpus: `a8d9d7b77506883316d4660bd2d85449befe9d26a7ac84198a6475e16ac250cc`
- Real evaluation: `7a75cc5ba2f0ac429136fa67f75b473e09c05f6edaee112bf0f5b1ba701a188a`
- Synthetic evaluation: `bda45771be01d50bde130b6a68afe91ad509154df9aa26050f9cfdf30aad809a`
- Effective fairness: `4bf8b82e00a845381b9217cb835e750335e30436fb031f088f86949265ba2509`

## Results

| Candidate | License route | Real R@.5 | Real R@.75 | Corner p50 | p90 | p95 | Outside p50 | Synthetic R@.75 | Correct / wrong / abstain | ONNX MB | Core ML MB | Min parity cosine | Train L4 h | Recovery L4 h | Total L4 h | Production ready |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| yolo11n-pose | evaluation-only | 0.627 | 0.323 | 0.127 | 0.643 | 1.257 | 0.280 | 0.848 | 3 / 1 / 10 | 11.0 | 11.0 | 1.000000 | 1.06 | 0.00 | 1.06 | no |
| yolo11s-pose | evaluation-only | 0.559 | 0.301 | 0.123 | 0.580 | 1.051 | 0.206 | 0.866 | 3 / 1 / 8 | 39.1 | 39.1 | 1.000000 | 1.58 | 0.00 | 1.58 | no |
| yolox-pose | permissive | 0.017 | 0.000 | 0.203 | 0.951 | 0.985 | 0.162 | 0.000 | 0 / 0 / 15 | 42.9 | 21.6 | 0.999788 | 4.35 | 1.22 | 5.57 | no |
| fastvit-t8-four-corner | permissive | 0.000 | 0.000 | — | — | — | — | 0.015 | 0 / 0 / 15 | 19.2 | 9.7 | 0.999977 | 4.24 | 0.00 | 4.24 | no |

Corner errors are normalized by the mean truth-quad side length. Recognition counts exclude outcomes whose catalog identity is unavailable and preserve those as `unknown` in the JSON report.

The frozen recognition truth contains verified card identities for Magic and Pokémon only. Yu-Gi-Oh frames are included in the frozen geometry evaluation, but they do not yet have human-verified catalog identities and therefore cannot enter correct/wrong recognition scoring. That missing human ground truth does not change the ship-none recommendation because every candidate already fails the real-camera geometry gates.

## Gates

- **yolo11n-pose:** failed `realRecallAt05`, `realRecallAt075`, `normalizedCornerP50`, `normalizedCornerP90`, `normalizedCornerP95`, `outsideFrameNormalizedP50`, `duplicates`, `extras`, `wrongAccepts`, `physicalIosLatency`, `physicalAndroidLatency`, `productionDecoders`, `shippingLicense`.
- **yolo11s-pose:** failed `realRecallAt05`, `realRecallAt075`, `normalizedCornerP50`, `normalizedCornerP90`, `normalizedCornerP95`, `outsideFrameNormalizedP50`, `duplicates`, `extras`, `wrongAccepts`, `physicalIosLatency`, `physicalAndroidLatency`, `productionDecoders`, `shippingLicense`.
- **yolox-pose:** failed `realRecallAt05`, `realRecallAt075`, `normalizedCornerP50`, `normalizedCornerP90`, `normalizedCornerP95`, `outsideFrameNormalizedP50`, `extras`, `physicalIosLatency`, `physicalAndroidLatency`, `productionDecoders`.
- **fastvit-t8-four-corner:** failed `realRecallAt05`, `realRecallAt075`, `normalizedCornerP50`, `normalizedCornerP90`, `normalizedCornerP95`, `outsideFrameNormalizedP50`, `extras`, `physicalIosLatency`, `physicalAndroidLatency`, `productionDecoders`.

Physical iPhone and Android latency are production gates. An unavailable device is reported as unmeasured, never treated as a pass. Reference decoders and golden raw-tensor fixtures do not count as completed Swift, Kotlin, and TypeScript production integrations.

## Human decisions remaining

- No Ultralytics-derived export may be published to the asset store unless AGPL compliance or an Enterprise license is deliberately chosen.
- Publishing any replacement detector remains a human release decision after the measured recommendation and physical-device latency gate are reviewed.

## Reproduction

`comparison.json` is the canonical deterministic report. `comparison-spec.json` binds its inputs, candidate jobs, decoder sources, and human-only gates; all referenced input files carry SHA-256 identities inside the report.

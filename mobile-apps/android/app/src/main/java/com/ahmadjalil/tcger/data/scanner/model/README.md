# Android embedding recognition runtime

This package contains the real Android inference path for the default TCGer
ArcFace recognizer. ArcFace is wired into the on-device scanner; the runtime,
artifact validation, catalog matching, and connected tests keep its complete
model/index/threshold contract reviewable as one unit.

## ArcFace bundle contract

The Gradle `prepareScannerModelAssets` task stages exactly three files under
Production builds no longer ship game-specific recognition files under
`assets/scan-index/`. The checked-in historical fixtures live under
`mobile-apps/android/scanner-evaluation-assets/scan-index/`; the app installs
the current model, vectors, and metadata together from the published scanner
manifest when a user first opens that game's scanner.

| Asset | Source | Raw size |
| --- | --- | ---: |
| `card-embeddings-arcface-fp32.onnx` | Android `scanner-evaluation-assets/scan-index` | 15,014,526 B |
| `CardsIndexVectors-arcface.bin` | iOS `Resources/ScanIndex` | 8,381,960 B |
| `CardsIndexMetadata.json` | iOS `Resources/ScanIndex` | 4,314,177 B |

`ArcFaceModelBundle.load` verifies the exact byte size and SHA-256 of all
three files. This is intentional: a model, embedding index, metadata ordering,
threshold, and ambiguity margin are one calibrated artifact and must not be
mixed across generations.

The Android model is a deterministic fp32 expansion of the existing web fp16
ONNX (`a5d867...abd2b5`). It preserves the fp16 checkpoint values, expands its
240 fp16 initializers to fp32, and removes only the input/output casts that put
the full graph into fp16 arithmetic. This is necessary because the official
Android arm64 CPU runtime produced materially different embeddings for the
fp16 graph, even though its input tensor matched the host reference. The fp32
graph matches the host output and index. The inference contract otherwise
matches the web and iOS ArcFace export:

- input `pixel_values`, float32 NCHW `[1, 3, 224, 224]`;
- orient from EXIF, resize the shortest edge to 256, then center-crop 224;
- RGB values in `[0, 1]` (ImageNet normalization is baked into this ONNX);
- output `embedding`, float32 `[1, 384]`, then L2 normalize;
- exact cosine search over the matching packed signed-int8 catalog index;
- physical Pokémon rows only (digital Pocket rows are excluded);
- accept at similarity `>= 0.60` with a top-two distinct-card margin `>= 0.05`.

The matcher is exact brute-force search over 21,828 x 384 values. That is a
useful correctness baseline. Profile it on target low/mid/high Android devices
before considering an approximate index or SIMD/JNI implementation.

## Runtime and size

The app pins the official Maven artifact
`com.microsoft.onnxruntime:onnxruntime-android:1.24.3`. ONNX Runtime's official
Java guide documents Maven artifacts and the `OrtEnvironment` / `OrtSession` /
`OnnxTensor` lifecycle, and its mobile guide recommends measuring model size,
binary size, latency, and power on target devices:

- https://onnxruntime.ai/docs/get-started/with-java.html
- https://onnxruntime.ai/docs/tutorials/mobile/
- https://onnxruntime.ai/docs/build/android.html

The full 1.24.3 AAR is large: its local Gradle cache is about 39 MiB compressed,
and the universal debug APK contains roughly 107 MiB of uncompressed ONNX
Runtime native libraries across four ABIs. An arm64 delivery includes about
25.9 MiB of `libonnxruntime.so` plus 0.1 MiB JNI, before the scanner assets.
The three scanner assets compress to about 13.6 MiB in the current APK. Use an
Android App Bundle to split ABIs. Before production, build a reduced-operator
ORT Mobile AAR for this model if download size is unacceptable; keep the full
runtime until the reduced build is validated on the replay corpus.

The session explicitly enables XNNPACK with ONNX Runtime's recommended mobile
threading configuration (ORT intra-op one thread and no spinning; XNNPACK owns
the device-sized pool). Unsupported nodes fall back to the CPU provider. This
configuration passes the arm64 emulator parity fixture, but phone-class
latency, thermals, and power still need measurement:

- https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html

Do not apply dynamic int8 quantization to this FastViT model. The repository's
export notes record that it damages the re-parameterized convolution graph.

## Distribution and clean-clone blockers

- ONNX Runtime is MIT licensed. Preserve its license and third-party notices:
  https://github.com/microsoft/onnxruntime/blob/main/LICENSE
- FastViT architecture code is distributed under Apple's `ml-fastvit` license
  and has separate acknowledgements. That license does **not** establish the
  provenance or redistribution rights of this in-house trained checkpoint:
  https://github.com/apple/ml-fastvit/blob/main/LICENSE
- The source web fp16 ONNX and generated web manifests are Git-ignored. The
  Android fp32 derivative is stored under `src/main/assets` so a clean Android
  build has its model, but its source checkpoint/export remains an external
  artifact. Prefer Git LFS for this 15 MB binary and retain the source hash and
  deterministic conversion record.
- No model card, training-data provenance record, or redistribution notice is
  shipped beside the in-house checkpoint. Resolve that, plus catalog/card-image
  data rights, before distributing the model in a store build.

## DINOv2 rollback runtime

Android now has a real, independently loadable DINOv2 rollback runtime. It is
an atomic, checksum-locked bundle and must never be mixed with ArcFace assets:

| Asset | Raw size | SHA-256 |
| --- | ---: | --- |
| `card-embeddings-dinov2-q8.onnx` | 24,446,700 B | `c179f8...97efb` |
| `CardsIndexVectors.bin` | 8,381,960 B | `68cf84...fa729` |
| `CardFaceGate.json` | 20,899 B | `75721d...0a41e` |
| `CardsIndexMetadata.json` | 4,314,177 B | `e1b4ed...18141` |

The ONNX file is `onnx/model_quantized.onnx` from
`onnx-community/dinov2-small` revision
`8b1f705a3a7f6f062f6bdd21986c1583d3ef105d`. Transformers.js maps the web
manifest's `dtype: q8` to that `_quantized` suffix. The file derives from
`facebook/dinov2-small`; the repository's Core ML conversion pins the source
weights revision `ed25f3a31f01632728cabb09d1542f84ab7b0056`.

The Android path performs shortest-edge resize to 256, center crop to 224,
ImageNet RGB normalization, takes the first/CLS token of the `[1,257,384]`
`last_hidden_state`, L2-normalizes it, searches the matching signed-int8 index,
then applies the matching logistic card-face gate and the calibrated `0.72`
similarity / `0.02` distinct-card margin.

Host q8 inference retrieves all five bundled fixtures at top-1 (similarities
0.913-0.961). Android arm64 ONNX Runtime also retrieves all five at top-1
(including `swsh9-167` at 0.971). The gate correctly remains authoritative:
it rejects the clean Peonia/Barry and Rayquaza fixtures below its 0.45 cutoff,
as the host q8 gate also does (approximately 0.437 and 0.394). Android now
ports the iOS manual-capture rescue without weakening that gate:

- automatic-camera frames still abstain immediately and never run OCR rescue;
- an exact footer collector number can confirm a shortlist printing;
- otherwise an exact normalized catalog title and a `>= 0.72` visual match
  must agree;
- titles with multiple catalog printings additionally require `>= 0.85` and
  `>= 0.05` separation unless the collector number confirms one printing;
- the `0.02` ambiguity guard still applies without collector confirmation.

The Android arm64 connected test verifies that ML Kit reads sufficient exact
evidence to rescue both known clean gate-false-negative fixtures. The runtime
is dispatched by the repository and the picker exposes DINOv2 only when the
complete checksum-validated bundle is installed.

The upstream DINOv2 code and weights are Apache-2.0 licensed:
https://github.com/facebookresearch/dinov2/blob/main/LICENSE. The community
ONNX model card identifies the base model but does not independently restate a
license. The APK therefore includes `assets/licenses/DINOv2-APACHE-2.0.txt`
and `DINOv2-NOTICE.txt` with attribution, both pinned revisions, and the ONNX
checksum. The extra model adds about 23.3
MiB raw before APK compression, on top of the already-large ORT and ArcFace
bundle; production should consider on-demand delivery.

## Verification

- JVM tests cover packed-index validation/search, Pocket filtering, CHW channel
  layout, and calibrated acceptance/ambiguity behavior.
- `ArcFaceOnnxRecognitionInstrumentedTest` loads the actual bundled ONNX model,
  runs the `swsh4-188` demo fixture, searches the real 21,828-card index, and
  expects an accepted self-retrieval above 0.90. It also compares the first 12
  output values for an all-0.5 tensor to the host fp32 reference.
- That instrumented test passes on the API 34 arm64 Android TV emulator. A
  host-side ONNX Runtime check of the fp32 fixture returned `swsh4-188` at
  `0.96394`, with the next candidate at `0.72708`. This confirms Android model,
  preprocessing, and compact index compatibility; physical phone latency and
  output parity remain required release evidence.
- `DinoV2OnnxRecognitionInstrumentedTest` loads the exact q8 ONNX, index,
  metadata, and gate on Android arm64 and verifies top-1 retrieval and the
  existing gate decisions for all five bundled demo cards, then runs real ML
  Kit title/footer OCR and rescues the two known clean gate false negatives.

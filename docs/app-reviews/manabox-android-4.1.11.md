# ManaBox 4.1.11 Android scanner review

**Review date:** 2026-08-03  
**Status:** Complete for the Android card-scanning path  
**Scope:** Camera processing, local recognition, index delivery, card-version
resolution, and reusable TCGer lessons

## Artifact identity

| Field | Value |
| --- | --- |
| App | ManaBox — MTG companion |
| Platform | Android APK, ARM64 Flutter AOT application |
| Package ID | `skilldevs.com.manabox` |
| Version | 4.1.11, version code 2687 |
| Source artifact | APKPure antisplit APK supplied locally by the user |
| File name | `ManaBox+MTG_4.1.11_APKPure_antisplit.apk` |
| Size | 155,060,498 bytes |
| SHA-256 | `7a627d2939c1aff7dd85fea72a77b57fc2af2e8827f899bce0f622e665fa8894` |
| Android SDK | Minimum 24; target 36 |

The input APK was not modified. Generated recovered output is in
`manabox-4.1.11-decompiled/`; it is evidence, not original source code.

## Executive summary

**Verified:** ManaBox recognizes cards on-device after downloading a versioned
matching bundle. CameraX supplies an NV21 image stream to a Dart worker isolate,
which calls a dedicated native library, `libimagematch.so`. Native OpenCV code
finds the card contour, perspective-warps it, normalizes it to 160 x 160, and
computes a 384-float HOG descriptor. hnswlib's exact brute-force L2 index
returns the ten nearest image labels. Local SQL maps each visual label to one
or more ManaBox card versions, with set filters and priorities resolving
reprints and identical artwork.

No camera image upload or remote recognition request was found in the recovered
scanner path. The network dependency is asset delivery: the app downloads
`matching.index`, `matching.db`, and compatible card-catalog updates. The most
transferable ideas are artifact compatibility/versioning, visual-group to
printing resolution, early set filtering, explicit frame backpressure, and
first-class offline-resource UX. TCGer should retain its learned DINOv2
embedding, int8 storage, rejection gate, OCR, and temporal fusion rather than
copying ManaBox's HOG descriptor.

## Architecture snapshot

| Stage | ManaBox implementation | Location | Confidence |
| --- | --- | --- | --- |
| Camera | Flutter CameraX image stream | Device | Verified |
| Frame format | CameraX `ImageProxyUtils.getNv21Buffer` | Device | Verified |
| Scheduling | Dedicated Dart image worker; one frame in flight | Device | Verified |
| Orientation/color | Native YUV-to-RGBA-gray conversion and rotation | Device | Verified |
| Card detection | Threshold/contour/corner detection in OpenCV | Device | Verified |
| Perspective correction | Native OpenCV quadrilateral warp | Device | Verified |
| Descriptor | 384-float HOG from a 160 x 160 normalized card | Device | Verified |
| Retrieval | hnswlib exact brute-force L2, top 10 | Device | Verified |
| Product lookup | Local SQLite image-index to card-version joins | Device | Verified |
| Exact-print handling | Set/promo filters and mapping priority | Device | Verified |
| Resource delivery | Versioned metadata plus `tar.gz` bundle | CDN/device | Verified |
| Barcode scanning | No barcode branch found in this scanner scope | Unknown | Not found |

## Card-image scan flow

1. CameraX starts an image stream and exposes frames through `ImageProxy`.
2. The UI ignores a new frame while the previous processing request is active.
3. A worker isolate reuses an allocated frame buffer and owns the native
   similarity service.
4. NV21/YUV input is converted to the native gray/RGBA representation and
   rotated when required.
5. `getMostSimilarFromDetected` finds a likely card quadrilateral. The scanner
   advice to use a plain high-contrast background supports this contour stage.
6. The native code applies a perspective transform, resizes the card, and
   computes HOG features.
7. The local index returns ten `(distance, image label)` records.
8. Dart queries `matching.db` and the attached local card catalog. One visual
   image may expand to several `cv_id` card versions.
9. Set locks, promo rules, and mapping priority constrain/order the versions.
10. The scanner session handles result editing, quantities, finishes,
    condition, duplicate suppression, and adding cards to a collection/deck.

The camera feed is continuous, but processing is explicitly serialized. This
is continuous local recognition rather than a user-triggered server shutter.

## Native descriptor and index

ARM64 constants in `libimagematch.so` configure OpenCV HOG with a 160 x 160
window, 64 x 64 blocks, 32 x 32 block stride, 32 x 32 cells, and six bins.
That produces `4 x 4 x 4 x 6 = 384` float values.

The inspected matching version 2 index is an hnswlib
`BruteforceSearch<float>` / `L2Space` file:

```text
uint64 max_elements       = 51645
uint64 bytes_per_element  = 1544
uint64 current_count      = 51645
repeat current_count:
    float32 descriptor[384]
    uint64 image_label
```

This is an exact linear search, not an HNSW graph. The binary is 79,739,904
bytes, exactly matching its header and record count.

The companion plain-SQLite `matching.db` contains `cards_index` and `metadata`.
The inspected snapshot had 105,503 mapping rows for 51,645 distinct visual
indices, priority values 0 through 39, and catalog revision
`cards_db_version = 1785568525`.

## Network contract and access assessment

| Purpose | Method/path | Auth observed | Result | Confidence |
| --- | --- | --- | --- | --- |
| Asset metadata | `GET https://files2.manabox.app/update_assets_metadata.json` | None | JSON paths/versions for matching, cards, patches | Verified by direct read-only request |
| Matching bundle | `GET https://files2.manabox.app/matching/matching_v2.tar.gz?...` | None | 53,538,881-byte gzip/tar | Verified by direct read-only request |
| Card-image recognition | No HTTP route in recovered scan call path | — | Runs locally | Verified for recovered path |

The metadata and matching bundle answered unauthenticated HTTP requests during
the review. They are static objects used by the official application, not a
published third-party scan API. Public routability does not establish a
license, stable contract, quota, or authorization to redistribute or consume
the data in another product. TCGer will not depend on them.

Other recovered ManaBox cloud/upload URLs belong to general synchronization or
catalog/image behavior and are not in the card-recognition call path.

## Dynamic resources and state

The updater fetches `update_assets_metadata.json`, parses separate `matching`,
`cards`, and `cardsPatches` sections, and checks compatible versions. Matching
version 2 is a gzip-compressed tar archive containing `matching.db` and
`matching.index`. The app reports missing files before scanner initialization,
avoids background matching downloads on metered connections according to its
settings, publishes progress, supports cancellation, decompresses, and unpacks.

Recovered scanner preferences/product behavior include quick mode, locked
sets, persisted sessions, deliberate same-card rescans, camera selection,
focus, and bulk edit. These are workflow controls rather than recognition
algorithm details, but materially affect scanner usefulness.

## Dependencies and packaged assets

- Flutter/Dart 3.12.2 AOT supplies UI, worker orchestration, SQL mapping, and
  resource-download logic.
- `camera_android_camerax` supplies frames and camera controls.
- `libimagematch.so` contains the scanner-specific native OpenCV 4.13.0 and
  hnswlib implementation.
- `libdartjni.so` is general Dart/JNI bridging, not the recognizer itself.
- SQLCipher protects the bundled main `cards.db`; the downloaded matching
  mapping database is plain SQLite.
- No `.tflite`, `.onnx`, or similar scanner ML model was found. HOG and contour
  processing are implemented in the native library.

## Privacy, security, and reliability observations

- Recognition frames remain on the device in the recovered flow.
- Offline scanning depends on a successful initial matching/catalog install
  and compatible revisions.
- Version-coupled metadata prevents a new visual mapping from silently joining
  against the wrong catalog.
- Exact brute-force retrieval avoids graph-build/serialization complexity but
  loads roughly 80 MB of float vectors for 51k visual records.
- Worker isolation, reusable buffers, and one-frame backpressure reduce UI
  stalls and unbounded live-camera work.
- A publicly readable asset URL is not an authentication vulnerability by
  itself when public delivery is intended, but it should not be mistaken for
  an authorized external data API.

## Evidence map

| Finding | Artifact/area | Confidence |
| --- | --- | --- |
| Package/version/SDK | `apktool/AndroidManifest.xml`, `apktool/apktool.yml` | Verified |
| CameraX stream and NV21 | `blutter/pp.txt`, `pp+0x4b7b0` to `pp+0x4b9e8` | Verified |
| Worker/backpressure | `blutter/asm/Hkr.dart`; scanner diagnostic strings | Verified |
| FFI surface | `blutter/pp.txt`, `pp+0x4b420` to `pp+0x4b720` | Verified |
| Candidate SQL | `blutter/pp.txt`, `pp+0x4b4a0` to `pp+0x4b5d8` | Verified |
| HOG/OpenCV/hnswlib | `apktool/lib/arm64-v8a/libimagematch.so` disassembly/strings | Verified |
| Asset names/updater | `blutter/pp.txt`, `pp+0xe7d8` to `pp+0xea48` | Verified |
| Metadata URL/schema | `blutter/pp.txt`, `pp+0x12080` to `pp+0x12358` | Verified |
| Live object sizes/content | `analysis/update_assets_metadata.snapshot.json`; inspected tar/SQLite/index header | Verified runtime observation |

## TCGer decision table

| ManaBox idea | Decision | Reason/result |
| --- | --- | --- |
| Version-couple matching/index/catalog | Adopt/reinforce | Extend the existing manifest discipline across encoder, vectors, metadata, gate, and catalog revision. |
| Map one visual record to multiple printings | Adopt | Avoid duplicate vectors for identical art; let OCR/set metadata resolve exact identity. |
| Locked-set candidate filtering | Adopt/reinforce | Reduces retrieval/resolution ambiguity and can reduce work. |
| Dedicated worker and one-frame backpressure | Retain | TCGer's live scanner should remain explicitly paced on both web and iOS. |
| Exact search at 51k records | Measure/retain where viable | Split by game/set and benchmark before adding ANN graph complexity. |
| Float32 HOG as primary descriptor | Reject | TCGer's DINOv2 embedding is more discriminative; int8 storage is roughly four times smaller per vector. |
| Resource-install UX | Adopt | Metered policy, progress/cancel, atomic unpack, and useful missing-assets UI are required for offline-first delivery. |
| Quick mode/session restore/same-card override | Adopt as product work | Improves high-volume collection entry independently of model accuracy. |
| Consume ManaBox CDN assets | Reject | No supported third-party data/API contract or redistribution permission. |

## Unknowns and next experiments

| Unknown | Why it matters | Safe next test |
| --- | --- | --- |
| Exact confidence/distance acceptance policy in every scanner mode | Determines false-positive behavior | Run the official app on owned cards/background negatives while recording only displayed outcomes. |
| Real per-frame latency/memory by Android device class | Tests the cost of 80 MB exact search plus OpenCV | Profile the official app on an authorized test device without modifying service traffic. |
| How well HOG handles foil glare, borderless cards, and same-art reprints | Establishes its practical ceiling | Compare official-app results on an owned labeled fixture set. |
| Atomicity/rollback details during interrupted updates | Affects offline reliability | Interrupt an official matching update on a disposable test install. |
| Whether a later release replaces HOG or changes bundle version | Findings are version-specific | Repeat native export/index-header inspection on the newer artifact. |

## Reproduction notes

- Apktool 3.0.3 successfully decoded the full APK/resources/native libraries.
- JADX produced 12,206 of 14,367 classes before stalling. Its partial output is
  useful for Android/plugin glue, while the scanner logic remains Dart AOT.
- Blutter successfully analyzed Dart 3.12.2 ARM64. App identifiers are heavily
  obfuscated, but FFI signatures, object-pool strings, types, closures, and
  annotated assembly remain recoverable.
- Native exports and ARM64 disassembly established the OpenCV/HOG/hnswlib path.
- A minimal read-only CDN check downloaded current metadata and the matching
  bundle. The large bundle was inspected from temporary storage rather than
  copied into the repository.
- The detailed generated-artifact report is
  [`manabox-4.1.11-decompiled/SCAN_ANALYSIS.md`](../../manabox-4.1.11-decompiled/SCAN_ANALYSIS.md).

## Final takeaways

ManaBox demonstrates a coherent local scanner architecture: serialize camera
work, detect and rectify natively, search a compact binary index, expand visual
groups into catalog versions, and make resource installation/versioning part
of the product. The largest lesson for TCGer is not HOG itself; it is separating
visual identity from printing identity and shipping the index, mapping, and
catalog as one compatible offline system. TCGer can use that pattern while
retaining its stronger learned embeddings, quantization, rejection, OCR, and
temporal evidence.

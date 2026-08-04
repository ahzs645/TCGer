# Collectr 2.5.5 Android scanner review

**Review date:** 2026-08-03  
**Status:** Complete for the scanning path  
**Scope:** Card-image scanning, barcode scanning, scan transport, and reusable
product lessons

## Artifact identity

| Field | Value |
| --- | --- |
| App | Collectr — TCG Collector App |
| Platform | Android APK, ARM64 Flutter AOT application |
| Package ID | `com.collectrinc.collectr` |
| Version | 2.5.5, version code 735 |
| Source artifact | APKPure antisplit APK supplied locally by the user |
| File name | `Collectr+-+TCG+Collector+App_2.5.5_APKPure_antisplit.apk` |
| Size | 73,610,810 bytes |
| SHA-256 | `fba23822e86161d5a619b3c0fb34896060a346be575604d11de3309e1bec4f30` |
| Android SDK | Minimum 24; target 36 |

The input APK was not modified. Local recovered output is in
`collectr-2.5.5-decompiled/`; it is generated evidence rather than original
source code.

## Executive summary

Collectr's card scanner is a server-recognition design. **Verified:** the app
keeps the latest high-resolution camera stream frame, rotates it to portrait,
maps the visible guide into camera coordinates, crops it, JPEG-encodes it, and
sends the base64 JPEG to a backend. No packaged card-recognition model or card
index was found. That negative result does not prove one could never be
delivered dynamically, but the recovered scan call path reaches the remote
request directly.

Barcode scanning is a separate hybrid path. Google ML Kit decodes the barcode
on-device, while Collectr's backend resolves the decoded value to products.
Scanner modes and limits are server-configured, and the result flow supports
candidate, variant, foil, and grade confirmation rather than blindly accepting
the first result.

The best transferable ideas were guide-aware cropping, separating barcode
decoding from catalog lookup, protecting expensive server recognition, and
keeping a confirmation stage. TCGer retained its stronger multipart transport,
local-first recognition, Vision perspective correction, authenticated identity,
and full-resolution still capture.

## Architecture snapshot

| Stage | Collectr implementation | Location | Confidence |
| --- | --- | --- | --- |
| Camera | Flutter `camera`/CameraX, `ResolutionPreset.high` image stream | Device | Verified |
| Frame selection | Most recent continuous-stream `CameraImage` when shutter is tapped | Device | Verified |
| Orientation | Landscape frames rotated to portrait in an isolate | Device | Verified |
| Scan-window crop | Overlay bounds mapped from UI coordinates to image coordinates | Device | Verified |
| Perspective correction | No separate homography/perspective stage found in this flow | — | Verified for recovered path |
| Encoding | JPEG, then base64 inside JSON | Device | Verified |
| Card matching | Product recognition/candidate generation | Server | Verified |
| Barcode decoding | Google ML Kit, all barcode formats | Device | Verified |
| Barcode lookup | Decoded value resolved to products | Server | Verified |
| Confirmation | Candidate/variant/grade selection before adding | Device UI | Verified |

## Card-image scan flow

1. `CardScanningPageState.toggleCamera` creates and initializes a high-resolution
   `CameraController`, locks capture orientation, and starts an image stream.
2. The stream continuously replaces a stored latest `CameraImage`; it does not
   continuously run card recognition.
3. The shutter handler refuses a new scan when no frame exists or a scan is
   already processing.
4. YUV420 is manually converted to RGB. BGRA8888 is constructed with the
   matching channel order.
5. Landscape input is rotated into portrait orientation. Portrait input is
   retained.
6. The app maps its visible guide to image coordinates. The guide includes a
   65-logical-pixel horizontal inset on both sides; vertical bounds account for
   the top controls, optional Pro treatment, and bottom sheet.
7. The mapped region is cropped and JPEG-encoded. The method name
   `cropSquareImage` is misleading: evidence shows a UI guide crop, not a
   guaranteed mathematical square.
8. For non-barcode modes, the JPEG is base64-encoded and placed in a JSON POST.
9. Returned candidates and account scan state are parsed. The user can resolve
   product, variant, foil, and grade details before adding an item.

This is user-triggered remote recognition using the latest preview buffer. It is
not a packaged local card classifier and does not take a separate full-resolution
still photograph at shutter time.

## Barcode scan flow

1. A server-provided option whose `scanType` is `barcode` selects the barcode
   branch.
2. The current camera frame becomes an ML Kit `InputImage`; YUV420 is repacked
   as NV21 where needed.
3. `google_mlkit_barcode_scanning` decodes locally with
   `BarcodeFormat.all`.
4. The decoded string is sent to the scan endpoint as a query parameter.
5. The backend performs barcode-to-product resolution and returns candidates.

The distinction matters: ML Kit supplies machine-readable digits; Collectr's
catalog service supplies product identity.

## Network contract

The following is a recovered private app contract, not a supported public API.

| Purpose | Method/path | Request fields | Response fields visibly used | Confidence |
| --- | --- | --- | --- | --- |
| Card recognition | `POST https://dmsbhobr66dx6.cloudfront.net/external/scan` | JSON: `username`, scan `type`, `imageBase64` | Product candidates, `scansRemaining`, `gradeSelected` (`id`, `subType`) | Verified |
| Barcode lookup | `GET https://dmsbhobr66dx6.cloudfront.net/external/scan` | Query: `username`, scan `type`, decoded `barcode` | Product candidates and scan state | Verified |
| Scanner configuration | Path containing `data/camera-scan-options` | Common app request context | `scanningLimit`, `ScanOption` list | Verified |

The common request builder can attach `Locale`, `X-Device-ID`,
`X-Session-Token`, `Authorization`, and a derived `X-COLLECTR-KEY`, in addition
to normal JSON/connection headers. Which fields are mandatory is a server-side
policy and was not established through static analysis.

### Can anyone use the endpoint?

- **Verified:** the hostname and route are embedded in the distributed client,
  so their location is not secret and the CloudFront host is publicly routable.
- **Unknown:** the exact current combination of account, session, device, and
  derived headers required for every useful response.
- **Important:** public routability only means an HTTP client can contact the
  service. It does not make the route a public or authorized third-party API.
- **Decision:** TCGer must not integrate with it. There is no discovered public
  contract, stability promise, quota allocation, privacy agreement, or
  permission for our workload. Reproducing client-generated headers would not
  create legitimate authorization and would remain fragile.

No live credentials, session tokens, or reusable header-generation procedure
are recorded in this review.

## Dynamic configuration and state

**Verified:** scanner options come from `data/camera-scan-options` rather than
being entirely hard-coded. The response includes a scan limit and option
objects. This lets the service change visible scan modes or entitlements without
shipping a new client.

The app persists:

- `card-scanning-page-camera-idx`
- `card-scanning-page-is-flash-enabled`
- `card-scanning-page-scan-foil-idx`

Foil choices recovered from the app are `backend`, `foil`, and `nonfoil`.
Result parsing also exposes remaining scans and a selected grade, showing that
subscription/quota and condition state are part of the scanning product—not
just the recognition model.

## Dependencies and packaged assets

- Flutter/Dart AOT supplies the main UI and scanner orchestration.
- Flutter `camera` with the Android CameraX implementation supplies frames.
- Dart's `image` package performs conversion, rotation, crop, and JPEG work.
- Google ML Kit/Barhopper performs local barcode decoding.
- `camerawesome` is bundled but the recovered card-scanning page uses Flutter's
  standard camera controller; library presence alone is not proof of usage in a
  particular feature.
- No `.tflite`, `.onnx`, YOLO weights, or comparable card-recognition model was
  found in the APK.
- `libbarhopper_v3.so` supports barcode detection and is not evidence of local
  card-art recognition.
- Signed-S3 upload and WebSocket strings exist elsewhere, but the scanner call
  graph uses the direct HTTP requests above.

## Privacy, security, and reliability observations

- Cropping before upload reduces background content, request size, and visual
  noise. The crop should be treated as both an accuracy and privacy boundary.
- The image POST includes a username and may include account/session/device
  context. Image recognition therefore depends on a remote service and carries
  user imagery across the network.
- App-distributed derived headers may raise the cost of casual automation, but
  cannot serve as an unextractable secret or replace server-verified identity,
  quotas, and abuse controls.
- Base64 JSON adds roughly one-third encoding overhead before JSON framing and
  prevents the clean streaming behavior of multipart binary upload.
- Dynamic limits and `scansRemaining` indicate the server meters scanning.
- The recovered client treats non-200 responses as UI errors. Server outage or
  policy change prevents card-image matching.

## Evidence map

The generated files below live under `collectr-2.5.5-decompiled/`.

| Finding | File | Symbol/area | Confidence |
| --- | --- | --- | --- |
| Camera setup and stream | `blutter/asm/collectr/card_scanning_page.dart` | `toggleCamera`, around generated line 4056 | Verified |
| Capture guard | Same | `_onCaptureButtonPressed`, around line 10141 | Verified |
| Main frame pipeline | Same | `_processCapturedFrame`, around line 10174 | Verified |
| Local barcode decode | Same | Barcode processing, around line 10773 | Verified |
| ML Kit image conversion | Same | Input-image conversion, around line 11039 | Verified |
| Guide crop/JPEG | Same | `cropSquareImage`, around line 11753 | Verified |
| Portrait rotation | Same | `ensurePortraitOptimized`, around line 12103 | Verified |
| YUV/BGRA conversion | Same | Image conversion dispatch, around line 12247 | Verified |
| Common headers | `blutter/asm/collectr/utils/services.dart` | Header builder, around line 157 | Verified |
| Image POST | Same | `searchWithScanPost`, around line 38312 | Verified |
| Barcode GET | Same | Scan GET path, around line 38817 | Verified |
| Endpoint/config strings | `blutter/pp.txt`, `analysis/libapp.strings.txt` | `external/scan`, `data/camera-scan-options` | Verified |
| Package/camera metadata | `apktool/AndroidManifest.xml`, `apktool/apktool.yml` | Manifest and version metadata | Verified |

Generated line numbers are navigation aids, not stable source locations.

## TCGer decision table

| Collectr observation | TCGer decision | Reason/result |
| --- | --- | --- |
| Guide defines uploaded image | Adopt | TCGer maps the actual SwiftUI guide through aspect-fill preview geometry before Vision normalization. |
| Crop only, no recovered perspective stage | Adapt | TCGer keeps Vision rectangle detection and perspective correction after the guide crop. |
| Local barcode decode, server product lookup | Adopt for sealed products | VisionKit keeps frames local and sends only normalized UPC/EAN digits to an authenticated lookup. |
| Server recognition is expensive and metered | Adopt principle | TCGer added per-user rate/concurrency controls, a global concurrency ceiling, MIME checks, and decoded-pixel limits. |
| Candidate/variant confirmation | Retain | TCGer already uses candidates and explicit confirmation. |
| Dynamic server scan options | Defer | Worth adding only when recognition capabilities vary independently by deployment. |
| Base64 JPEG inside JSON | Reject | TCGer keeps multipart JPEG to avoid base64 overhead. |
| Latest preview buffer as shutter image | Reject | TCGer keeps a deliberate full-resolution still for higher-quality fallback, while live local scanning may use preview frames. |
| Private Collectr endpoint | Reject | No supported third-party contract; unacceptable privacy, reliability, quota, and authorization dependency. |
| Client-derived security header as protection | Reject as primary control | TCGer relies on server-verified authentication and admission controls. |
| Entirely remote card matching | Retain TCGer local-first design | Offline/local recognition and server fallback provide better resilience and privacy. |

Implemented TCGer work is summarized in
[the original takeaways note](../collectr-scanner-takeaways.md), scanner code,
the authenticated scan admission middleware, and sealed barcode flow.

## Unknowns and next experiments

| Unknown | Why it matters | Safe next test |
| --- | --- | --- |
| Exact server recognition model/index | Could reveal accuracy/latency tradeoffs | Cannot be resolved from the APK; compare behavior only with an authorized test account and owned images. |
| Required header matrix and token lifetime | Defines actual access control | Observe the official app's own requests in an authorized test account; do not automate or bypass controls. |
| Server retention of uploaded crops | Privacy impact | Consult Collectr's published privacy material or obtain a vendor answer. |
| Real JPEG dimensions/quality across devices | Affects bandwidth and recognition | Capture official-app requests on owned test cards across representative Android devices. |
| Scan option schema and game coverage | Could inform capability negotiation | Record an authorized official-app response with secrets redacted. |
| Whether newer releases add local models | Architecture may change | Repeat the asset inventory and call-path trace per version. |

## Reproduction notes

- Apktool 3.0.3 decoded the resources, manifest, native libraries, and smali.
- JADX wrote 8,198 of 8,200 classes before stalling on two methods. Its useful
  scanner evidence is mostly Flutter plugin registration because the app logic
  is Dart AOT.
- Blutter analysis for Dart 3.10.7 ARM64 recovered function/class names, object
  pool constants, and annotated ARM64 assembly from `libapp.so`. It is the
  primary scanner evidence.
- Recovered Dart assembly annotations are not Collectr's original source.
- Findings are specific to version 2.5.5/build 735 and should not be silently
  applied to later versions.

## Final takeaways

Collectr demonstrates a clean server-scanner product flow more than a novel
on-device recognition technique: align, minimize the frame, upload, meter,
return candidates, and confirm details. Its barcode path correctly separates
visual decoding from catalog identity. TCGer adopted those general lessons
while keeping its own authenticated services, local-first recognizer, binary
transport, perspective correction, and higher-quality still capture.

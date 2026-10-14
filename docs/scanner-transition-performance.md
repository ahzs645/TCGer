# Scanner transition performance

## Implementation

Camera startup, live analysis, and capture readiness are separate operations.
The preview should appear without waiting for model/index preparation. A manual
capture can await preparation after retaining the photo, while live analysis
must never block navigation or queue old frames.

### iOS

- Explicit `@concurrent` boundaries cover live conversion/cropping/quality,
  captured-photo decoding, capture-quality checks, and crop-rescue detection.
  The embedding strategy and preprocessing helpers are explicitly nonisolated;
  its scan/warm-up and encoder entry points also leave the caller's actor.
  This is required with `SWIFT_APPROACHABLE_CONCURRENCY = YES`.
- Capture frames and completed photos cross that boundary in narrowly scoped,
  read-only retained wrappers. The camera stream still buffers only the newest
  frame. A resumed consumer waits for the cancelled consumer to finish, so a
  non-cooperative Vision/Core ML call cannot overlap a new analysis.
- Preview disappearance pauses analysis before the outgoing animation ends.
  Scene inactivity also pauses it. Visibility/context generations reject late
  quality/recognition results after exit, re-entry, game changes, or overlays.
  Cancelled/replaced warm-ups cannot publish readiness for a new runtime.
- Sensor preview stays independent of analysis throttling. Capture shutdown
  retains the controller on its session queue through the queued stop, avoiding
  last-reference teardown during dismissal on the UI thread.
- Analysis output prefers supported native bi-planar YUV, with BGRA fallback.
  After guide cropping, live images are limited to a 1280-pixel longest edge.
  Still-photo dimensions and still-photo recognition remain separate.
- A verified installed package supplies its known game instead of scanning its
  entire metadata JSON during construction. Actor-backed model/index/metadata
  resources are reused through a three-entry `NSCache`; keys include the game,
  version and every asset path. Per-session strategy state is not shared.
- Independent server startup feature/setup/settings reads overlap. Initial
  content remains gated until startup checks complete, and replaced sessions
  cannot receive late configuration responses.

### Android

- Automatic card scanning samples `ImageAnalysis` frames on a dedicated serial
  executor with `STRATEGY_KEEP_ONLY_LATEST` and a 1280x960 resolution preference.
- Inactive, busy, or too-early frames are closed before bitmap conversion. One
  sampled frame stays in flight through delivery; lifecycle exit prevents late
  callbacks. Every `ImageProxy` is closed, and the executor/analyzer are cleaned
  up when the camera leaves composition.
- Sampled frames are rotated upright and encoded in memory only when due. The
  existing byte-based recognition API still receives JPEG bytes, but automatic
  scanning no longer invokes the still-photo capture/write/read cycle.
- Manual and binder-page capture retain the still-photo path. CameraX may choose
  a different analysis resolution to fit the device's supported use cases.

### Web

- Exact vector ranking runs in a serial Web Worker for camera workbench and
  video recognition, including crop rescue and multi-model recognition.
- The worker uses the original matching/threshold/deck-scope implementation.
  Immutable index objects are registered once and cached in a bounded
  three-entry worker cache. Evicted indexes are re-registered when needed.
  Queries are copied before transfer, preserving temporal averaging buffers.
- Camera controls are released after media acquisition; model warm-up continues
  separately through the existing shared loaders. Superseded camera requests
  stop acquired tracks, and old warm-ups cannot publish after stop/unmount.
- Page exit terminates the search worker and rejects queued searches. Node/SSR
  tooling, and browsers without Worker support, keep the synchronous fallback.

## Verification in the Linux workspace

- Frontend unit suite: 187 passed, including three tests using an actual Node
  worker thread for ranking, calibrated thresholds, deck scope, cache eviction,
  query ownership, mixed-model rejection, and cancellation.
- TypeScript checking passed. Focused ESLint checking passed with existing
  component warnings and no errors.
- A temporary Next.js client fixture passed an actual Chromium Web Worker search
  using Turbopack, with one worker and no page errors. The fixture was removed.
  This verifies worker bundling/execution, not a physical camera or model run.
- Android Kotlin compilation and unit suite passed: 254 tests, zero failures or
  errors, one skipped test. Three new throttle tests verify cadence, backpressure,
  and rejection of inactive/busy frames.
- Web UI parity suite: 21 passed, normalized into 13 feature cases. These cover
  navigation and demo scanner review; they do not exercise a physical camera.
- The full parity report remains incomplete: Android/iOS UI evidence is Not run.
- Parity source/contract checks passed. Product records include the new source
  paths and regression tests without promoting tracked scanner capabilities to
  verified parity.
- `ScannerLifecycleTests` covers exit/re-entry rejection, context invalidation,
  repeated visibility notifications, and declared package support. It has not
  run here: Linux cannot build or execute the iOS app.

The current runtime logs and native/web UI parity results are separate execution
evidence. Unit tests, a worker fixture, and source declarations do not prove
camera performance or recognition equivalence on hardware.

## Physical-device comparison still required

Use the same phone/browser, installed package versions, collection, lighting,
and cards for the baseline and changed build. Record the commit, OS, hardware,
build configuration, thermal state, and each actual video-buffer dimension.
Test a Release build; Debug/simulator timings do not establish device latency.

Measure these independently over repeated runs:

| Interaction | Measurements |
| --- | --- |
| First Scan opening after process launch | Tap to first visible preview; longest main-thread stall in the first five seconds |
| Scan reopening in the same process | First visible preview; model/index preparation; retained memory |
| Leaving Scan during recognition/warm-up | Transition frame drops; late UI/result publication; CPU work after exit |
| First versus later manual captures | Capture-to-result time; preview cadence during decode/OCR |
| Automatic scan with no card and with a card | Analysis duration/cadence, preview frame drops, recognition/consensus outcomes |
| Rapid tab/game switches and background/foreground | One analysis in flight; old results rejected; camera/torch released |
| Several minutes of scanning | Thermal pressure, memory peak, camera compatibility and frame cadence |

Use Instruments Time Profiler/Hangs and SwiftUI profiling on iPhone, Android
Studio System Trace on Android, and the browser Performance panel on web.
Confirm that conversion, Vision/OCR, embedding preprocessing and vector search
are outside UI execution. A delivered camera buffer is a readiness signal; it
is not proof of the moment the preview became visible.

Compare accepted identities, rejected inputs, exact-printing choices, and consensus
on the same recordings/cards before accepting lower analysis resolution or a new
pixel format as a performance win. Check glare, small footer text, distant cards,
binder pages, rotation, and lower-end CameraX three-use-case configurations.
Do not change calibrated thresholds to compensate for a regression.

For local iOS regression plus native UI evidence, finish XCTest before Maestro:

```sh
API_CONTRACT_IOS_EXTRA_TESTS=DeviceAuthenticationTests,DeepLinkRoutingTests,LocalAPIRepositoryInjectionTests,PackageScannerDownloadTests,ScannerLifecycleTests,CardScannerCoordinatorTests,ScannerGuideCropperTests,ScannerCaptureQualityTests,ScannerCameraThrottleTests npm run verify:ios:local
```

A full three-platform parity claim additionally needs fresh web, Android, and iOS
UI runs against unchanged source and the same run identity. Physical camera
profiling and recognition checks remain necessary even after UI suites pass.

## References

- [Swift: nonisolated(nonsending) by default](https://docs.swift.org/latest/documentation/diagnostics/nonisolated-nonsending-by-default/)
- [Apple: responsive camera startup and preview](https://developer.apple.com/videos/play/wwdc2026/303/)
- [Apple: selecting video-data-output pixel formats](https://developer.apple.com/documentation/Technotes/tn3121-selecting-a-pixel-format-for-an-avcapturevideodataoutput)
- [Android: CameraX image analysis and backpressure](https://developer.android.com/media/camera/camerax/analyze)
- [ManaBox architecture observations](manabox-scanner-takeaways.md)

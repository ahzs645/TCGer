# TestFlight crash feedback — build 167

Reviewed from `testflight_feedback.zip` on 2026-08-13. The archive contains
one feedback record and its symbolicated crash report. Contact information from
the feedback record is intentionally not copied into the repository.

## Report

- App: TCGer 1.0 (167)
- Device: iPhone 17 Pro (`iPhone18,1`), iOS 26.6
- Feedback: “Changed pokemon pack and it crashed”
- Failure: `EXC_CRASH (SIGABRT)` on a CFNetwork worker thread
- Top app frame: `PackOpeningSchemeHandler.loadRemote` at
  `PackOpeningView.swift:494`, calling `WKURLSchemeTask.didFinish()`

## Diagnosis

The remote resource completion removed its bookkeeping entry and then called
the WebKit scheme task directly from the URLSession callback queue. Changing
packs can make WebKit stop the old resource between those operations. WebKit
raises an Objective-C exception if a stopped scheme task receives another
response, data, completion, or failure callback.

## Resolution

`PackOpeningSchemeHandler` now owns its request lifecycle on the main actor.
URLSession completions hop to the main actor before checking whether the task is
still active or calling WebKit. `stop` removes and cancels the task on that same
actor, so a canceled pack resource cannot subsequently call `didFinish()`.

A regression test also verifies that the remote response, data, and completion
callbacks are all delivered on the main thread.

## Follow-up runtime failure

A subsequent Simulator run reached the pack picker but displayed “Pack artwork
failed to load: Base · Charizard.” The embedded document used
`tcger-pack://bundle` while Three.js textures used `tcger-pack://assets`, so
WebKit treated the textures as cross-origin resources. The document now loads
from the `assets` host as well. If published cover artwork is unavailable, the
experience uses its generated wrapper instead of presenting a blocking error.

The same run exposed a missing `EnvironmentStore` in the full-screen pack
presentation and relative asset names such as `PokemonCardBack` being sent to
URLSession. The presenter now injects the environment explicitly, and the
shared image loader ignores values that are not HTTP(S) or file URLs.

Verified in iPhone 17 Pro Simulator by selecting Base · Charizard, entering the
tear phase, skipping the tear animation, and reaching the card reveal. The full
iOS suite passed: 169 tests, 0 failures, 14 skipped.

# <App> <version> <platform> review

**Review date:** YYYY-MM-DD  
**Reviewer:** <name or agent>  
**Status:** Draft | Complete | Superseded  
**Scope:** <scanner, catalog, collection flow, etc.>

## Artifact identity

| Field | Value |
| --- | --- |
| App | |
| Platform | |
| Package/bundle ID | |
| Version name | |
| Version/build code | |
| Source | |
| File name | |
| Size | |
| SHA-256 | |
| Minimum/target OS | |

State whether the input was modified and where the decompiled artifacts were
stored. Do not commit the original binary unless the repository is explicitly
allowed to redistribute it.

## Questions this review answers

- Where does recognition run: device, server, or both?
- What image/frame reaches recognition, and how is it prepared?
- Is scanning continuous or user-triggered?
- How are barcode and card-image scans handled?
- What is the request and response shape?
- What authentication, quota, and abuse controls are visible?
- What belongs in TCGer, and what should we avoid?

## Executive summary

Write five to ten sentences describing the architecture and the most valuable
product lessons. Label inference explicitly.

## Architecture snapshot

| Stage | Implementation | Location | Evidence | Confidence |
| --- | --- | --- | --- | --- |
| Camera capture | | Device/server | | Verified/inferred/unknown |
| Frame selection | | | | |
| Orientation | | | | |
| Guide/card crop | | | | |
| Perspective correction | | | | |
| Image encoding | | | | |
| Card recognition | | | | |
| Barcode decoding | | | | |
| Product lookup | | | | |
| Candidate confirmation | | | | |

## End-to-end flows

### Card-image scan

Number each step from entering the scanner to accepting a result. Include frame
source, resolution, coordinate mapping, preprocessing, request timing, response
parsing, candidate UI, and failure behavior.

### Barcode scan

Document decoding and lookup separately. A barcode library finding digits is
not the same as the product catalog resolving those digits.

## Network contract

For each relevant endpoint, record:

| Purpose | Method/path | Body/query | Response fields used | Auth visible | Confidence |
| --- | --- | --- | --- | --- | --- |
| | | | | | |

Redact secrets and live user identifiers. Record whether findings came from
static code, an intercepted app-owned request, or a direct probe.

### Access assessment

Answer these separately:

- Is the host publicly routable?
- Does the endpoint answer unauthenticated requests?
- Does a useful response require app/account/device credentials?
- Is there a published third-party API contract?
- Would using it create privacy, reliability, quota, legal, or terms risks?

Never equate "I can send an HTTP request" with "anyone is authorized to use
this service."

## Dynamic configuration and state

Record server-provided scanner modes, supported games, feature flags, quotas,
subscriptions, persisted camera choices, foil/variant handling, and fallbacks.

## Dependencies and packaged assets

List camera, vision, barcode, OCR, image-processing, networking, and ML
components. Inventory `.tflite`, `.onnx`, `.mlmodel`, model weights, indices,
and native vision libraries. Explain what each relevant asset proves and does
not prove.

## Privacy, security, and reliability observations

Cover the minimum uploaded image region, identifiers sent, retention clues,
transport, authentication, replay resistance, quotas, concurrency, offline
behavior, and server dependency. Do not publish an exploit recipe.

## Evidence map

| Finding | Artifact/file | Symbol or line | Evidence type | Confidence |
| --- | --- | --- | --- | --- |
| | | | Static/runtime | |

Use symbols as well as line numbers because generated decompilation line
numbers may change between tool versions.

## TCGer decision table

| Idea | Decision | Why | TCGer issue/file | Validation |
| --- | --- | --- | --- | --- |
| | Adopt/adapt/retain/defer/reject | | | |

Prefer general principles over implementation mimicry. Note whether TCGer
already has a stronger equivalent.

## Unknowns and next experiments

| Unknown | Why it matters | Safe test | Required setup |
| --- | --- | --- | --- |
| | | | |

## Reproduction notes

Record tool names/versions, commands at a high level, failures or incomplete
decompilation, architecture/ABI coverage, and which conclusions can be checked
without network access.

## Final takeaways

Summarize:

- What we learned.
- What changed in TCGer.
- What we deliberately did not copy.
- What to check again in a newer app version.

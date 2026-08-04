# Collectr scanner takeaways for TCGer

> The full, evidence-backed review is now maintained in
> [app-reviews/collectr-android-2.5.5.md](app-reviews/collectr-android-2.5.5.md).
> Use [app-reviews/template.md](app-reviews/template.md) for future app reviews.

## Adopted

### Make the guide define the scan input

Collectr reduces the camera frame to the region the user was asked to align.
TCGer now maps its SwiftUI guide through the camera preview's aspect-fill
geometry and uses that crop for both live frames and captured photos. Vision
rectangle detection and perspective correction remain the second stage.

The server fallback also applies `CardCropper` before JPEG upload. This lowers
background noise and upload size, keeps local and remote inputs aligned, and
avoids uploading more of the user's surroundings than recognition needs.

### Separate barcode decoding from product lookup

Sealed inventory now has a VisionKit UPC/EAN scanner. Only decoded digits are
sent to the authenticated `sealed/products/barcode/:barcode` lookup; camera
frames remain on-device. UPC-A and its leading-zero EAN-13 equivalent are
treated as the same identifier.

### Protect expensive recognition work

The authenticated image-scan route now has per-user and global concurrency
ceilings, a per-user request window, decoded-pixel validation, and explicit
retry responses. The in-process controls provide immediate protection; a
multi-replica deployment should also enforce a shared edge or Redis-backed
limit.

## Retained from TCGer

- Multipart JPEG uploads instead of base64-in-JSON, avoiding base64 overhead.
- Local-first recognition with server fallback.
- Vision perspective correction rather than relying only on a fixed crop.
- Candidate lists and explicit user confirmation.
- Opt-in debug-image retention.
- Authentication bound to the server-verified user ID.

## Deliberately not adopted

- **Collectr's private endpoint:** publicly reachable behavior is not an API
  contract and creates privacy, reliability, quota, and terms-of-use risks.
- **Client-generated security headers:** an app-bundled derivation can be
  reproduced and is not a substitute for server-verified authentication.
- **Base64 image requests:** larger and less streaming-friendly than multipart.
- **Dynamic scanner options for their own sake:** TCGer already derives local
  support from installed model/index assets and selected games. A capabilities
  endpoint becomes worthwhile when server engine rollout varies independently
  by deployment; until then it adds state without changing behavior.
- **Using the latest preview frame for shutter scans:** TCGer retains full photo
  capture for deliberate scans and uses preview buffers only for local live
  recognition, preserving higher-quality server fallback input.

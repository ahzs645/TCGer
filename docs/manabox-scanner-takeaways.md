# ManaBox scanner takeaways for TCGer

The full reverse-engineering report is in
[`manabox-4.1.11-decompiled/SCAN_ANALYSIS.md`](../manabox-4.1.11-decompiled/SCAN_ANALYSIS.md).
The implementation recommendation and reproducible geometry-policy test are in
[`manabox-inspired-geometry-experiment.md`](manabox-inspired-geometry-experiment.md).

## The important difference from Collectr

ManaBox recognition is local. CameraX frames cross an FFI boundary into a
native OpenCV library, which detects and rectifies the card, computes a
384-float HOG descriptor, and runs an exact top-10 L2 search over a downloaded
51,645-image index. A local SQLite mapping expands the visual result into one
or more MTG printings.

Collectr, by contrast, uploads the cropped image to a private scan endpoint.
ManaBox therefore provides the more relevant architecture reference for
TCGer's local-first scanner.

## Recommended decisions

| ManaBox observation | TCGer decision |
| --- | --- |
| Matching index, mapping DB, and catalog revision are version-coupled | Enforce one compatibility manifest across encoder, index, metadata, gate, and catalog. |
| One visual index row expands to several printings | Group identical artwork/visual references; use set constraints and OCR for exact-print resolution. |
| Set locks are applied during candidate resolution | Add/retain early allowed-index filtering for selected game/set scope. |
| Dedicated image worker, reusable frame buffer, one frame in flight | Keep scanner inference isolated and explicitly backpressured on web and iOS. |
| 51k x 384 float vectors use exact native search successfully | Keep exact search while game/set partitioning meets latency; measure before adding ANN complexity. |
| 53.5 MB background download becomes 81.4 MB of matching assets | Keep TCGer's int8 packed index and per-game downloads. |
| Missing assets, metered download, progress, cancel, and unpack are first-class flows | Treat offline asset installation and atomic updates as scanner product work. |
| Quick mode, same-card override, and restored sessions | Add these workflow controls independently of recognition accuracy. |

## Keep TCGer's stronger recognition stack

ManaBox's HOG descriptor happens to have the same 384-value width as TCGer's
DINOv2-small embedding, but that does not make the two equivalent. TCGer should
keep DINOv2, its card-face rejection gate, collector-number OCR, multi-frame
averaging, and rescue-only rectification. The ManaBox design is most useful as
evidence that a local binary index, local catalog mapping, set filtering, and
careful download UX work well as an integrated product.

The ManaBox CDN objects returned HTTP 200 without app credentials during the
review, but they are static private-product assets, not a supported scan API.
TCGer should reproduce the architecture with its own licensed catalog and
generated index rather than depend on those URLs.

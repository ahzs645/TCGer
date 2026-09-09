# Check imported references in the corner editor

Open [the reference corner studio](http://localhost:8770/). It uses the existing point-drawing and rectification editor with 502 photos / 561 reference cards. The model comparison remains at port 8768.

The user has now completed the entire queue. See [the verified completion snapshot and updated comparison](REFERENCE-REVIEW-COMPLETED.md).

Each card starts with reference geometry, never a prediction from the retrained model:

- 512 existing reference quads are retained, with clockwise winding for non-mirrored rectification.
- 39 polygon-only references receive a draft quad from the existing gated polygon fitter.
- 10 rejected fits receive an enclosing rectangle, explicitly identified in the selected card's hint. These need closer corner review.

The source polygon is hidden by default, leaving one editable outline per card. **More tools → Source polygon** adds the original reference for comparison; it does not control the crop. Drag handles to adjust corners, press R to rotate their order, and check **Orientation certain** once the crop is upright. **C** confirms a card; **Save & next** saves the page. **Approve on Save / Next** enables the previously supported faster approval workflow. **Previous** revisits saved photos, including those hidden by Incomplete only. **More tools → Reset to reference** restores the starting outline. Initial seeds are unconfirmed and do not create exported labels.

The compact layout aligns the photo and rectified preview below the editing controls. Instructions are under Help, secondary tools under More tools, and export/model links under More. Card layers are collapsed below the photo and hidden for single-card frames; multi-card overlap previews remain available beside the photo.

**Shape → Auto** chooses portrait or landscape from the current ordered edges in source-image pixels. Landscape-printed cards such as F209 (Xerneas BREAK) keep the printed top at the top; they should not be rotated merely to fill a portrait preview. A portrait/landscape override is available for strong perspective and affects only the preview, not the corners or orientation approval. The save button explicitly says **Save draft & next** for unfinished outlines when automatic approval is off, and **Approve & next** when it is on.

Both color and grayscale photos are initially visible. **Filters → Photos** can narrow the set. **Filters → Multiple cards only** restricts the list and Previous/Next navigation to photos with at least two reference cards (22 photos / 81 cards in this queue). Turn off **Incomplete only** to include completed photos. The multiple-card preference is remembered; frame numbers stay unchanged. F1–F502 refer to the same photos as R001–R502 in the model comparison; C numbers here identify reference annotations rather than model detections.

The queue is `.artifacts/card-geometry/reference-corner-review/queue-v1.json`. Checks are stored in the separate append-only `journal-v1.jsonl` beside it. The journal is created on the first save. Its sidecar preserves the canonical image and annotation bindings. These remain evaluation photos; staging or checking them does not assign them to training or rewrite frozen benchmark labels or scores.

Launch configuration: `reference-corner-labeler` in `.claude/launch.json`. The server log and PID are in the same artifact directory. Queue generation uses `tools/card-geometry/build_reference_corner_label_queue.py --release <frozen-release> --canonical-corpus <corpus.jsonl> --output <new-queue.json>`; it refuses to overwrite an existing queue. Every record hash, canonical image binding and annotation polygon is verified. All 561 seed outlines passed the server's save validation without writing approvals.

Validation: two reference-queue tests cover winding, source preservation, canonical bindings and save/reopen/export. Ten existing archive server tests and the browser-state test suite pass. The browser verified all 502 options, source-polygon overlays, unconfirmed orientation and the rectified crop. The earlier completed annotation journal retains SHA-256 `565ed494998606b8ee5a487869e4acaeeaa51e60218e1102e1d82cfe97f2581e`.

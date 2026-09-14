# Reference preservation — September 14, 2026

Preserved a **7.91 GB deduplicated data archive**, plus manifests and restore tools, in:

`Reference/TCGer-Geometry-Archive/2026-09-14/`

The main gaps were exact frozen release trees, newer model/index files, experiment data outside the original label-backup scope, and additional source/review images. Existing Reference session photos and live label backups remain their primary copies. This operation copied data; it did not delete, move or relink the working files or free local disk space.

The archive retains **395,732 repository-relative file paths as 91,526 distinct content objects**. It includes all **32 complete local geometry release versions**, 122 retained model/index file paths, experiment records, and 2,921 additional source/review image paths. Counts overlap across versions; these are not unique-card counts. Detailed scope and exclusions are in the archived source plan and README.

Only **14/32 direct release-manifest paths** matched the current private Hugging Face dataset revision. The other 18 paths were absent at that revision; older commits and remote tarballs were not exhaustively searched. All four currently selected checkpoint hashes separately matched their pinned model repository revisions and are included in the archive. This preserves exact local versions without assuming every historical variant is recoverable from the current Hub branch.

## Verification

- Every source record/image with a pinned hash matched before inclusion.
- Every archived object was read back and passed SHA-256 verification.
- All **1,206 files** in a temporary restore of `real-geometry-evaluation-v6-full-aliases-v2` matched the manifest.
- The normal benchmark loader read **600 photos / 700 card targets** from that restore with corpus hash `631cc7f9ac24b19d5e7587f5c5aefa401f911cfcf4ed52ab6858ea29d3740dd7`.
- A fresh automatic snapshot saved 2,681 state/code/report files. Existing native exports for six stopped FiftyOne datasets remain in Reference; no newer database export is claimed.
- The verification establishes local bytes in the Drive folder. Google Drive server-side synchronization was not independently verified.

## Restore and future saves

The archive includes `restore.py` and a detailed README. The helper needs only Python 3.11+ and its standard library. It can verify the archive and restore a chosen path prefix into a new directory, creating independent copies instead of shared hardlinks. A full restore of all historical paths requires about **36.6 GB**, so restoring a chosen dataset or experiment is usually more practical.

Code is maintained as `tools/card-geometry/reference_asset_archive.py`; the included tool copy is bound by the archive's `archiveToolSha256`. Source code itself remains in GitHub. Studio launch paths may require updating on another machine after restoring and verifying the immutable release files.

This is a dated asset snapshot. Existing label/journal backups continue automatically. Future dataset versions and new model binaries should receive another explicit milestone archive; this operation did not add a recurring bulk archive job. Dependencies, live databases, staging/runtime caches, incomplete releases without manifests, and most regenerated thumbnails/overlays were excluded. Published catalog/compositor caches retain their recipes and source bindings.

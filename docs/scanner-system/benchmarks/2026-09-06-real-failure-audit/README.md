# Real-image failure audit — 2026-09-06

Purpose: distinguish post-framework detection misses, bad corner geometry, shared decoder rejection, crop quality and recognition labeling limits before choosing further training. This is a post-benchmark diagnostic; the original reports and thresholds remain frozen.

The input manifest pins the original repaired YOLOX epoch-50 checkpoint and original round-two YOLO11s best checkpoint. The diagnostic captures native boxes and raw quads before shared quad filtering, then records accepted quads and rejection reasons. Native boxes are already after each framework's score filtering and NMS; their absence does not prove the network produced no earlier proposals.

Selection was recorded before execution: all 600 real evaluation images receive the frozen inference path only; 88 training-corpus validation records are selected deterministically, taking up to eight per source-kind/archive/scene/known-corner group. Only those validation records receive the YOLO11s RGB-array versus BGR-array intervention. The intervention must also reproduce PIL-input predictions. No training or held-out parameter sweep is performed.

The declaration and exact commands are in `input-publication.json` and the candidate command files. Results will be added after the two bounded inference jobs complete.

# Shared card-geometry contract fixtures

This directory contains the model-independent executable evidence for
`docs/scanner-system/shared-card-geometry-plan-2026-09-02.md`.

- `fixtures/validation-nms.v1.json` starts after a model-specific head has
  decoded candidates. It fixes validation, inclusive quad-NMS behavior,
  canonical rounding, partial containment, and stable output ordering.
- `fixtures/context-letterbox-roundtrip.v1.json` keeps exterior context
  padding separate from aspect-ratio letterboxing and proves their inverse
  coordinate chain. It intentionally uses continuous source pixels: the
  normalized pixel-center versus image-edge choice remains part of the crop
  parity experiment. Its numeric margin and letterbox values exercise the
  transform only; they are not production defaults.
- `reference_geometry.py` is a dependency-free reference implementation for
  checking the fixtures. Production Swift, Kotlin, and TypeScript decoders do
  not import it; each implementation must pass the same fixtures.

Run the checks from the repository root:

```sh
python3 -m unittest tools/card-geometry/test_reference_geometry.py
```

Raw-tensor fixtures are model-specific and belong to the later export step.

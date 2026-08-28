# Game package hardening and capability roadmap

The direct-URL catalog implementation is a useful compatibility baseline, not
yet a general untrusted binary plug-in system. Work should proceed in this
order.

## P0 — before community scanner or pack activation

1. Create one shared positive/negative conformance corpus and make TypeScript,
   Swift, and Kotlin enforce the same manifest, catalog, filter, and URL rules.
2. Stream downloads with incremental SHA-256 and hard byte/time limits instead
   of buffering before checking size.
3. Stage complete generations and activate through one atomic pointer; retain
   the previous generation for rollback and audit active files at startup.
4. Bind an installed game ID to its original source authority/publisher key.
   Reject downgrade and require an explicit takeover for a different origin.
5. Add a signed registry before handing community model/archive bytes to ONNX,
   Core ML, or a pack renderer.

## P1 — identity and lifecycle

- Namespace immutable game, card, printing, face, and artwork IDs.
- Separate catalog identity, metadata, and artwork revisions.
- Define aliases, tombstones, replacements, migrations, formats, and
  physical-versus-digital scope.
- Preserve namespace, authority, catalog revision, printing ID, and a compact
  metadata snapshot in collection exports so uninstalling a package never
  makes owned records unintelligible.
- Add ETag/conditional update checks, update reasons, disk/temporary/download
  estimates, storage-quota preflight, last-checked state, and coordinated
  dependency removal.

## P2 — independently versioned capabilities

Use a common envelope for catalog, artwork, sealed products, offline packs,
scanner, formats/legality, localization, and optional pricing snapshots. Each
capability declares schema/version, manifest asset, download/temporary/
installed bytes, required/optional status, dependency hashes, compatibility,
and update reason. Unknown required capabilities block activation; unknown
optional capabilities may be preserved and ignored.

Artwork belongs in a separate sharded capability with immutable hashes, MIME,
pixel, byte, thumbnail/full, licensing, and per-set download policy. Catalog
image URLs alone are mutable and can become tracking or resource-exhaustion
inputs.

## P3 — product metadata

- Effective-dated format legality, separate from card identity.
- Pricing snapshots as expiring sourced quotes with provider, variant,
  condition, finish, language, currency, amount, timestamp, and attribution.
- BCP 47 localization bundles with stable message IDs.
- Accessible labels and semantic colors; accent color cannot be the only state
  cue.
- Source revision, attribution, redistribution status, rights URL, and SPDX
  license expression for every capability.

## Standards to reuse

- [WHATWG Storage](https://storage.spec.whatwg.org/) for quota estimates and
  persistent browser storage.
- [RFC 9110 conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#section-13)
  for cheap update discovery.
- [RFC 5646](https://www.rfc-editor.org/info/rfc5646/) for language tags.
- [SPDX license expressions](https://spdx.github.io/spdx-spec/v3.0.1/annexes/spdx-license-expressions/)
  for machine-readable licensing.
- [The Update Framework](https://theupdateframework.github.io/specification/draft/)
  for signed metadata, delegation, expiry, rollback, and freeze protection.
- [WCAG 2.2](https://www.w3.org/TR/wcag/) for non-color cues and contrast.

# Cloudflare R2 asset delivery

TCGer publishes generated catalog packs to an R2 Standard bucket. The
production URL layout is:

```text
https://assets.tcger.ahmadjalil.com/catalogs/manifest.json
https://assets.tcger.ahmadjalil.com/catalogs/{content-addressed pack}.json
https://assets.tcger.ahmadjalil.com/pack/manifest.json
https://assets.tcger.ahmadjalil.com/pack/objects/{content-addressed asset}
https://assets.tcger.ahmadjalil.com/scan-index/manifest.json
https://assets.tcger.ahmadjalil.com/scan-index/objects/{content-addressed model or index}
```

No Worker is required. R2's custom-domain integration serves the objects
directly through Cloudflare Cache, which avoids an extra runtime and R2 binding.

## One-time setup

Authenticate Wrangler and create a Standard bucket:

```bash
npx wrangler login
npx wrangler r2 bucket create tcger-assets --location wnam
```

Apply browser CORS and connect the production hostname. Replace the zone id with
the Cloudflare zone id for `ahmadjalil.com`:

```bash
npx wrangler r2 bucket cors set tcger-assets --file cloudflare/r2-cors.json
npx wrangler r2 bucket domain add tcger-assets \
  --domain assets.tcger.ahmadjalil.com \
  --zone-id YOUR_ZONE_ID
```

Do not enable the `r2.dev` development URL for production. In the Cloudflare
dashboard, create a Cache Rule for hostname `assets.tcger.ahmadjalil.com` that
marks eligible responses as cacheable. JSON is not cached by default. Enable
Smart Tiered Cache for the zone as well.

The object metadata provides the intended browser policy:

- `catalogs/manifest.json`: 5-minute cache with revalidation.
- Content-addressed catalog packs: one year, immutable.
- `scan-index/manifest.json`: always revalidate; the service worker supplies
  the offline fallback.
- Content-addressed scanner models, indexes, and gates: one year, immutable.

## Publishing credentials

Create an R2 API token scoped to Object Read & Write for `tcger-assets`. Export
the credentials locally or add them as GitHub Actions secrets:

```bash
export CLOUDFLARE_ACCOUNT_ID=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_BUCKET=tcger-assets
```

Do not commit these values. Bucket/domain/CORS administration should use the
separate Wrangler login or an admin-scoped token rather than the publishing
token.

After adding the three secrets, the manual **Publish catalog assets** workflow
builds fresh packs and publishes the catalog manifest last. It intentionally
has no schedule so upstream downloads and R2 writes happen only when a
maintainer requests a release.

## Publish catalogs

Build and inspect the exact R2 operations first:

```bash
npm run catalogs:build
npm run assets:r2:publish-catalogs -- --dry-run
```

Then publish. Packs are SHA-256 checked, gzip-compressed, and uploaded before
the mutable manifest, so clients never observe a manifest pointing at a missing
object.

```bash
npm run assets:r2:publish-catalogs
```

## Client configuration

The web defaults to local `/catalog` packs in development. Production builds
should set:

```bash
NEXT_PUBLIC_CATALOG_BASE_URL=https://assets.tcger.ahmadjalil.com/catalogs
NEXT_PUBLIC_SCAN_INDEX_BASE_URL=https://assets.tcger.ahmadjalil.com/scan-index
```

## Publish the browser scanner bundle

Generate the local model/index artifacts as described in
`frontend/public/scan-index/README.md`, then validate the content-addressed R2
plan:

```bash
npm run assets:r2:publish-scan-index -- --dry-run
```

Publish with the current Wrangler login (or omit `--wrangler` and provide the
S3-compatible R2 credentials documented above):

```bash
npm run assets:r2:publish-scan-index -- --wrangler
```

The publisher validates every manifest entry, rewrites ArcFace `modelUrl` to
the ONNX object's SHA-256 key, uploads all immutable objects, and publishes the
mutable manifest last. A model update is therefore atomic from the browser's
perspective and is discovered the next time scanning starts.

The iOS target contains the equivalent `TCGER_CATALOG_BASE_URL` build setting.
Its remote source persists downloaded packs on device and falls back to bundled
packs when the network or CDN is unavailable.

Card-image storage is intentionally outside this catalog-delivery design.
Clients continue using their existing image sources until that system is
designed and deployed separately.

## Pack-opening wrappers

Projected wrapper sheets remain in the Google Drive authoring folder rather
than being committed to the application repository. Each studio export carries
its stable id, label, card pool, and accent in `manifest.entry.json`. The
publisher discovers every such entry recursively, so neither web nor iOS keeps
a separate hard-coded list of selectable packs. The current labels follow
SealedDex's Base set artwork names: Charizard, Venusaur, and Blastoise.

Validate the Drive exports and inspect the R2 plan:

```bash
npm run assets:r2:publish-pack-assets -- \
  --projected-dir "/path/to/Base set - projected" \
  --dry-run
```

Publish with the local Wrangler login:

```bash
npm run assets:r2:publish-pack-assets -- \
  --projected-dir "/path/to/Base set - projected" \
  --wrangler
```

For CI or another machine, omit `--wrangler` and provide the same S3-compatible
R2 credentials used by the catalog publisher. The mesh and three cover sheets
are stored under content-addressed object keys with a one-year immutable cache;
`pack/manifest.json` is uploaded last with five-minute revalidation. Production
web builds set `NEXT_PUBLIC_PACK_ASSET_BASE_URL` to the custom-domain origin.

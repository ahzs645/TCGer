# Cloudflare R2 asset delivery

TCGer publishes generated catalog packs to an R2 Standard bucket. The
production URL layout is:

```text
https://assets.tcger.ahmadjalil.com/catalogs/manifest.json
https://assets.tcger.ahmadjalil.com/catalogs/{content-addressed pack}.json
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
```

The iOS target contains the equivalent `TCGER_CATALOG_BASE_URL` build setting.
Its remote source persists downloaded packs on device and falls back to bundled
packs when the network or CDN is unavailable.

Card-image storage is intentionally outside this catalog-delivery design.
Clients continue using their existing image sources until that system is
designed and deployed separately.

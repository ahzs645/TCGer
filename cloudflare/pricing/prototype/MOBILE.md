# Native Pokémon prices: direct first, R2 backup

Implemented September 14, 2026 for iOS on-device Prices/scanner and Android
on-device Prices plus the Pokémon scanner. Other games and explicit personal
JustTCG selections keep their existing providers. Native clients send no user
identity, auth token, or API key to TCGCSV or the backup. Firebase, App Attest,
and Play Integrity are not used by this path.

## Read path

1. Read persisted set prices first and render the saved market references.
2. Check TCGCSV `last-updated.txt` at most once per 24 hours after a successful
   check; fetch the group index when the source changes.
3. Download products and prices only for sets needed by the collection/scanner.
   Each set has a persisted 24-hour attempt guard, including manual refreshes.
4. On upstream failure, read the backup manifest and the required set shard.
   Verify SHA-256, byte length, group ID, and source timestamp before saving.
5. If both origins fail, retain the previously saved price and its original
   source date. A failed refresh never invents a current price timestamp.

Clients serialize requests, space them by at least 250 ms, persist a 1,500-request
rolling daily budget, apply a ten-minute failure cooldown, and honor longer
`Retry-After` values. Successful backup metadata is cached for a day; failed
shard downloads have a ten-minute cooldown. Responses are capped at 8 MB, cached
sets at 256, and cache files are written atomically. These client controls reduce
accidental load; a modified client can bypass them.

This follows the daily refresh, custom User-Agent, and pacing guidance in
[TCGCSV's documentation](https://tcgcsv.com/docs). Its restrictive browser CORS
policy does not affect native HTTP. The documentation describes server-side
cache ingestion; no mobile availability guarantee or redistribution license is
inferred from public endpoint access.

## Matching and display

- Category 3, English only. Set name (optionally stripping the provider's colon
  prefix) or abbreviation must select exactly one group.
- Require an exact normalized card name and collector number within that group.
  iOS can also use an explicit TCGplayer product ID within the selected group.
  Sealed products and ambiguous matches are rejected.
- Preserve printing/edition. With no finish, only an unambiguous Normal or
  Holofoil reference is accepted. Reverse holo and edition-specific prices
  require the matching finish; no fuzzy match or cheapest-price selection.
- Use `marketPrice` in USD; never substitute `lowPrice` or another field for null.
- Labels show `TCGCSV market`, printing, source date, and `backup` when applicable.
  These are market references, not condition-specific valuations. Collection
  condition preferences do not turn this feed into Near Mint/played prices.
  Explicit personal JustTCG remains the condition-specific route.
- An unmatched card keeps its stored value. Coverage is intentionally incomplete
  where the two catalogs use different names or lack exact identity metadata.

## Backup delivery

Live manifest:
<https://assets.tcger.ahmadjalil.com/prices/pokemon/manifest.json>

The existing `tcger-assets` bucket serves **only the exported public raw-price
fields** under `prices/pokemon/`. The complete SQLite/JSON snapshot remains in
private `tcger-pricing-prototype`. No lookup Worker, D1 database, per-request
upstream proxy, or dynamic transformation is involved in mobile fallback.

`build_mobile_backup.py` creates content-addressed per-set JSON files. The
publisher validates all local hashes, uploads four files concurrently, verifies
every download through the mobile delivery URL, then publishes the manifest.
Immutable objects cache for one year; the manifest caches for five minutes.
The first publication has 220 groups with source timestamp
`2026-09-13T20:05:38.000Z`.

This is a public cached fallback, **not an authenticated endpoint or a hard
billing cap**. The separate, undeployed attestation/quota Worker does not protect
these static URLs. Normal direct-feed traffic avoids our infrastructure, but
cache misses and deliberate requests can still incur R2 operations.

## Publishing and status

```sh
python3 cloudflare/pricing/prototype/build_mobile_backup.py \
  --sqlite cloudflare/pricing/prototype/tcgcsv-output/catalog.sqlite \
  --out cloudflare/pricing/prototype/mobile-output
node cloudflare/pricing/prototype/publish_mobile_backup.mjs \
  cloudflare/pricing/prototype/mobile-output --publish
```

The manual workflow publishes mobile shards first, then advances the private
snapshot pointer. If publication fails, the old private pointer allows the next
run to retry the same build. A failure must not advance the sync baseline.

**The backup is published. R2 updates are manual only, by user preference.**
The workflow has only a `workflow_dispatch` trigger; there is no schedule or
variable that enables automatic publishing. The mobile apps can still refresh
directly from TCGCSV independently of this fixed backup.

Local manual publishing uses the existing Wrangler login. Optional future manual
GitHub runs require `CLOUDFLARE_ACCOUNT_ID`,
and a scoped `PRICING_CLOUDFLARE_API_TOKEN` with object read/write access to both
`tcger-pricing-prototype` and `tcger-assets`. CI credentials are not needed to
serve the snapshot already published. No credentials were copied from local OAuth.

## Checks

```sh
mobile-apps/ios/scripts/test-tcgcsv-pricing.sh
# With Android SDK and Java 17 configured:
cd mobile-apps/android
./gradlew :app:testDebugUnitTest --tests '*TcgCsvPriceClientTest'
```

Tests exercise exact matching, editions, null prices, persistent daily limits,
concurrent callers, rate-limit fallback, checksum rejection, and offline cache.
The iOS script runs the same Foundation-only client tests on macOS without
booting a simulator. App builds and these tests do not establish physical-device
or interactive UI validation.

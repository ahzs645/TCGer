# Full Pokémon raw-price snapshot

See the [verified data timeline](TIMELINE.md) for historical coverage and an
actual five-date Lugia VSTAR price sample from the daily archives.

The category-3 TCGCSV importer builds our own SQLite database directly from
the public product and price feeds. No upstream API key, app attestation,
Firebase, or paid price-provider call is involved.

The first complete import on September 14, 2026 made 443 requests: the update
stamp, the groups collection, products + prices for all 220 groups, and a final
stamp consistency check. Source build: **2026-09-13 20:05:38 UTC**.

| Contents | Count |
| --- | ---: |
| Groups | 220 |
| Products (including sealed products) | 32,813 |
| Product × printing price rows | 45,395 |
| Rows with a market price | 44,480 |
| Empty groups | 3 (609, 610, 23095) |

The compressed SQLite snapshot is **7,531,838 bytes** (53,682,176 bytes
uncompressed). The full JSON export is **4,005,862 bytes compressed**. Market,
low, mid, high, and direct-low fields are preserved separately; nulls remain
null. No mid/low price is silently substituted for a missing market price.

## Storage and identity

The destination is the existing private `tcger-pricing-prototype` R2 bucket.
The previous 102-card TCGdex sample's immutable objects remain available, while
`manifest.json` now selects the full TCGCSV snapshot. Object names are SHA-256
addressed, and the publisher downloads each upload to verify its bytes before
publishing the manifest last.

- `groups`: provider group IDs and original metadata.
- `products`: exact group/product IDs, names, collector numbers, original JSON.
- `prices`: one row per group/product/printing, five price fields, USD currency,
  source build time, and actual download time.
- `source_files`: download times and explicit empty/404 collections.
- `metadata`: source stamp and coverage counts.

`source_as_of` is the **TCGCSV build timestamp**, not an invented per-card sale
or observation timestamp. Product/group `modifiedOn` is retained in raw JSON
without assuming a timezone. Printing names such as `1st Edition Holofoil` and
`Unlimited Holofoil` remain distinct.

This is the complete current category-3 feed, not every Pokémon language,
condition or grading market. TCGCSV does not provide condition-level SKUs here.
Category 85 (Japanese) and price history are outside this import.

The export schema is `tcger-tcgcsv-raw-prices-v1`, with provider IDs. It is
deliberately separate from `tcger-hosted-prices-v1`, whose card IDs refer to our
internal catalog. The [native integration](MOBILE.md) now resolves exact set/name/number matches
on the phone, reads TCGCSV first, and uses public per-set R2 shards as fallback.
The full SQLite remains private; uploading it does not create a SQL endpoint.
The separate D1 lookup Worker remains undeployed.

## Repeat a local sync

From the repository root:

```sh
python3 cloudflare/pricing/prototype/sync_tcgcsv.py \
  --out cloudflare/pricing/prototype/tcgcsv-output \
  --cache cloudflare/pricing/prototype/tcgcsv-cache

node cloudflare/pricing/prototype/publish.mjs \
  cloudflare/pricing/prototype/tcgcsv-output tcger-pricing-prototype --publish
```

The sync reports `changed: false` after one update-stamp request if the source
is unchanged. Do not republish in that case. `--previous PATH` can use a manifest
downloaded from R2 as the comparison baseline on a fresh machine.

New full source imports are spaced at least 24 hours apart. Requests are
sequential, at least 250 ms apart, with an identifiable User-Agent. Retries are
bounded, respect short `Retry-After` delays, and stop for longer throttling.
The local locked ledger reserves calls before sending them and caps a run at
1,500 requests and a UTC day at 2,000. Successful responses are cached per source
stamp so interrupted runs can resume. Separate machines do not share this
ledger; use a single publishing machine.

A changed source stamp during the pull, missing product references, duplicate
identities, invalid amounts, incomplete API responses, or a coverage reduction
of more than 10% aborts the build. The prior published database stays active.
`--allow-coverage-drop` exists for an operator-reviewed upstream catalog change;
the manual workflow never sets it.

Example SQL (Lugia VSTAR):

```sql
SELECT p.product_id, p.name, q.printing, q.market_price, q.low_price,
       q.source_as_of, q.retrieved_at
FROM products p JOIN prices q USING (group_id, product_id)
WHERE p.product_id = 451396;
```

## Manual publishing only

The R2 snapshot is already published. Automatic R2 updates are intentionally
not configured, per the user's preference. The local publishing commands above
can update it when requested.

`.github/workflows/publish-pokemon-prices.yml` contains only `workflow_dispatch`,
with no scheduled trigger. It restores resumable state, checks the previously
published manifest, builds changed data, then publishes mobile shards followed
by the private snapshot. Runs are serialized.

The workflow supports manual GitHub runs only. Running it requires `CLOUDFLARE_ACCOUNT_ID` and a scoped
`PRICING_CLOUDFLARE_API_TOKEN` with object read/write access to both
`tcger-pricing-prototype` and `tcger-assets`. The current published backup needs
no CI setup. Do not copy the local broad OAuth login into CI.

Immutable objects are retained for rollback. Keep the current snapshot available
while manual updates are paused; avoid blanket age-based deletion.

## Verified

SQLite `integrity_check` returned `ok`, with no foreign-key violations. A second
real sync used exactly one request and skipped the bulk download. Tests cover
printing/date preservation, null values, duplicate and orphan rejection,
partial collections, coverage collapse, source rollover, cached resume and
request limits.

Source references: [TCGCSV usage guidance](https://tcgcsv.com/docs),
[bulk-download FAQ](https://tcgcsv.com/faq),
[Pokémon groups](https://tcgcsv.com/tcgplayer/3/groups).

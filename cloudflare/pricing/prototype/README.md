# Private R2 pricing prototype

The bucket's active manifest has been upgraded to the
[full 220-group TCGCSV snapshot](TCGCSV.md). The Base Set sample below is retained
as an earlier prototype; its immutable objects remain available.

The bucket `tcger-pricing-prototype` contains a small, real Pokémon Base Set
snapshot fetched from TCGdex on 2026-09-14 UTC. There are 102 card records and
101 USD market quotes. Missing prices are absent, not zero. Printing labels and
provider observation timestamps are retained; no condition or edition is inferred.

This is **not The Tin's full database**. The supplied checkout contains a catalog
test fixture with five price rows. On 2026-09-14, normal unauthenticated GETs to
both `https://apithetin.reyes.ai/catalog/manifest.json` and
`https://backupthetin.reyes.ai/catalog/manifest.json` returned HTTP 401 with
`{"error":"unauthenticated"}`. Their server implementations require an App
Attest session or Firebase App Check token respectively. Importing that exact
dataset needs an exported SQLite file or a developer-provided download.

## Published objects

The bucket's public `r2.dev` access is disabled; no custom domain or Worker is
attached. Access currently uses the operator's Cloudflare credentials.

| Object | Compressed bytes |
| --- | ---: |
| `objects/database-43f2cab1ca6685f7ce801dce3b2f4a8b58b8bcfe9cd014c522eaaefa33c4dc89.sqlite.gz` | 5,624 |
| `objects/prices-26deda3bde60811b8d57e48898867d72daf882be653cdac867995bb28b2e3b22.json.gz` | 1,282 |
| `manifest.json` | 1,019 (uncompressed) |

The database is 45,056 bytes uncompressed. Each object, including the manifest,
was downloaded back from R2 and checked against its local SHA-256 digest. The
manifest was published only after the database and JSON objects passed verification.
Snapshot ID: `465254e5fcd0f1de3c95a8e443d4d54e1fccd9af783732808b842230663466d0`.

R2 stores files; this upload does **not** expose a live SQL or card lookup API.
The JSON export uses `tcger-hosted-prices-v1` and passes the hosted-pricing
importer's validation, so it can seed D1 later. Mobile apps are not connected to
this prototype. Neither Android setup nor Firebase is needed to inspect it.

## Inspect locally

The generated files are in `cloudflare/pricing/prototype/output/` (gitignored).
From the repository root:

```sh
sqlite3 cloudflare/pricing/prototype/output/catalog.sqlite \
  'SELECT c.id,c.name,q.printing,q.amount,q.currency,q.observed_at FROM cards c JOIN quotes q ON q.card_id=c.id WHERE c.id="base1-4";'
```

To retrieve the database again with the existing Wrangler login:

```sh
./node_modules/.bin/wrangler r2 object get \
  tcger-pricing-prototype/objects/database-43f2cab1ca6685f7ce801dce3b2f4a8b58b8bcfe9cd014c522eaaefa33c4dc89.sqlite.gz \
  --file /tmp/tcger-pricing-prototype.sqlite.gz --remote
```

## Build or replace the snapshot

These commands only build local artifacts. An existing database is copied using
SQLite's backup API, including committed WAL data, before its integrity check
and compression. Its tables and data are preserved. An existing Tin database
is packaged as SQLite only; its mixed-source price tables are not automatically
translated into attributed hosted-API quotes.

```sh
python3 cloudflare/pricing/prototype/build_snapshot.py \
  --sqlite '/absolute/path/catalog.sqlite' \
  --out cloudflare/pricing/prototype/output

# Or reproduce the small public-feed prototype (at most 300 cards, four requests at a time).
python3 cloudflare/pricing/prototype/build_snapshot.py \
  --tcgdex-set base1 --out cloudflare/pricing/prototype/output

# Validate all local sizes/checksums and print the upload plan.
node cloudflare/pricing/prototype/publish.mjs cloudflare/pricing/prototype/output

# Upload and verify, then update manifest.json last.
node cloudflare/pricing/prototype/publish.mjs \
  cloudflare/pricing/prototype/output tcger-pricing-prototype --publish
```

Publication is manual. There is no scheduler or upstream key. Old immutable
objects remain for rollback; add retention before scheduling repeated snapshots.
The publisher restricts bucket names to the dedicated prototype prefix to avoid
accidentally publishing through the existing public catalog bucket.

## iPhone extraction attempt

`capture_iphone.py` uses the paired device's MobileBackup2 service with an exact
allowlist for The Tin's `catalog.sqlite`, WAL/SHM companions and
`catalog-state.json`. Other payloads are drained without being saved; backup
metadata is retained. It does not restore the phone or change backup encryption.
It also stops if the destination drops below 5 GiB free. This is not a restorable
full-phone backup.

The attempt on iOS 26.6.2 stopped with `NotEnoughDiskSpaceError` before any
catalog payload was transferred, with about 26 GiB available on the Mac. The
phone's backup-space check still applies despite filtering. Use a destination
with sufficient available space, or supply an app/developer export instead.
No iPhone catalog has been extracted or uploaded.

```sh
uvx --from pymobiledevice3==10.4.1 python \
  cloudflare/pricing/prototype/capture_iphone.py \
  --device DEVICE_UDID --out /path/to/filtered-capture
```

## Checks

```sh
python3 -m unittest discover -s cloudflare/pricing/prototype -p 'test_*.py'
node --test cloudflare/pricing/test/prototype.test.mjs
```

Checks cover exact variants/dates, missing prices, consistent WAL backups,
compression checksums, upload-plan validation, tampering and path traversal.

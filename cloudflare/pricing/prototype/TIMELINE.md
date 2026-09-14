# Price-data timeline

Verified September 14, 2026. The private R2 database currently contains one
complete category-3 price snapshot, not a historical time series.

| Date | Meaning |
| --- | --- |
| February 8, 2024 | Earliest daily archive documented by TCGCSV; downloaded and inspected |
| September 13, 2026, 20:05:38 UTC | Source build represented by all 45,395 rows in our current database |
| September 14, 2026, 14:37:26–14:39:20 UTC | Our download window for the source files |

TCGCSV documents daily archives from February 8, 2024 onward. Through September
13, 2026, that spans **949 calendar dates**, about two years and seven months.
This is a potential archive range, **not confirmation that all 949 files exist
or that every product has a quote every day**. New products begin later, products
and printings can be absent, and null prices must remain missing.

The published group metadata spans January 9, 1999 through November 6, 2026,
including upcoming sets. Those dates describe products/set releases, not price
history or future price predictions. `source_as_of` is a feed-build timestamp,
and each archive's date is a daily snapshot date, not an individual sale time.
HTTP `Last-Modified` is not a reliable substitute: the earliest archive's HTTP
timestamp is November 2024, although its contents are under February 8, 2024.

## Verified example: Lugia VSTAR

Exact identity: Pokémon category **3**, Silver Tempest group **3170**, TCGplayer
product **451396**, printing **Holofoil**. Currency: **USD**.

| Archive date | Market | Low |
| --- | ---: | ---: |
| [2024-02-08](https://tcgcsv.com/archive/tcgplayer/prices-2024-02-08.ppmd.7z) | $3.18 | $1.99 |
| [2025-09-13](https://tcgcsv.com/archive/tcgplayer/prices-2025-09-13.ppmd.7z) | $3.06 | $1.50 |
| [2026-08-13](https://tcgcsv.com/archive/tcgplayer/prices-2026-08-13.ppmd.7z) | $6.38 | $3.49 |
| [2026-09-12](https://tcgcsv.com/archive/tcgplayer/prices-2026-09-12.ppmd.7z) | $7.33 | $5.40 |
| [2026-09-13](https://tcgcsv.com/archive/tcgplayer/prices-2026-09-13.ppmd.7z) | $6.96 | $5.40 |

These are five sampled observations, not a continuous trend. Each archive was
downloaded, and its exact `DATE/3/3170/prices` member was decoded by 7-Zip with
CRC verification. The September 13 row matches the current SQLite snapshot's
market and low prices. Market and low are different provider metrics; neither
is a condition-specific quote or proof of an individual sale.

The five compressed archive files total about 17.8 MB. They contain price files
for multiple categories, not just Pokémon. The inspector reads one selected
member into memory and never extracts archive paths onto the filesystem.
Raw archives and sample evidence remain local in the gitignored cache/output
directories; they have not been uploaded to R2.

## Reproduce the sample

Requires Python 3 and `7z` or `7zz`:

```sh
python3 cloudflare/pricing/prototype/inspect_history.py \
  --dates 2024-02-08 2025-09-13 2026-08-13 2026-09-12 2026-09-13 \
  --group 3170 --product 451396 --printing Holofoil \
  --cache cloudflare/pricing/prototype/tcgcsv-cache \
  --out cloudflare/pricing/prototype/tcgcsv-output/lugia-history-sample.json
```

The inspector permits at most 12 dates per call, reuses local archives, and
shares the sync's lock, request spacing, retry rules and daily request budget.
It returns missing observations as absent and rejects duplicate matches.
Evidence includes each source URL, selected member, archive size and SHA-256.

## Next implementation boundary

A full history import should persist daily rows keyed by
`(category_id, group_id, product_id, printing, archive_date)` and retain all
price metrics independently. Import dates incrementally, record missing archive
dates, and never join prices solely by card name. Product-name metadata from
today must be labeled as current metadata when attached to an older price.

Start with a recent history window, then extend backward with resumable batches.
R2 publishing is manual only by request; optional manual CI runs need publishing credentials. The mobile chart and hosted history-query
endpoint are not implemented.

References: [TCGCSV archive documentation](https://tcgcsv.com/faq),
[update and ingestion guidance](https://tcgcsv.com/docs).

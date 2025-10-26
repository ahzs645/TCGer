# Scryfall Bulk Service

This lightweight HTTP service keeps a copy of a Scryfall bulk export on disk and serves two endpoints that mimic the pieces of the public API used by `MagicAdapter`:

- `GET /cards/search?q=<query>&limit=<n>` returns a Scryfall-style list response
- `GET /cards/<id>` returns a single card by Scryfall ID or `oracle_id`
- `GET /health` exposes the current dataset metadata
- `POST /admin/refresh` forces a refresh (the service refreshes automatically on the interval)

Configuration happens via environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `SCRYFALL_BULK_TYPE` | `oracle_cards` | Bulk dataset to load (see https://api.scryfall.com/bulk-data) |
| `SCRYFALL_BULK_REFRESH_MS` | `43200000` | Interval between metadata checks in milliseconds |
| `SCRYFALL_BULK_MAX_RESULTS` | `50` | Hard cap for search responses |
| `SCRYFALL_BULK_DATA_DIR` | `/data` | Directory used to persist the downloaded JSON |
| `SCRYFALL_BULK_CACHE_IMAGES` | `true` | Enable local caching of card artwork referenced by the bulk dataset |
| `SCRYFALL_BULK_IMAGE_DIR` | `/data/images` | Destination directory for cached images |
| `SCRYFALL_BULK_IMAGE_FIELD` | `border_crop` | Preferred `image_uris` field to download (e.g. `normal`, `large`) |
| `SCRYFALL_BULK_IMAGE_FALLBACKS` | `art_crop,large,normal,small` | Comma-separated fallback order if the preferred field is missing |
| `SCRYFALL_BULK_IMAGE_MAX_PER_REFRESH` | `250` | Maximum number of new images to fetch per refresh (set `0`/unset for unlimited) |
| `SCRYFALL_BULK_IMAGE_CONCURRENCY` | `4` | Parallel download workers for the image cache |
| `PORT` | `4010` | HTTP listen port |

When paired with Docker (see `docker/docker-compose.yml`), mount a named volume at `/data` so the service can reuse the downloaded file between restarts.

When image caching is enabled, the service will populate `/data/images` with `{card-id}.jpg` (and additional face suffixes), allowing downstream tools to work entirely offline. The download throttle keeps refreshes lightweight; raise or disable the limit if you want the full dataset cached in one pass.

Point the backend at the service by setting `SCRYFALL_API_BASE_URL=http://scryfall-bulk:4010`.

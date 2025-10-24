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
| `PORT` | `4010` | HTTP listen port |

When paired with Docker (see `docker/docker-compose.yml`), mount a named volume at `/data` so the service can reuse the downloaded file between restarts.

Point the backend at the service by setting `SCRYFALL_API_BASE_URL=http://scryfall-bulk:4010`.

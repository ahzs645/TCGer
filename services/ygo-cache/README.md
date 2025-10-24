# Yu-Gi-Oh! Cache Service

This service mirrors the behaviour of YGOPRODeck's `/cardinfo.php` endpoint using a locally cached dataset. The cache keeps a full copy of the Yu-Gi-Oh! catalog on disk so the backend can perform searches without repeatedly hitting the public API (and risking rate limits).

## Features
- Periodically downloads the entire card database via the official API (once every 12 hours by default).
- Persists the downloaded JSON in `/data` and restores it on restart.
- Exposes the minimal endpoints the backend relies on:
  - `GET /cardinfo.php` supporting `fname`, `name`, `id`, `archetype`, `type`, `race`, `attribute`, `cardset`, numeric filters (`atk`, `def`, `level`, `link`, `scale`), and pagination (`num`, `offset`, `sort`, `order`).
  - `GET /checkDBVer.php` for version details.
  - `GET /randomcard.php` to return a random cached card.
  - `GET /health` for service metadata.
  - `POST /admin/refresh` to force an immediate refresh.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `YGO_SOURCE_BASE_URL` | `https://db.ygoprodeck.com/api/v7` | Remote API base used when downloading the dataset |
| `YGO_CACHE_REFRESH_MS` | `43200000` | Interval between version checks (milliseconds) |
| `YGO_CACHE_PAGE_SIZE` | `20` | Default page size when `num` is omitted |
| `YGO_CACHE_MAX_PAGE_SIZE` | `200` | Safety cap applied to `num` |
| `YGO_CACHE_DATA_DIR` | `/data` | Cache directory (mount a persistent volume here) |
| `PORT` | `4020` | Listen port |

## Usage
When run via Docker (`docker/docker-compose.yml`), a named volume is attached at `/data` so the service keeps the downloaded file between restarts. Once the cache finishes its initial sync, point the backend at it by setting `YGO_API_BASE_URL=http://ygo-cache:4020`.

> **Note:** the first refresh still calls the upstream API, so the container requires outbound network access during bootstrap.

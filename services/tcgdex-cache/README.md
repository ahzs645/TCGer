# TCGdex Cache Service

Provides an on-disk cache of the TCGdex Pokemon TCG API as an alternative to the official Pokemon TCG API. TCGdex offers a more reliable, multilingual Pokemon card database with no API key required.

## Why TCGdex?

- ✅ **More Reliable**: No 504 errors or rate limiting issues
- ✅ **No API Key Required**: Free to use without registration
- ✅ **Multilingual**: Supports 10+ languages
- ✅ **Complete Data**: Card images, stats, and metadata
- ✅ **Active Maintenance**: Regularly updated with new sets

## Endpoints

- `GET /cards?q=<query>&page=<n>&pageSize=<n>` — returns a paginated list of cards
- `GET /cards/<id>` — returns full details for a single card by its TCGdex ID
- `GET /health` — exposes cache metadata (file path, counts, timestamps)
- `POST /admin/refresh` — forces an immediate re-sync

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `TCGDEX_CACHE_REFRESH_MS` | `86400000` | Interval between dataset refreshes (24h) |
| `TCGDEX_CACHE_PAGE_SIZE` | `20` | Default page size when the client omits `pageSize` |
| `TCGDEX_CACHE_DATA_DIR` | `/data` | Directory for the cached JSON |
| `PORT` | `4040` | Listen port |

Mount a persistent volume at `/data` (Docker compose already does this) so the service can restart without redownloading the entire catalog.

Point the backend at the cache by setting `POKEMON_API_BASE_URL=http://tcgdex-cache:4040`.

## Usage

### Start with Docker Compose

```bash
# Add --profile bulk to enable the cache
docker compose --profile bulk up tcgdex-cache
```

### Query Examples

```bash
# Health check
curl http://localhost:4040/health

# Search for cards
curl "http://localhost:4040/cards?q=charizard&page=1&pageSize=10"

# Get specific card by ID
curl http://localhost:4040/cards/swsh3-136

# Force refresh
curl -X POST http://localhost:4040/admin/refresh
```

## Comparison with pokemon-cache

| Feature | pokemon-cache | tcgdex-cache |
| --- | --- | --- |
| Data Source | Official Pokemon TCG API | TCGdex |
| API Key | Required (20k/day) | Not required |
| Reliability | Prone to 504 errors | Very stable |
| Languages | English only | 10+ languages |
| Port | 4030 | 4040 |
| Card Count | ~30k+ | ~30k+ |

You can run both services simultaneously and choose which one to use, or switch between them as needed.

## Data Structure

Cards are cached in their full TCGdex format, including:
- Card images (https://assets.tcgdex.net/...)
- HP, types, attacks, weaknesses
- Set information with logos and symbols
- Rarity, illustrator, description
- Legal formats (Standard, Expanded)
- Pricing data (Cardmarket)

## Notes

- The first sync downloads the full card list from TCGdex (usually very fast)
- Individual card details are fetched on-demand from the TCGdex API
- The cache refreshes automatically every 24 hours
- No authentication or rate limiting from TCGdex

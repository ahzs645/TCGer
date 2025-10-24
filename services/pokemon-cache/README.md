# Pokémon Cache Service

Provides an on-disk cache of the Pokémon TCG API so the backend can execute searches without hitting `api.pokemontcg.io` every time. It mirrors the subset of the official API that `PokemonAdapter` uses.

## Endpoints
- `GET /cards?q=<query>&pageSize=<n>&page=<n>` — returns a paginated list of cards.
- `GET /cards/<id>` — returns a single card by its API ID.
- `GET /health` — exposes cache metadata (file path, counts, timestamps).
- `POST /admin/refresh` — forces an immediate re-sync.

## Configuration
| Variable | Default | Description |
| --- | --- | --- |
| `POKEMON_SOURCE_BASE_URL` | `https://api.pokemontcg.io/v2` | Remote API base to pull from |
| `POKEMON_SOURCE_API_KEY` | _unset_ | API key forwarded to the source service (falls back to `POKEMON_TCG_API_KEY` if provided) |
| `POKEMON_CACHE_REFRESH_MS` | `43200000` | Interval between dataset refreshes (12h) |
| `POKEMON_CACHE_PAGE_SIZE` | `20` | Default page size when the client omits `pageSize` |
| `POKEMON_CACHE_MAX_PAGE_SIZE` | `200` | Hard cap applied to `pageSize` |
| `POKEMON_CACHE_FETCH_PAGE_SIZE` | `250` | Page size used when downloading from the upstream API |
| `POKEMON_CACHE_FETCH_DELAY_MS` | `200` | Delay between upstream page requests (ms) |
| `POKEMON_CACHE_DATA_DIR` | `/data` | Directory for the cached JSON |
| `PORT` | `4030` | Listen port |

Mount a persistent volume at `/data` (Docker compose already does this) so the service can restart without redownloading the entire catalog.

Point the backend at the cache by setting `POKEMON_API_BASE_URL=http://pokemon-cache:4030`.

> ⚠️ The first refresh still downloads the entire dataset from the public API. Ensure the container has outbound network access and respect the upstream rate limits.

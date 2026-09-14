# Hosted pricing on Cloudflare

First implementation of a read-only price API with guest/device abuse controls. It
has not been deployed. The checked-in config is disabled, has no public route,
and contains a placeholder D1 id. It cannot serve real prices until configured
and populated. Native apps are not yet connected to this new endpoint.

A separate [private R2 prototype](prototype/TCGCSV.md) holds the full Pokémon
TCGCSV snapshot and includes tooling to package an existing SQLite database. That
prototype is file storage; the D1 lookup Worker below remains undeployed.

Current mobile pricing uses the separate [direct TCGCSV + static R2 fallback](prototype/MOBILE.md).
That path is implemented without Firebase or attestation. Its public fallback is
not covered by the Worker quotas described below.

## Architecture

An operator imports a normalized price snapshot into D1. The Worker reads that
snapshot after authentication and quota checks. It has no upstream pricing
credentials, refresh endpoint, public ingestion route, or provider fallback.
Importing data is an administrative CLI operation with separate Cloudflare
credentials.

Guests use Apple App Attest (iOS) or Google Play Integrity (Android) directly,
then receive a 15-minute pricing token. No Firebase project or SDK is used.
The server implementation is present; native enrollment and physical-device
validation are still required. Signed-in access is an optional, separately
disabled path using the existing Better Auth/Convex JWTs.

## Abuse controls

| Control | Initial limit |
| --- | --- |
| IP burst, before signature verification | 120 requests/minute/location |
| Verified user burst | 30 requests/minute/location |
| JSON body, including streamed bodies | 32 KiB |
| Cards per request | 50 |
| Cards per user per UTC day | 2,000 |
| Cards across all users per UTC day | 100,000 |
| Admitted requests across all users per UTC day | 10,000 |
| Guest challenge + verification calls per IP per UTC day | 60 |
| Guest challenge + verification calls globally per UTC day | 2,000 |
| Worker CPU per invocation | 50 ms |

Daily counters use SQLite-backed Durable Objects, with transactions to serialize
concurrent admissions across Cloudflare locations. They count submitted cards,
including duplicates and misses, regardless of token renewal or client IP.
Denied admissions don't update counters. A user's quota is charged before the
global quota; a global rejection or D1 failure is not refunded. Inactive quota
objects delete their stored counters after the cleanup alarm. No raw tokens,
card requests, IPs, or user identities are written to application logs.

These are application capacity limits, **not a dollar cap or a complete DDoS
defense**. Calls rejected inside the Worker still incur request/CPU costs.
Requests reaching Durable Objects incur their own costs even when denied. A
global object is deliberately a simple initial capacity gate, not an unlimited
throughput design. Multiple signups can evade per-user quotas, but cannot evade
the shared quota. Device verification is not a unique-person identifier either:
new installation keys, reinstalling, or multiple genuine devices can evade an
individual quota. Android verifies app/device integrity and possession of an
installation key; it does not independently attest that key's hardware origin.
Admission counters do not enforce a maximum incoming request
count. The built-in burst limiter is approximate and per location.

Each successful token exchange normally consumes two guest-capacity units (one
challenge and one verification); failed attempts also consume capacity. Attested
iOS keys and assertion counters remain stored to prevent replay. Short-lived
challenges expire after five minutes. Storage for enrolled devices needs an
operational retention policy before a large rollout; deleting enrollment state
without a replacement replay policy is unsafe. Google receives only integrity
verification requests, never card lookups or provider requests.
An attacker can exhaust the shared enrollment allowance and temporarily prevent
new guest tokens; existing tokens remain usable until expiry. This deliberately
favors bounded verification work over guaranteed availability during abuse.

Before enabling a public route:

- Configure edge WAF/rate-limit rules on the chosen hostname and verify their
  plan availability. Keep `workers_dev` and preview URLs disabled so they don't
  bypass those rules. Limit methods, path, body size and abusive traffic there.
- Choose quota values based on measured usage. Rate-limit account creation in
  the identity service as well.
- Enable account spending notifications and an operational response for spikes.
  Cloudflare budget alerts do not stop billing.
- Keep an edge block rule ready for an incident. Setting `PRICING_ENABLED=false`
  stops database/auth work but the Worker still receives billable invocations.
- Measure CPU and Durable Object costs under representative traffic; verify the
  local tests, then run a bounded staging load test before exposing production.

## API

`POST /v1/prices/lookup`, `Authorization: Bearer <JWT>`,
`Content-Type: application/json`. Guest tokens also require `X-TCGer-Guest: 1`:

```json
{
  "items": [
    { "gameId": "pokemon", "cardId": "sv03-001", "finishCode": "normal", "language": "English" }
  ]
}
```

Optional exact dimensions are `finishCode`, `condition`, `language`, `grader`,
and `grade` (a string). Grader and grade must occur together. Omitted dimensions
mean unspecified, never a wildcard. Unknown fields, refresh flags, query-string
arguments, and compressed request bodies are rejected. Only exact lookups are
supported; there is no catalog dump, search, or unlimited history endpoint.

The response has `schema: "tcger-hosted-price-results-v1"` and a `prices` array.
Each entry repeats the requested identity and includes `quotes`. Missing matches
return `quotes: []`, never zero. Every quote retains source, provider product id,
original `observedAt`, `retrievedAt`, `expiresAt`, currency and amount. Expired
quotes are returned with `stale: true`; clients must display the source date and
must not silently include stale quotes in a current portfolio valuation.

Responses use `private, no-store` so caches cannot bypass authentication or
quotas. Clients can explicitly retain dated quotes in local storage and avoid
repeated lookups until a refresh is useful. A browser Origin must be explicitly
allowlisted; native clients may omit Origin. CORS is not authentication.

Status codes: `400` invalid lookup, `401` invalid JWT, `403` disallowed origin or
missing Cloudflare client address, `413` oversized body, `415` unsupported body,
`429` user/IP quota, `503` disabled/unconfigured service, global daily capacity,
or a dependency failure. Quota errors include `Retry-After`. Clients should keep
cached data and respect that delay; avoid automatic retry loops.

## Development and validation

From the repository root:

```sh
npm run test --workspace @tcg/hosted-pricing
npm run check --workspace @tcg/hosted-pricing
```

Tests run Wrangler's production bundle in Miniflare with real D1 and Durable
Object bindings and cryptographically signed tokens. They exercise auth
rejection, concurrent quota admission, burst limits, payload bounds, exact
variant matching, atomic snapshot promotion, guest token renewal, challenge
consumption, App Attest assertion counters and Android signature/verdict binding.
The iOS assertion fixture seeds an enrolled test key only in a test module;
Google responses are mocked. Genuine Apple enrollment and Google verdicts still
need testing with release-signed builds on physical devices. These tests need no
Cloudflare account or provider key. Wrangler's dry run uploads nothing.

Wrangler aliases the attestation library's CBOR import to a small `cborg`
adapter. It rejects duplicate keys, trailing objects and indefinite lengths and
converts binary fields to Buffers expected by the certificate verifier. Keep the
alias and the pinned `node-app-attest` dependency together when upgrading.

## Provisioning and authentication

Create a dedicated D1 database, put its id in `wrangler.jsonc`, and apply
`migrations/0001_prices.sql` through Wrangler's D1 migrations command.

### Direct guest verification (no Firebase)

Configure these server values before setting `GUEST_ENABLED=true`:

- `GUEST_TOKEN_SECRET`: a dedicated random secret with at least 32 random bytes
  encoded as base64url. Store through `wrangler secret put GUEST_TOKEN_SECRET`;
  never include it in either app or commit it. Rotating it expires existing tokens.
- `APPLE_TEAM_ID` and `APPLE_BUNDLE_ID`: the production Apple App ID components.
  Enable App Attest for the app and use the production entitlement. Development
  attestations and unsupported devices have no bypass.
- `ANDROID_PACKAGE_NAME` and `ANDROID_CERTIFICATE_DIGESTS`: exact package and
  comma-separated base64url SHA-256 digests of allowed Play app-signing
  certificates (not the upload certificate).
- `PLAY_SERVICE_ACCOUNT`: JSON credentials for a service account authorized to
  decode this app's integrity tokens, stored with `wrangler secret put`.
  Enable Play Integrity in a Google Cloud project linked through Play Console.
  **This uses Google Cloud, not Firebase.** The native app needs that project's
  numeric project number when preparing Standard Integrity requests.
- `GUEST_DAILY_EXCHANGES`: shared daily verification capacity, including failures.

All enrollment calls are JSON POSTs with no Authorization header:

1. Create and persist an installation key. On iOS use `DCAppAttestService` and
   retain its key ID. On Android use an Android Keystore P-256 signing key and
   derive `keyId` as its RFC 7638 SHA-256 JWK thumbprint (base64url).
2. Send `{ "platform": "ios", "keyId": "..." }` (or `android`) to
   `/v1/guest/challenge`. The response contains `challenge`, `expiresIn: 300`,
   and `enrolled`. Treat the challenge as its exact UTF-8 string, not decoded
   base64 bytes. Only the latest challenge for a key is valid.
3. On iOS, compute SHA-256 of that UTF-8 challenge. For a new key call
   `attestKey` with that clientDataHash and send `{ platform, keyId, challenge,
   attestation }` to `/v1/guest/verify`, with the attestation encoded in standard
   base64. For an enrolled key use `generateAssertion` with the same hashing
   convention and send `assertion` instead. Counters must strictly increase.
4. On Android, sign the UTF-8 challenge using SHA256withECDSA. Convert the DER
   signature to 64-byte IEEE P1363 `r || s`, then base64url without padding.
   Request a Standard Integrity token with `requestHash` equal to base64url
   SHA-256 of the same challenge. Send `{ platform, keyId, challenge, publicKey,
   signature, integrityToken }`; `publicKey` is the public EC/P-256 JWK. The
   server requires a fresh verdict for the exact app, certificate and request
   hash, plus `PLAY_RECOGNIZED`, `LICENSED` and `MEETS_DEVICE_INTEGRITY`.
5. Cache the returned `{ token, expiresIn: 900 }` and use it for price lookups.
   Renew on demand using the same key, preserving its quota identity. Respect
   `Retry-After`; serialize exchanges for a key and retain cached dated prices
   when verification is unavailable. Failed verification consumes the challenge.

Sideloaded Android builds, simulators, devices without supported attestation,
and Google outages cannot obtain new guest tokens under this policy. Existing
valid tokens continue until expiry. Native apps must handle this gracefully.
Attestation raises the cost of abuse but cannot prevent token sharing or a
determined attacker using genuine devices; shared limits remain mandatory.

### Optional signed-in access

Keep `ACCOUNT_ACCESS_ENABLED=false` for the guest-only pilot. If enabling it,
native clients must obtain the short-lived JWT issued by Better Auth's Convex
plugin; opaque session tokens and local-device tokens are not accepted. Configure:

- `AUTH_ISSUER`: exact trusted production Convex site URL, including any trailing
  slash only if the actual token issuer contains it.
- `AUTH_AUDIENCE`: `convex`, matching the existing auth plugin.
- `AUTH_JWKS`: **public** signing keys retrieved by the operator from that
  deployment's `/api/auth/convex/jwks` endpoint. Never configure private keys.
- `ALLOWED_ORIGINS`: comma-separated exact browser origins, if web access is
  needed. Empty allows native requests without Origin only.

JWKS is pinned in configuration so attackers cannot provoke outbound key fetches
with random `kid` headers. Update it when auth keys rotate; keep both old and new
public keys during the token overlap. Missing keys deny access. Only RS256,
ES256 and EdDSA JWTs are accepted, with subject, issuer, audience, issued-at and
expiry checked and a maximum token age/lifetime of 20 minutes. A revoked session
can retain access until its already-issued JWT expires; immediate revocation is
not implemented here.

Add the selected custom-domain route only after edge protection and identity
verification are in place. Enable `PRICING_ENABLED` after a validated import and
staging test. Do not deploy a debug auth bypass.

## Data ingestion

Input is a complete normalized snapshot with `schema: "tcger-hosted-prices-v1"`
and `quotes`. Each quote contains the lookup dimensions, a positive `amount`,
three-letter uppercase `currency`, `source`, `providerProductId`, and ISO
timestamps `observedAt`, `retrievedAt`, `expiresAt`. There may be up to eight
source/currency quotes for one exact lookup.

```sh
# Validate only. No remote writes or credentials are needed.
npm run import --workspace @tcg/hosted-pricing -- /absolute/path/prices.json

# Load a local D1 after applying the local migration.
npm run import --workspace @tcg/hosted-pricing -- /absolute/path/prices.json --local

# Administrative publication to the configured D1.
npm run import --workspace @tcg/hosted-pricing -- /absolute/path/prices.json --remote
```

Imports are content-addressed and idempotent. They stage a batch before switching
the active pointer. A partial upload cannot become active. Run a single importer
at a time; future CI must use a concurrency group. The script intentionally does
not infer fuzzy card matches, invent timestamps, or fetch a paid provider.

Provider normalization, identity crosswalks, coverage thresholds, daily scheduling,
old-batch retention, R2 archives, and mobile endpoint/token integration remain
rollout work. Before daily imports, add retention so old batches don't grow D1
without bound. Keep the previous successful batch for rollback and reject a
coverage collapse upstream: structural validation alone cannot prove that a
one-card snapshot is a complete catalog. Verify the selected source's right to
serve our first-party clients before importing production data.

## References

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Rate limiter accuracy](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Durable Object storage transactions](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Budget alerts](https://developers.cloudflare.com/billing/manage/budget-alerts/)
- [Apple App Attest server validation](https://developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server)
- [Google Standard Integrity requests](https://developer.android.com/google/play/integrity/standard)
- [Google integrity verdicts](https://developer.android.com/google/play/integrity/verdicts)

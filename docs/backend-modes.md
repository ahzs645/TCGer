# Supported modes, inventory operations, and upgrades

Full Convex mode is the primary supported account server. Express remains the
authenticated HTTP boundary and serves catalogs, scanner/provider integrations,
and compatibility routes. Set `BACKEND_MODE=convex` explicitly; a directly
launched legacy backend otherwise defaults to hybrid. The Docker example selects
Convex and does not need Postgres.

## Where data lives

| Experience | Data and synchronization |
| --- | --- |
| Public landing page | Product information, documentation, and distribution links. |
| Public browser demo | Sample/browser-local state. It is not an account server. |
| Authenticated web app | Data on the configured server, scoped to its authenticated account. |
| iOS phone-only mode | Device files, local backups, and local inventory operations. It does not automatically synchronize with the browser demo. |
| iOS connected mode | Data from the selected server/account. Changing either invalidates pending work and private caches. |

The Pages workflow publishes the landing page and static demo. Hosting the
authenticated application requires the application deployment described in
[Docker setup](../docker/README.md). Use the Android APK distribution and iOS
source/build instructions linked from the product page; the existence of mobile
source does not establish an App Store release.

## Operation-level support

Clients read `GET /health`. A broad feature flag, such as `finance` or `trades`,
allows the corresponding workspace; it does not prove transactional settlement.
The newer operation flags are optional for older servers. Missing flags mean
unsupported for the stronger operation.

| Operation | Full Convex | Legacy hybrid |
| --- | --- | --- |
| Authentication | Better Auth through the Express proxy | Same identity provider; provisions a Prisma subject before legacy writes |
| Collections and wishlists | Convex | Selected by `COLLECTIONS_BACKEND` and `WISHLISTS_BACKEND` |
| Single-copy edit/delete and printing-group delete | Explicit distinct operations | Explicit distinct operations; Prisma normalizes legacy quantity rows before copy edits |
| Atomic sale plus selected-copy removal | `atomicSales: true` | `false`; request fails with 501 before any write |
| Replayable reviewed intake plus optional sealed opening | `atomicIntake: true` | `false`; request fails with 501 before any write |
| Binder-page revision checks | `binderPageRevisionGuards: true` | `true`; selected store checks the revision atomically |
| Linked acquisition purchase/edit/removal | `linkedAcquisitions: true` | `false`; no cross-store purchase/copy write is attempted |
| Trade settlement across inventories and finance | `tradeSettlement: true` | `false`; acceptance is disabled and the route returns 501 |
| Standalone finance records | Supported | Supported within the legacy finance store |
| Email delivery | `emailDelivery: false` | `emailDelivery: false` |

Hybrid is a compatibility and migration path. Selecting Convex collections while
leaving legacy finance does not make a cross-store transaction atomic. Do not
enable stronger flags based only on collection routing. Email channel creation
and sending fail explicitly until real delivery exists; a log message is not a
delivery receipt.

## Physical-copy contract

A physical copy has its own stable identity and metadata. Grouped collection
cards are a presentation of those copies. These operations deliberately differ:

| Request | Effect |
| --- | --- |
| `PATCH /collections/:binderId/cards/:copyId` | Edits the addressed copy. A printing correction preserves its siblings' identity, printing, condition, cost, notes, tags, and photos. |
| `DELETE /collections/:binderId/copies/:copyId` | Deletes exactly one addressed copy. |
| `DELETE /collections/:binderId/cards/:copyId` | Preserves the established behavior: removes the whole printing group in that binder. |
| `POST /collections/normalize-copies` | Previews or materializes bounded legacy quantity rows for the current account. |

Copy IDs in paths must be percent-encoded, including legacy ordinal addresses
such as `entry#2`. A legacy read can expose those ordinal addresses without
changing data. A mutation resolves them to durable copy identities. Normalization
preserves the original identity for the first copy and preserves metadata and
linked records. Shared photo files are retained while another copy references
them. Sealed proceeds are split in cents, so normalization cannot multiply money.

Export a portable backup before bulk normalization. Send
`{"dryRun":true,"limit":10}` to inspect a batch, then
`{"dryRun":false,"limit":10}` to commit it. `limit` is an integer from 1 to 100;
each request also has a 500-physical-copy budget. The response includes `dryRun`,
`normalizedRows`, `createdCopies`, `entryIds`, and a boolean `remaining`. Repeat
commits while `remaining` is true. Preview IDs are addresses rather than a
commit receipt. Oversized or ambiguous legacy state returns an actionable
conflict instead of discarding commitments or looping without progress. Review
such data from its backup before an administrative migration.

Deck allocation, pending trade reservations, sales, deletion, and storage use a
shared availability policy on the primary backend. A conflicting commitment
must be resolved explicitly; another subsystem cannot silently remove its copy.

## Atomic inventory and finance operations

`POST /finance/sales` accepts an `operationId`, `collectionId`, exact `copyIds`,
`amount`, `currency`, and `removeFromInventory`, plus optional costs and notes.
It commits the ledger and the requested inventory change together. The receipt
contains the transaction ID, selected copy IDs, and removed copy IDs.

`POST /collections/:binderId/intake` accepts an `operationId`, a `source` of
`scanner` or `physical-opening`, and reviewed rows with stable `rowId` values.
An optional `sealedInventoryId` and opened quantity link the actual physical
opening. Its receipt returns exact entry IDs per row and an optional opening ID.
No before/after binder difference is used to guess which copies were created.

Clients save the frozen operation payload before sending it. If a connection
fails after the server commits, retry the same operation ID and payload; the
server returns the original receipt. Reusing an ID with a different payload is
a 409 conflict. Recovery belongs to the originating account/server session and
does not publish into a replacement session. Clearing browser/device storage
also clears local pending recovery records, so preserve backups before doing so.

Native binder-page recovery also retains the reviewed photo bytes and positions.
It checkpoints the intake receipt before saving page metadata or uploading images.
`binderPageRevisionGuards` is required for connected recovery: page PUT can require
the original revision (or revision zero for a new page), and image replacement
checks and advances the revision. A newer page or a lost image response requires
explicit review of the saved scan and current page. The confirmed physical copies
remain in inventory whichever page version is kept.

Simulated packs save to simulation history. They do not create owned copies or
decrement sealed inventory. Use the reviewed scanner/intake workflow to record
cards that were physically acquired or opened. The older standalone sealed
opening endpoint retains its narrower contract; use atomic intake for the
combined creation/opening workflow.

## Currency and acquisition reversals

An acquisition stores its original amount and currency together. Import/export,
portable backup, allocation, copy snapshots, and linked purchase changes carry
that pair. Unknown currency on old data remains unknown; no migration invents a
USD label. Per-currency summaries retain separate totals. Legacy scalar USD
summary fields include USD amounts only, with no silent currency conversion.
Convex spending summaries reject more than 5,000 purchase records with an
explicit limit error; they do not present a truncated subset as a complete total.

Allocation records use stable operation IDs. Undo of an acquisition allocation
reconciles the created purchase records and spending summary in the same
transaction as the copy snapshots. A linked purchase edit or removal updates
its copy atomically. General collection undo is not permission to undo a sale
or settle a financial operation through an unrelated snapshot.

Optional market-price conversion requires a configured rate, source, and dated
`PRICE_FX_AS_OF` timestamp. Original acquisition costs remain independent of
transient market quotes. Delayed quote requests are bound to their exact
printing and current session before they can publish.

## Fresh installs and existing legacy databases

Use the [README quick start](../README.md#quick-start-recommended-frontend-on-host-services-in-docker)
for development and the explicit first-boot sequence in
[Docker setup](../docker/README.md#first-boot) for production. Clone submodules,
use the pinned npm installer, set distinct authentication and bridge secrets,
deploy Convex functions, and then create the first administrator through setup.
The administrator-exists check and promotion occur inside one mutation.

Local development uses `npm run dev:local` in `convex-backend`. The bootstrap
applies authentication, bridge, origin and declared provider settings to the
Convex deployment environment, then reports readiness after a strict function
push and an authenticated bridge check. The same bootstrap runs in development
Compose. It preserves anonymous or explicitly selected linked local state and
rejects cloud/production/deploy-key selections. Plain `convex dev` does not copy
the CLI process's secrets into function environment variables. Restart the
bootstrap after changing its declared settings.

Native clients supply their configured API origin on authentication mutations.
If that origin differs from the website origin, both must be declared in
`BETTER_AUTH_TRUSTED_ORIGINS`. An untrusted origin remains a 403; the client does
not retry by disabling or changing the server's origin checks.

Legacy hybrid additionally requires Postgres and versioned Prisma migrations.
The restored `20260723180000_restore_legacy_domain_foundations` migration fills
historically omitted domain tables before subsequent ALTER migrations need
them. It skips tables that already exist, preserves legacy credential columns,
relaxes the obsolete required password hash, and removes stale group-unique
indexes that blocked physical copies. No previously published migration file
was rewritten. The nullable acquisition-currency migration preserves unknown
currency instead of assigning a default.

Databases previously maintained with `prisma db push` need an inspected baseline
of their existing schema and migration history. Back up and test the migration
on a copy before applying it to user data. Do not blindly mark unapplied
migrations as applied, and do not use `--accept-data-loss` at startup. Both
development and production hybrid startup now run `prisma migrate deploy`.

Legacy identity is keyed by the authenticated subject, never inferred from an
email match. Fresh authenticated users are provisioned before the first foreign
key-dependent write. A duplicate email or username belonging to a different
legacy ID returns a migration conflict; it does not silently adopt another
account's collection. Existing identities require an explicit, backed-up mapping
of the trusted subject and all owned records. A database outage returns a
service error rather than pretending the session is invalid.

## Deployment persistence and provider configuration

Preserve `convex_data`, the legacy Postgres volume when used, and `uploads_data`.
Uploads live at `/app/uploads` and are served through the gateway's `/uploads/`
route. The gateway accepts 64 MB requests; application backup validation still
enforces its 48 MB limit. Volume persistence does not replace portable backups.

The default public provider URLs work without optional bulk workers. Enabling a
bulk profile requires explicitly selecting the matching internal provider URLs.
Both Compose files forward the configured Scrydex, pricing, PSA, retry/rate,
scanner-limit, and FX provenance settings. Provider availability and licenses
remain deployment-specific; the website must not promise free access to every
upstream service.

## Verification boundaries

The real PostgreSQL acceptance script is
`backend/src/integration/legacy-provider.acceptance.ts`. It refuses to run unless
`TCGER_ACCEPTANCE_DATABASE=disposable` and the user table is empty. It runs real
Express middleware, routes and Prisma persistence; only the identity-provider
HTTP response is controlled; optional remote pricing is deliberately unavailable.
It is not a live signup/cookie test. The dedicated
Linux workflow starts a fresh PostgreSQL service and applies migrations first.

`convex-provider.acceptance.ts` exercises real local Better Auth signup and the
shipping Express gateway against a disposable anonymous Convex deployment.
`provider-matrix.acceptance.ts` separately runs each of the four hybrid
collection/wishlist selections against that live identity provider and its own
empty, migrated PostgreSQL database. It verifies first writes in the selected
store, foreign-account rejection, and the stronger operations' 501 gates.

Shared API contracts cover web, iOS, Android, Express, and Convex separately from
UI parity. See [the contract boundaries](../mobile-parity/api-contracts/README.md)
and [the remediation evidence](audit-remediation-2026-10-31.md). Native camera,
biometrics, signed app links, physical-device recovery, and installed-PWA
offline/update behavior require their actual release artifacts and devices.
Run iOS checks locally with `npm run verify:ios:local`; no GitHub iOS runner is
substituted for the repository's local execution policy.

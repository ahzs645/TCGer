# Shared API contract coverage

[`interactions.json`](interactions.json) defines 42 REST interactions for eight
product features: `collections.browse`, `collections.create`,
`collections.manage`, `collections.copies`, `cards.search`,
`data.portableBackup`, `scanner.results.addToBinder`, and
`packOpening.save.sealedLedger`.
The real three-platform clients exercise lists, metadata, partial updates,
deletion (including empty HTTP 204 responses), query serialization, imports,
physical-copy edits and moves, scan-result persistence requests and sealed openings.
Failure coverage includes invalid input, missing authentication, foreign binder,
copy and sealed-inventory ownership, unsupported backup versions and opening
more sealed units than owned. Scanner image recognition/upload and pricing
still need their own contracts.

## Execution boundaries

| Target | Executed code | Isolation |
| --- | --- | --- |
| Web | Production collection, card, backup and sealed clients | Mock fetch asserts method, path, decoded query, authorization and exact JSON before returning the shared response. |
| iOS | Production `APIService` serializers, remote operations and decoders | URLProtocol asserts the request and returns the same fixture. Generated fixture is bundled in the test target only. |
| Android | Production `RemoteServiceFactory`, Retrofit interface and DTO codec | Injected OkHttp transport asserts the actual serialized request and returns the fixture. Test resources read the original JSON directly. |
| Express | Real collection/card/backup/sealed routers, authentication middleware, input schemas and error handler | Collection/sealed services and auth session lookup are stubbed; the backup gateway transport is injected. Prisma persistence, upstream catalogs and live identity are not verified here. |
| Convex | Real HTTP actions, mutations, response mapping and user isolation | `convex-test` provides in-memory storage and a test bridge identity. No deployed gateway or live identity service is used. |

Card search is served by Express in both backend modes, so those interactions
require Express provider evidence. Collection, import, scan-save and sealed-opening interactions require both
providers. Convex tests check persisted creation/update/delete, ownership isolation,
physical-copy metadata and clearing, sibling preservation, moves without duplication,
sealed decrements and linked-copy ledgers, and repeated imports without duplicating
the imported binder. The import fixture covers a minimal
empty binder; local physical-copy merge coverage uses a separate shared fixture.

Copy PATCH addresses one physical copy by default. Moving that copy preserves its
ID and metadata and leaves its sibling in the original binder. Explicit nulls clear
acquisition and owned-copy details; omitted fields preserve existing values. The
existing DELETE card route removes the whole printing group, including its copies.
The contracts deliberately retain that established grouped-delete behavior; they do
not claim a separate single-copy delete endpoint.

Scan-save coverage exercises the existing collection-add clients with a reviewed
card snapshot. It verifies the persistence HTTP boundary, including validation and
authentication failure, rather than image recognition, review UI, draft checkpoints
or retry idempotency. An interrupted save can still need product-level retry coverage.
Sealed-opening coverage includes ownership of linked card copies and inventory,
quantity validation and excess quantity rejection without decrementing stock.
It does not claim offline sealed ledger support or an idempotency key for repeated
opening submissions.

Responses allow additive fields while retaining required fields, types, values,
array lengths and envelopes. Explicit matchers allow generated binder IDs,
timestamps and differing error messages/codes. The synthetic library's display
name is a nonempty string: existing providers use `Unsorted` and `Library`.
This records compatibility without claiming display-name parity. Android's
search DTO does not consume the response price; these contracts assert card
identity and printing metadata, not cross-platform price presentation.

## Commands

```sh
npm run parity:generate        # includes refreshing the iOS test fixture
npm run parity:check           # validates bindings, fixture drift and tooling
npm run api-contracts:test     # executes web + Express + Convex suites
npm run api-contracts:android  # JVM client tests; no emulator required
npm run api-contracts:ios      # XCTest on an iOS simulator
npm run api-contracts:report -- --require-pass
```

JavaScript execution uses the existing workspace dependencies. Android requires
JDK/SDK setup. iOS requires Xcode and a simulator; `IOS_SIMULATOR` defaults to
`iPhone 17 Pro`, or set `API_CONTRACT_IOS_DESTINATION` to an xcodebuild destination
such as `platform=iOS Simulator,id=<available-device-id>`.
`API_CONTRACT_IOS_DERIVED_DATA` selects an existing build directory.
`API_CONTRACT_IOS_EXTRA_TESTS` adds comma-separated XCTest class names to the
same run, so regression tests finish before Maestro starts on that simulator.
`API_CONTRACT_RESULTS_DIR` overrides the default `mobile-parity/results/api`.

The report shows each interaction's product feature, three consumers, and
required providers. Missing, skipped, failed or stale results prevent a
compatible result. Evidence includes the checkout revision and a fingerprint
of the fixture and registered source/test files. The fingerprint does not cover
every transitive dependency; CI executes the suites against one checkout.
API results never feed the UI matrix's `Verified` calculation.

## Maintaining coverage

1. Add a shared interaction with a stable ID, an existing product `featureId`,
   a reviewed request/response, applicable providers, and the iOS XCTest method.
   Define provider state from isolated test data, not production accounts.
2. Add real consumer invocation/assertions for a new operation in each client
   test. Unknown operations fail; the existing loops exercise every interaction.
   Add the named iOS test and check actual decoding of fields the client consumes.
3. Add provider execution and assertions for the same interaction, including
   persistence or domain coverage where the adapter boundary is insufficient.
   Keep request bodies exact; allow only deliberate response variations.
4. Update source/test bindings and the feature's source paths so impact reports
   expose related changes. Generate fixtures, run affected suites, and inspect
   the compatibility matrix with `--require-pass`.

`AGENTS.md` requires this workflow for covered server-backed changes. The
GitHub CI runs web, Android and the two provider suites on Linux. Its explicit
`--require-targets web,android,express,convex` gate rejects missing, failed,
skipped or stale evidence for those targets; the matrix still shows iOS Not run
and full compatibility incomplete. iOS XCTest runs locally only through
`npm run verify:ios:local` (regression/API tests followed by Maestro) or
`npm run api-contracts:ios`. The default `--require-pass` still requires every
consumer and applicable provider. CI subset success never proves iOS compatibility.

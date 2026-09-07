# Game extensibility implementation

Scope: future game packages can reuse ordinary collections, decks, printings,
legality, symbols, price snapshots, compatible scanner assets, and pack opening.
Specialized collection views, including the Pokédex roster and generations, are
explicitly unchanged.

## Completed

- [x] Open validated game identifiers in shared APIs, Convex records, CSV import,
      and native clients. Register an unconfigured game's storage namespace when
      its first collection card is saved or imported. Keep built-in provider
      discovery separate from the set of valid stored game IDs.
- [x] Add versioned deck formats, arbitrary zones, sizes, eligibility predicates,
      copy limits across printings, exceptions, and explicit unknown/unsupported
      validation. Snapshot rules into decks, preserve them in portable data and
      hosted backup restoration, and connect web/iOS/Android deck creation and
      editing. Native deck availability follows the existing server requirement.
- [x] Add generic printing groups and named finishes with explicit foil values;
      consume them in printing selection and copy editors. Match configurable
      rarity, resource, and type symbols. Preserve presentation metadata with
      saved collection cards.
- [x] Accept arbitrary format legality and dated effective periods. Unknown
      legality cannot produce a successfully validated deck.
- [x] Add sourced, exact-variant price snapshots with currency and expiry checks;
      connect card/copy views and web tracked collection pricing. These are
      installed snapshots; a live remote provider remains a separate integration.
- [x] Download and verify package scanner/model references, discover new scanner
      games, and route them through existing compatible runtimes. Download,
      validate, and open declarative weighted pack libraries on all clients;
      expose existing collection/wishlist actions for pulls. Pack collation works
      offline; artwork follows normal image caching.
- [x] Add v2 manifest/schema generation, publishing documentation, a deterministic
      fictional game, shared/native conformance tests, real-browser installation
      tests, and server storage/import/deck regression coverage.

## Verification

- Web suite: 177 tests passed.
- Real Chromium: package install, capability activation, IndexedDB persistence,
  printing groups, exact tracked price lookup, corrupt-download rollback, and
  removal passed.
- Backend: 23 deck, collection identity, future-game storage, and import tests
  passed.
- Convex: 18 HTTP deck, backup, bulk-add, and CSV import tests passed.
- Android: 6 package/fixture tests passed; app Kotlin compilation passed.
- iOS: simulator app and test targets built with `build-for-testing`. Tests were
  compiled; no simulator was booted and iOS runtime tests were not executed.
- Shared API package built. Frontend, backend, and Convex typechecks passed.
- Generated structural schemas accept the fixture and reject a deck feature
  without its required rules. Runtime validation additionally checks hashes,
  references, unique identities, and temporal ordering.
- `git diff --check` passed.

The fictional fixture does not supply a trained scanner model, so this work does
not establish recognition accuracy for a new game. Compatible model training and
publisher release assets are still required. The built-in adapters remain for
existing games; publishers can now supply the generic contracts without adding
another game-specific application branch.

## Delivery

- Publishing guide: `docs/scanner-system/game-package-manifest.md`.
- Example: `docs/scanner-system/examples/star-garden/README.md`.
- Prisma migration:
  `backend/prisma/migrations/20260905000100_game_deck_rules/migration.sql`.

The Prisma client was regenerated locally. The database migration has not been
applied and the Convex changes have not been deployed. Existing unrelated checkout
edits were preserved; nothing was committed or published by this task.

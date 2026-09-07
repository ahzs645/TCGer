# Star Garden capability fixture

Start with the [future-game authoring guide](../../../src/content/docs/adding-games/index.md) for onboarding and separate pages explaining each capability. Run `npm --prefix docs run dev` from the repository root to browse them in the documentation site's **Adding Games** section.

This fictional three-card game exercises v2 extensibility without a built-in game
identifier or provider. Prices are test data, valid only during September 2026.
It includes two printings of Moonseed Scout, a captain-only deck zone, an ordinary
lineup zone, a copy limit across printings, dated legality, two finishes with
explicit foil values, and a three-card pack with weighted draws.

Regenerate exact bytes and hashes from the repository root:

```sh
npx tsx tools/game-packages/build-future-game-fixture.ts
```

Serve this directory on HTTPS (with CORS for web) and install `game-package.json`
through the Game Store's URL option. Web development also accepts loopback HTTP.
Enable **Price snapshots** and **Pack opening** in the installed library. Open a
First Garden pack, then inspect/save a pull through the normal collection editor.
Create a Star Garden deck and add one captain plus the two scout printings; the
saved rules validate the two scout printings as two copies of the same card.

The fixture deliberately supplies no scanner binary. A real scanner package must
supply a model trained for its catalog and the platform's existing runtime
contract. Tests cover installation/routing and rejection of mismatched data;
this fixture makes no recognition accuracy claim.

Checks from the repository root:

```sh
node --test tools/game-packages/future-game-browser.test.mjs
npm --prefix frontend test
npm --prefix convex-backend run test:once -- convex/decks.test.ts
mobile-apps/android/gradlew -p mobile-apps/android :app:testDebugUnitTest --tests '*FutureGameTest'
```

`FutureGameTests.swift` reads these same fixture files for iOS conformance tests.

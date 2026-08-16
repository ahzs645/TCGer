import assert from "node:assert/strict";
import test from "node:test";

import {
  useDemoStore,
  setDemoPersistence,
  whenDemoStoreHydrated,
  type DemoBinder,
} from "./demo-store";
import {
  DEMO_DECKS,
  DEMO_SEALED_PRODUCTS,
  DEMO_TRADES,
} from "@/lib/data/demo-portfolio";
import type {
  DemoPersistence,
  PersistedDemoState,
} from "@/lib/storage/demo-persistence";
import { toPortableRows } from "@/lib/storage/legacy-collection-rows";

/* ------------------------------------------------------------------ */
/*  Test doubles                                                        */
/* ------------------------------------------------------------------ */

type Commit = Partial<PersistedDemoState>;

interface FakePersistence extends DemoPersistence {
  /** Every `commit()` the store made, in order, exactly as it made it. */
  readonly commits: Commit[];
  clears: number;
  /** Resolve a deferred `whenHydrated()`, standing in for an IndexedDB read. */
  release: () => void;
}

/**
 * A `DemoPersistence` with no browser behind it — no IndexedDB, no
 * localStorage — so these tests can assert on exactly what the store writes
 * and when.
 *
 * `deferHydration` is the interesting mode: it holds `whenHydrated()` open the
 * way a real asynchronous read does, which is the only way to reproduce the
 * window in which the store looks empty but is not.
 */
function createFakePersistence(
  stored: Partial<PersistedDemoState> | null,
  options: { deferHydration?: boolean } = {},
): FakePersistence {
  let state: Partial<PersistedDemoState> | null = stored ? { ...stored } : null;
  let release = () => {};
  const gate = options.deferHydration
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();

  const fake: FakePersistence = {
    commits: [],
    clears: 0,
    release: () => release(),
    whenHydrated: () => gate,
    snapshot: () => state,
    commit: (changes) => {
      fake.commits.push({ ...changes });
      state = { ...(state ?? {}), ...changes };
    },
    clear: async () => {
      fake.clears += 1;
      state = null;
    },
  };
  return fake;
}

/** Lets a deferred promise chain (hydration, reset) run to completion. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function committedSlices(commit: Commit): string[] {
  return Object.keys(commit).sort();
}

function allCommittedSlices(fake: FakePersistence): string[] {
  const seen = new Set<string>();
  for (const commit of fake.commits) {
    for (const slice of Object.keys(commit)) seen.add(slice);
  }
  return [...seen].sort();
}

/**
 * A stored collection, in the shape schema 2 persists: rows, not the nested
 * arrays. The store derives `binders` back from these on hydration.
 */
function storedCollection(binders: DemoBinder[]) {
  return toPortableRows(binders);
}

function makeStoredBinder(name: string): DemoBinder {
  return {
    id: `stored-${name}`,
    name,
    color: "#000000",
    cards: [],
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
  };
}

/* ------------------------------------------------------------------ */
/*  Hydration                                                           */
/* ------------------------------------------------------------------ */

test("applies a stored snapshot to the store on hydration", async () => {
  const binders = [makeStoredBinder("Returning Visitor")];
  const fake = createFakePersistence({
    initialized: true,
    collectionRows: storedCollection(binders),
  });

  setDemoPersistence(fake);
  await whenDemoStoreHydrated();

  const state = useDemoStore.getState();
  assert.equal(state.initialized, true);
  assert.deepEqual(state.binders, binders);
  // Nothing was read that then needed writing back.
  assert.deepEqual(fake.commits, []);
});

test("treats a stored collection with no initialized flag as a return visit", async () => {
  const binders = [makeStoredBinder("Legacy Payload")];
  // The released localStorage payload has no version and no guarantees; a
  // collection without the flag still means somebody has been here.
  const fake = createFakePersistence({
    collectionRows: storedCollection(binders),
  });

  setDemoPersistence(fake);
  await whenDemoStoreHydrated();

  assert.equal(useDemoStore.getState().initialized, true);
  assert.deepEqual(useDemoStore.getState().binders, binders);
});

test("keeps a write that landed while the read was still in flight", async () => {
  const stored = [makeStoredBinder("From Storage")];
  const fake = createFakePersistence(
    { initialized: true, collectionRows: storedCollection(stored) },
    { deferHydration: true },
  );

  setDemoPersistence(fake);
  // A visitor acting inside the read window: their write is newer than the
  // snapshot, so hydration must not roll it back.
  await useDemoStore.getState().addBinder("Typed During Hydration");
  fake.release();
  await whenDemoStoreHydrated();

  const { binders } = useDemoStore.getState();
  assert.equal(binders.length, 1);
  assert.equal(binders[0].name, "Typed During Hydration");
  // ...and it is re-committed once the backend is done reading.
  assert.ok(
    fake.commits.some(
      (commit) =>
        commit.collectionRows?.binders?.[0]?.name === "Typed During Hydration",
    ),
  );
});

/* ------------------------------------------------------------------ */
/*  The seed race (plan §5 R2)                                          */
/* ------------------------------------------------------------------ */

test("init() does not re-seed over a snapshot that has not arrived yet", async () => {
  const stored = [makeStoredBinder("Do Not Overwrite Me")];
  const fake = createFakePersistence(
    { initialized: true, collectionRows: storedCollection(stored) },
    { deferHydration: true },
  );

  setDemoPersistence(fake);

  // `initialized` is false and `binders` is empty right now — the store looks
  // exactly like a first visit, and is not one.
  assert.equal(useDemoStore.getState().initialized, false);
  useDemoStore.getState().init();

  // The decision was deferred rather than taken on provisional state.
  assert.equal(useDemoStore.getState().initialized, false);
  assert.equal(useDemoStore.getState().binders.length, 0);

  fake.release();
  await whenDemoStoreHydrated();
  await flush();

  assert.deepEqual(useDemoStore.getState().binders, stored);
});

test("init() seeds a genuinely empty store once hydration has resolved", async () => {
  const fake = createFakePersistence(null, { deferHydration: true });

  setDemoPersistence(fake);
  useDemoStore.getState().init();
  assert.equal(useDemoStore.getState().initialized, false);

  fake.release();
  await whenDemoStoreHydrated();
  await flush();

  const state = useDemoStore.getState();
  assert.equal(state.initialized, true);
  assert.ok(state.binders.length > 0);
  assert.ok(state.wishlists.length > 0);
});

test("init() is a no-op on a store that is already initialized", async () => {
  const binders = [makeStoredBinder("Untouched")];
  const fake = createFakePersistence({
    initialized: true,
    collectionRows: storedCollection(binders),
  });

  setDemoPersistence(fake);
  await whenDemoStoreHydrated();
  useDemoStore.getState().init();
  await flush();

  assert.deepEqual(useDemoStore.getState().binders, binders);
});

/* ------------------------------------------------------------------ */
/*  Reset                                                               */
/* ------------------------------------------------------------------ */

test("resetDemo() drops stored state and restores the seed fixtures", async () => {
  const fake = createFakePersistence({
    initialized: true,
    collectionRows: storedCollection([makeStoredBinder("Old Collection")]),
    profile: { username: "Someone Else", email: "someone@example.com" },
  });

  setDemoPersistence(fake);
  await whenDemoStoreHydrated();
  assert.equal(useDemoStore.getState().profile.username, "Someone Else");

  useDemoStore.getState().resetDemo();
  await flush();

  const state = useDemoStore.getState();
  assert.equal(state.initialized, true);
  assert.equal(state.profile.username, "Demo User");
  assert.ok(state.binders.length > 0);
  assert.ok(state.binders.every((binder) => binder.name !== "Old Collection"));
  assert.ok(state.wishlists.length > 0);
  // Deep, not reference: the portfolio is a read model derived from the seeded
  // rows now, so it is a fresh array that must still describe the same decks.
  assert.deepEqual(state.decks, DEMO_DECKS);

  // Cleared first, then re-persisted from a clean baseline.
  assert.equal(fake.clears, 1);
  const written = allCommittedSlices(fake);
  assert.ok(written.includes("collectionRows"));
  assert.ok(written.includes("initialized"));
  assert.ok(!written.includes("deckRows"));
});

test("resetDemo() waits for a snapshot that is still in flight", async () => {
  const fake = createFakePersistence(
    {
      initialized: true,
      collectionRows: storedCollection([makeStoredBinder("Stale")]),
    },
    { deferHydration: true },
  );

  setDemoPersistence(fake);
  useDemoStore.getState().resetDemo();
  fake.release();
  await whenDemoStoreHydrated();
  await flush();

  // The snapshot resolved after the reset was requested; it must not come back.
  const { binders } = useDemoStore.getState();
  assert.ok(binders.length > 0);
  assert.ok(binders.every((binder) => binder.name !== "Stale"));
  assert.equal(fake.clears, 1);
});

/* ------------------------------------------------------------------ */
/*  Slice-level commits                                                 */
/* ------------------------------------------------------------------ */

test("commits only the slices an action actually changed", async () => {
  const fake = createFakePersistence({
    initialized: true,
    collectionRows: storedCollection([makeStoredBinder("Existing")]),
  });

  setDemoPersistence(fake);
  await whenDemoStoreHydrated();
  fake.commits.length = 0;

  await useDemoStore.getState().addBinder("Second Binder");
  assert.equal(fake.commits.length, 1);
  assert.deepEqual(committedSlices(fake.commits[0]), ["collectionRows"]);

  useDemoStore.getState().updateProfile({ username: "Renamed" });
  assert.equal(fake.commits.length, 2);
  assert.deepEqual(committedSlices(fake.commits[1]), ["profile"]);

  await useDemoStore.getState().addWishlist("A Wishlist");
  assert.equal(fake.commits.length, 3);
  assert.deepEqual(committedSlices(fake.commits[2]), ["wishlistRows"]);

  useDemoStore.getState().updatePreferences({ showPricing: false });
  assert.equal(fake.commits.length, 4);
  assert.deepEqual(committedSlices(fake.commits[3]), ["preferences"]);
});

test("does not persist decks, trades or sealed until they are mutated", async () => {
  const fake = createFakePersistence(null);

  setDemoPersistence(fake);
  await whenDemoStoreHydrated();
  useDemoStore.getState().init();

  // Seeding writes the collection, not the portfolio fixtures — those are
  // re-imported from demo-portfolio.ts on every boot anyway.
  assert.deepEqual(committedSlices(fake.commits[0]), [
    "collectionRows",
    "initialized",
    "wishlistRows",
  ]);
  assert.deepEqual(useDemoStore.getState().decks, DEMO_DECKS);
  assert.deepEqual(useDemoStore.getState().trades, DEMO_TRADES);
  assert.deepEqual(useDemoStore.getState().sealed, DEMO_SEALED_PRODUCTS);

  fake.commits.length = 0;
  await useDemoStore.getState().addDeck({
    name: "Brew",
    tcg: "magic",
    format: "Modern",
  });
  assert.deepEqual(committedSlices(fake.commits[0]), ["deckRows"]);

  fake.commits.length = 0;
  await useDemoStore.getState().addTrade({
    partner: "Someone",
    giving: [],
    receiving: [],
  });
  assert.deepEqual(committedSlices(fake.commits[0]), ["tradeRows"]);

  fake.commits.length = 0;
  await useDemoStore.getState().addSealedProduct({
    name: "Booster Box",
    tcg: "magic",
    type: "Booster Box",
    set: "Modern Horizons 3",
    quantity: 1,
    purchasePrice: 200,
    currentValue: 240,
  });
  assert.deepEqual(committedSlices(fake.commits[0]), ["sealedRows"]);
});

test("a mutated portfolio slice is restored on the next visit", async () => {
  const first = createFakePersistence(null);
  setDemoPersistence(first);
  await whenDemoStoreHydrated();
  useDemoStore.getState().init();
  await useDemoStore.getState().addDeck({
    name: "Persisted Brew",
    tcg: "magic",
    format: "Modern",
  });

  // Same bytes, a fresh boot.
  const carried = first.snapshot();
  assert.ok(carried);
  const second = createFakePersistence(carried, { deferHydration: true });
  setDemoPersistence(second);
  useDemoStore.getState().init();
  second.release();
  await whenDemoStoreHydrated();
  await flush();

  const state = useDemoStore.getState();
  assert.equal(state.decks[0]?.name, "Persisted Brew");
  assert.equal(state.decks.length, DEMO_DECKS.length + 1);
});

test("tags, source settings, and binder metadata survive a fresh store hydration", async () => {
  const first = createFakePersistence(null);
  setDemoPersistence(first);
  await whenDemoStoreHydrated();

  const beforeBinder = structuredClone(useDemoStore.getState().collectionRows);
  const id = await useDemoStore.getState().addBinder("Persistent Binder");
  assert.equal(
    await useDemoStore.getState().updateBinder(id, {
      description: "Metadata that must not disappear",
      colorHex: "AABBCC",
      containerType: "zip-binder",
      imageUrl: "https://example.com/binder.jpg",
      associatedTcg: "pokemon",
      associatedSetCode: "sv3pt5",
      associatedSetName: "151",
      isPublic: true,
      rotateShareToken: true,
    }),
    true,
  );
  useDemoStore.getState().recordCollectionMutation({
    operationKind: "add",
    affectedCopies: 0,
    binderId: id,
    summary: "Created persistent binder",
    before: beforeBinder,
    after: structuredClone(useDemoStore.getState().collectionRows),
  });
  useDemoStore
    .getState()
    .addTag({ label: "Illustration Rare", colorHex: "f00baa" });
  useDemoStore.getState().updateSettings({
    appName: "My Demo",
    scryfallApiBaseUrl: "https://catalog.example.test",
    scrydexApiKey: "demo-secret",
  });

  const second = createFakePersistence(first.snapshot(), {
    deferHydration: true,
  });
  setDemoPersistence(second);
  second.release();
  await whenDemoStoreHydrated();

  const restored = useDemoStore.getState();
  assert.equal(restored.tags[0]?.label, "Illustration Rare");
  assert.equal(
    restored.collectionHistory[0]?.summary,
    "Created persistent binder",
  );
  assert.equal(restored.settings.appName, "My Demo");
  assert.equal(
    restored.settings.scryfallApiBaseUrl,
    "https://catalog.example.test",
  );
  assert.equal(restored.settings.scrydexApiKey, "demo-secret");
  const binder = restored.binders.find((entry) => entry.id === id);
  assert.equal(binder?.description, "Metadata that must not disappear");
  assert.equal(binder?.color, "#AABBCC");
  assert.equal(binder?.containerType, "zip-binder");
  assert.equal(binder?.associatedSetName, "151");
  assert.equal(binder?.isPublic, true);
  assert.match(binder?.shareToken ?? "", /^demo-share-/);
});

test("portfolio edit and lifecycle actions update row-backed read models", async () => {
  const fake = createFakePersistence(null);
  setDemoPersistence(fake);
  await whenDemoStoreHydrated();
  useDemoStore.getState().init();

  const deckId = await useDemoStore.getState().addDeck({
    name: "First name",
    tcg: "Magic",
    format: "Modern",
  });
  await useDemoStore.getState().updateDeck(deckId, {
    name: "Updated brew",
    description: "Ready for Friday.",
    isComplete: true,
    cards: [
      {
        name: "Lightning Bolt",
        quantity: 4,
        type: "Instant",
        rarity: "Uncommon",
      },
    ],
  });
  const deck = useDemoStore.getState().decks.find((item) => item.id === deckId);
  assert.equal(deck?.name, "Updated brew");
  assert.equal(deck?.isComplete, true);
  assert.deepEqual(deck?.cards, [
    {
      name: "Lightning Bolt",
      quantity: 4,
      type: "Instant",
      rarity: "Uncommon",
    },
  ]);

  const tradeId = await useDemoStore.getState().addTrade({
    partner: "Lifecycle tester",
    giving: [],
    receiving: [],
  });
  await useDemoStore.getState().setTradeStatus(tradeId, "completed");
  assert.equal(
    useDemoStore.getState().trades.find((item) => item.id === tradeId)?.status,
    "completed",
  );
  await useDemoStore.getState().removeTrade(tradeId);
  assert.equal(
    useDemoStore.getState().trades.some((item) => item.id === tradeId),
    false,
  );

  const sealedId = await useDemoStore.getState().addSealedProduct({
    name: "Test box",
    tcg: "Pokemon",
    type: "Booster Box",
    set: "Test Set",
    quantity: 1,
    purchasePrice: 100,
    currentValue: 100,
  });
  await useDemoStore.getState().updateSealedProduct(sealedId, {
    quantity: 2,
    purchasePrice: 90,
    currentValue: 125,
    purchaseDate: "2026-01-15",
  });
  const sealed = useDemoStore
    .getState()
    .sealed.find((item) => item.id === sealedId);
  assert.equal(sealed?.quantity, 2);
  assert.equal(sealed?.purchasePrice, 90);
  assert.equal(sealed?.currentValue, 125);
  assert.equal(sealed?.purchaseDate, "2026-01-15");

  await useDemoStore.getState().removeSealedProduct(sealedId);
  assert.equal(
    useDemoStore.getState().sealed.some((item) => item.id === sealedId),
    false,
  );
});

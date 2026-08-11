/**
 * Dexie-backed implementation of `DemoPersistence` (Stage 2 of
 * `docs/data-layer-dexie-convex-plan.md`).
 *
 * Modelled on societyer's `src/lib/localDexieRowStore.ts`, reduced to the four
 * patterns that plan says to take and nothing else: explicit immutable version
 * declarations, an application-level schema version kept separately in `meta`,
 * hydrate-then-replay with a `whenHydrated()` gate, and one `rw` transaction
 * per batch of writes. No change journal, no attachments, no tombstones — demo
 * data is resettable fixtures, not records of record.
 *
 * Two invariants hold everywhere below, because breaking either is worse than
 * losing persistence entirely:
 *
 * 1. **Nothing reaches the caller.** Every storage failure degrades this to an
 *    in-memory store for the session and logs once. The demo is the marketing
 *    surface; a blocked IndexedDB must not white-screen it (§5 R4).
 * 2. **Data we could not read is never written over or deleted.** A failed
 *    read, an unreadable legacy payload, or a database written by a *newer*
 *    release all end the same way: leave it alone, run in memory, tell the user
 *    nothing is being saved this session (§5 R1).
 *
 * Bundle note (§5 R6): `dexie` is loaded through a dynamic `import()` so it
 * lands in its own chunk. `demo-store.ts` is reachable from non-demo pages via
 * `use-catalog.ts`, and a static import here would pull ~25 kB of IndexedDB
 * wrapper into the authenticated app's main bundle for no reason. This module
 * also performs no work at import time, so it is safe to `import()` lazily from
 * the store as well.
 */

import type { Table } from "dexie";
import {
  DEMO_SCHEMA_VERSION,
  DEMO_SLICES,
  createMemoryPersistence,
  type DemoPersistence,
  type DemoSlice,
  type PersistedDemoState,
} from "./demo-persistence";
import { readLegacyDemoState, removeLegacyDemoState } from "./demo-local";

/** IndexedDB database name. Sits alongside `tcger-catalog` / `tcger-scan-cache`. */
const DEMO_DB_NAME = "tcger-demo";

/** `meta` row holding the application-level schema version (see below). */
const META_SCHEMA_VERSION_KEY = "schemaVersion";
/** `meta` row recording that the legacy localStorage payload was absorbed. */
const META_LEGACY_IMPORT_KEY = "legacyImport";

/**
 * How long writes are allowed to accumulate before they are flushed together.
 * A single demo mutation fans out into several `set()` calls (add a card, then
 * enrich it from the catalog), and the old store rewrote its entire state for
 * each one. Coalescing collapses that burst into one transaction.
 *
 * Kept deliberately short: anything buffered is lost if the tab is closed
 * mid-window, and 25 ms is below the threshold where a user could act on it.
 */
const COMMIT_COALESCE_MS = 25;
/** Backoff before retrying a failed flush — transient errors are common, permanent ones are not. */
const COMMIT_RETRY_MS = 750;
/** Consecutive failed flushes before giving up on storage for the session (quota exhaustion never recovers). */
const MAX_COMMIT_FAILURES = 3;
/**
 * Hydration must resolve. `whenHydrated()` gates the store's `init()`, so a
 * hydrate that hangs — a version upgrade blocked by another tab, a wedged
 * IndexedDB in a webview — would freeze the demo shell forever rather than
 * merely fail to restore it.
 */
const HYDRATE_TIMEOUT_MS = 5_000;

interface DemoRecordRow {
  /** A `DemoSlice`. Typed loosely because rows written by other versions may exist. */
  key: string;
  value: unknown;
}

interface DemoMetaRow {
  key: string;
  value: unknown;
}

/**
 * The Dexie schema.
 *
 * **Never edit a released `version(n)` block.** Dexie replays the declared
 * versions against whatever the browser already has; changing an old block
 * means an existing database is upgraded along a path that was never released,
 * which is how you corrupt data that is already in users' browsers. To change
 * the schema, add `this.version(2).stores({...})` below and leave version 1
 * exactly as it is.
 *
 * Note that this store version is *not* `DEMO_SCHEMA_VERSION`. This one
 * describes the object stores and their indexes; `DEMO_SCHEMA_VERSION`
 * describes the shape of the values inside them and is stamped in `meta`.
 * societyer keeps both for the same reason: a row-shape migration usually needs
 * no store change, and a store change usually needs no row rewrite.
 */
async function loadDemoDatabase() {
  const { default: Dexie } = await import("dexie");

  class DemoDatabase extends Dexie {
    records!: Table<DemoRecordRow, string>;
    meta!: Table<DemoMetaRow, string>;

    constructor(name: string) {
      super(name);
      // v1 — released. Do not edit; add a new version block instead.
      this.version(1).stores({
        records: "&key",
        meta: "&key",
      });
    }
  }

  return DemoDatabase;
}

type DemoDatabaseCtor = Awaited<ReturnType<typeof loadDemoDatabase>>;
type DemoDatabase = InstanceType<DemoDatabaseCtor>;

let demoDatabaseCtorPromise: Promise<DemoDatabaseCtor> | null = null;

function demoDatabaseCtor(): Promise<DemoDatabaseCtor> {
  // Cached so the class (and therefore the schema declaration) is created once
  // per session even if several persistence instances are constructed.
  if (!demoDatabaseCtorPromise) {
    demoDatabaseCtorPromise = loadDemoDatabase().catch((error: unknown) => {
      // A *failure* is not cached: a chunk that failed to load once — flaky
      // network, or a deploy swapping assets out from under an open tab — can
      // succeed on the next attempt, and caching the rejection would condemn
      // the rest of the session to memory-only for a transient error.
      demoDatabaseCtorPromise = null;
      throw error;
    });
  }
  return demoDatabaseCtorPromise;
}

const warned = new Set<string>();

/**
 * Storage problems are diagnostics, not events — the same broken browser will
 * hit the same path on every write. One line per distinct cause, per session.
 */
function warnOnce(tag: string, message: string, error?: unknown): void {
  if (warned.has(tag)) return;
  warned.add(tag);
  if (error === undefined) console.warn(`[tcger-demo-store] ${message}`);
  else console.warn(`[tcger-demo-store] ${message}`, error);
}

/**
 * Whether IndexedDB can even be touched here.
 *
 * Accessing `window.indexedDB` is itself throwing code in some configurations
 * (sandboxed iframes without `allow-same-origin`, storage blocked by policy),
 * so the probe is wrapped. This is a *capability* check only — an
 * `indexedDB` that exists but refuses to open is handled later, during
 * hydration, because that failure is only observable asynchronously.
 */
export function isIndexedDbUsable(): boolean {
  if (typeof window === "undefined") return false; // SSR / static prerender
  try {
    return Boolean(window.indexedDB);
  } catch {
    return false;
  }
}

class DexieDemoPersistence implements DemoPersistence {
  /** `null` once storage has been abandoned; from then on this is a memory store. */
  private db: DemoDatabase | null = null;
  /**
   * The authoritative in-memory view. Before hydration completes it holds
   * *only* what `commit()` buffered, which is what makes the replay in
   * `hydrate()` a simple overlay.
   */
  private state: Partial<PersistedDemoState> | null = null;
  /** Slices written but not yet flushed. Last write per slice wins. */
  private pending: Partial<PersistedDemoState> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serialises flushes and `clear()` so two transactions never interleave. */
  private writeChain: Promise<void> = Promise.resolve();
  private consecutiveFailures = 0;
  /** Set once storage has been given up on, so writes stop being scheduled. */
  private storageAbandoned = false;
  private readonly hydrated: Promise<void>;
  /**
   * Bumped whenever an in-flight hydrate's result must be discarded (storage
   * abandoned, or `clear()` raced it). Without this a slow read could land
   * *after* a reset and silently restore the data the user just deleted.
   */
  private generation = 0;

  constructor() {
    this.hydrated = this.startHydration();
  }

  whenHydrated(): Promise<void> {
    return this.hydrated;
  }

  snapshot(): Partial<PersistedDemoState> | null {
    return this.state;
  }

  commit(changes: Partial<PersistedDemoState>): void {
    const slices = pickSlices(changes);
    if (!slices) return;

    // Memory first, unconditionally: the in-memory view must stay correct even
    // when the write below never reaches disk, or a caller that re-reads
    // `snapshot()` would see its own change vanish.
    this.state = { ...(this.state ?? {}), ...slices };

    if (this.storageAbandoned) return; // memory-only session; nothing to schedule

    // Note the absence of a `this.db` check: during hydration (which includes
    // the dynamic `import("dexie")`) there is no database object yet, and a
    // write that arrived in that window is precisely the one that must not be
    // dropped. It is buffered here and written by the flush, which runs after
    // `whenHydrated()` resolves.
    this.pending = { ...(this.pending ?? {}), ...slices };
    this.scheduleFlush(COMMIT_COALESCE_MS);
  }

  clear(): Promise<void> {
    // Drop buffered writes before anything else: a flush that fires after the
    // wipe would resurrect exactly the state the caller asked to destroy.
    this.cancelFlush();
    this.pending = null;
    this.state = null;
    this.generation += 1;

    this.writeChain = this.writeChain
      .then(() => this.clearNow())
      .catch(() => {
        /* `clearNow` handles its own failures; never poison the chain */
      });
    return this.writeChain;
  }

  /* ---------------------------------------------------------------- */
  /*  Hydration                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Wraps `hydrate()` so the returned promise **always resolves**, and resolves
   * within a bounded time. Callers gate their first render on it.
   */
  private startHydration(): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timer = setTimeout(() => {
        if (settled) return;
        // Storage we cannot finish reading must not become storage we write to:
        // seeding a fresh demo over data we never saw is the one way to lose it.
        this.abandonStorage(
          "hydrate-timeout",
          `Reading the demo database took longer than ${HYDRATE_TIMEOUT_MS} ms; running in memory for this session. Stored data is left untouched.`,
        );
        finish();
      }, HYDRATE_TIMEOUT_MS);

      this.hydrate()
        .catch((error: unknown) => {
          this.abandonStorage(
            "hydrate-failed",
            "IndexedDB is unavailable; the demo runs in memory for this session and changes will not be saved.",
            error,
          );
        })
        .finally(() => {
          clearTimeout(timer);
          finish();
        });
    });
  }

  private async hydrate(): Promise<void> {
    const generation = this.generation;

    const DatabaseCtor = await demoDatabaseCtor();
    if (generation !== this.generation) return;

    const db = new DatabaseCtor(DEMO_DB_NAME);
    this.db = db;
    // Explicit rather than implicit-on-first-query, so an unopenable database
    // fails here — in the one place that knows how to degrade — instead of
    // somewhere inside a write.
    await db.open();

    const [versionRow, recordCount] = await Promise.all([
      db.meta.get(META_SCHEMA_VERSION_KEY),
      db.records.count(),
    ]);
    const storedVersion = readSchemaVersion(versionRow);

    // A database written by a newer release: we do not know its row shape, so
    // we neither trust nor overwrite it. Run in memory and leave it intact for
    // whenever the newer build is served again (Pages rollbacks are real).
    if (storedVersion !== null && storedVersion > DEMO_SCHEMA_VERSION) {
      this.abandonStorage(
        "schema-from-the-future",
        `The stored demo data was written by a newer version (schema ${storedVersion} > ${DEMO_SCHEMA_VERSION}); running in memory and leaving it untouched.`,
      );
      return;
    }

    let loaded: Partial<PersistedDemoState> | null = null;

    // The import guard is the *marker in `meta`*, not the presence of the
    // localStorage key: the key can be removed by a "clear site data", by
    // another tab, or by a removal that failed after a successful import. An
    // empty `records` table is a second, independent guard — if anything has
    // ever been persisted here, this is not a first boot (§5 R1).
    if (storedVersion === null && recordCount === 0) {
      loaded = await this.importLegacyState(db);
      if (generation !== this.generation || this.db !== db) return;
    }

    if (!loaded) {
      loaded = readRecordRows(await db.records.toArray());
      if (generation !== this.generation || this.db !== db) return;
      if (
        loaded &&
        storedVersion !== null &&
        storedVersion < DEMO_SCHEMA_VERSION
      ) {
        loaded = await this.migrateStoredState(db, loaded, storedVersion);
        if (generation !== this.generation || this.db !== db) return;
      }
    }

    // Replay: anything `commit()` buffered while this read was in flight is
    // newer than what we just read, so it goes on top. Before hydration
    // completes `this.state` contains nothing else, which is what makes this a
    // plain overlay rather than a merge (societyer's `preHydrationOps`).
    const overlay = this.state;
    this.state = overlay ? { ...(loaded ?? {}), ...overlay } : loaded;
  }

  /**
   * One-time absorption of the `zustand/persist` payload (§5 R1). Returns the
   * imported state, or `null` when there was nothing importable — in which case
   * the localStorage value is still there, byte for byte.
   */
  private async importLegacyState(
    db: DemoDatabase,
  ): Promise<Partial<PersistedDemoState> | null> {
    let payload: ReturnType<typeof readLegacyDemoState>;
    try {
      payload = readLegacyDemoState();
    } catch (error) {
      // `readLegacyDemoState` is written not to throw; if it somehow does, that
      // is emphatically not a reason to touch the user's data.
      warnOnce(
        "legacy-read-failed",
        "Could not read the legacy demo data; it has been left in place.",
        error,
      );
      return null;
    }
    if (!payload) return null;

    const rows = toRecordRows(payload.state);
    if (!rows.length) return null;

    try {
      // Data and marker land together or not at all. A commit that stamped the
      // marker without the rows would make the next boot skip the import and
      // read an empty database — the payload would still exist, but nothing
      // would ever look at it again.
      await db.transaction("rw", db.records, db.meta, async () => {
        await db.records.bulkPut(rows);
        await db.meta.bulkPut([
          { key: META_SCHEMA_VERSION_KEY, value: DEMO_SCHEMA_VERSION },
          {
            key: META_LEGACY_IMPORT_KEY,
            value: {
              importedAt: new Date().toISOString(),
              persistVersion: payload.persistVersion,
              slices: rows.map((row) => row.key),
              rejectedSlices: payload.rejectedSlices,
            },
          },
        ]);
      });
    } catch (error) {
      warnOnce(
        "legacy-import-failed",
        "Could not copy the legacy demo data into IndexedDB; it has been left in localStorage untouched.",
        error,
      );
      return null;
    }

    if (payload.rejectedSlices.length) {
      warnOnce(
        "legacy-import-partial",
        `Imported the legacy demo data, skipping unreadable section(s): ${payload.rejectedSlices.join(", ")}.`,
      );
    }

    // Only now — data committed, marker stamped — is dropping the source safe.
    // (The plan's more conservative option is to keep the key for one release;
    // that is a one-line change here, at the cost of leaving a multi-megabyte
    // payload occupying the localStorage quota this migration exists to free.)
    removeLegacyDemoState();

    return payload.state;
  }

  /**
   * Row-shape migration hook, keyed on the application-level version in `meta`.
   *
   * `DEMO_SCHEMA_VERSION` is 1 and there is nothing to migrate yet, so this
   * only re-stamps. When the shape of a slice changes incompatibly: bump
   * `DEMO_SCHEMA_VERSION` in `demo-persistence.ts`, add a step below that
   * transforms `state` from `fromVersion` upward, and leave the Dexie
   * `version(1)` block alone — the object stores are unaffected by a change of
   * what is inside a value.
   */
  private async migrateStoredState(
    db: DemoDatabase,
    state: Partial<PersistedDemoState>,
    fromVersion: number,
  ): Promise<Partial<PersistedDemoState>> {
    const migrated = state; // no steps registered yet
    try {
      await db.transaction("rw", db.records, db.meta, async () => {
        const rows = toRecordRows(migrated);
        if (rows.length) await db.records.bulkPut(rows);
        await db.meta.put({
          key: META_SCHEMA_VERSION_KEY,
          value: DEMO_SCHEMA_VERSION,
        });
      });
    } catch (error) {
      // The migrated value is still correct in memory for this session; the
      // stored rows keep their old shape and will be migrated again next boot.
      warnOnce(
        "migrate-failed",
        `Could not persist the migration of demo data from schema ${fromVersion} to ${DEMO_SCHEMA_VERSION}.`,
        error,
      );
    }
    return migrated;
  }

  /* ---------------------------------------------------------------- */
  /*  Writes                                                           */
  /* ---------------------------------------------------------------- */

  private scheduleFlush(delayMs: number): void {
    // An existing timer always wins: re-arming on every commit would let a
    // steady stream of writes postpone the flush indefinitely.
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.writeChain = this.writeChain
        .then(() => this.flushNow())
        .catch(() => {
          /* `flushNow` handles its own failures; never poison the chain */
        });
    }, delayMs);
  }

  private cancelFlush(): void {
    if (this.flushTimer === null) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async flushNow(): Promise<void> {
    // Never write before the read finishes: the hydrate transaction and this
    // one would otherwise race over the same keys, and a write that lost that
    // race would be silently reverted by hydration's overlay.
    await this.hydrated;

    const changes = this.pending;
    this.pending = null;
    if (!changes) return;

    const db = this.db;
    if (!db) return; // storage abandoned while this was queued

    const rows = toRecordRows(changes);
    if (!rows.length) return;

    try {
      // One transaction for the whole batch. Dexie aborts it as a unit, so a
      // failure leaves every touched key at its previously persisted value
      // rather than half-updated. The schema-version stamp rides along so the
      // marker exists the moment anything is durable.
      await db.transaction("rw", db.records, db.meta, async () => {
        await db.records.bulkPut(rows);
        await db.meta.put({
          key: META_SCHEMA_VERSION_KEY,
          value: DEMO_SCHEMA_VERSION,
        });
      });
      this.consecutiveFailures = 0;
    } catch (error) {
      this.consecutiveFailures += 1;
      warnOnce(
        "commit-failed",
        "Could not save demo changes to IndexedDB; the previously saved state is unchanged.",
        error,
      );

      if (this.consecutiveFailures >= MAX_COMMIT_FAILURES) {
        // Repeated failures mean quota exhaustion or a dead connection, neither
        // of which a fourth attempt fixes. Stop trying rather than retrying on
        // every keystroke for the rest of the session.
        this.abandonStorage(
          "commit-abandoned",
          `Saving failed ${this.consecutiveFailures} times in a row; the demo continues in memory for this session.`,
        );
        return;
      }

      // Requeue for one more attempt, but let anything committed since this
      // flush started win — it is newer.
      this.pending = { ...changes, ...(this.pending ?? {}) };
      this.scheduleFlush(COMMIT_RETRY_MS * this.consecutiveFailures);
    }
  }

  private async clearNow(): Promise<void> {
    await this.hydrated;
    // Re-asserted after the await: hydration may have resolved between `clear()`
    // being called and this running, and it assigns `state`.
    this.state = null;

    const db = this.db;
    if (!db) return;

    try {
      await db.transaction("rw", db.records, db.meta, async () => {
        await db.records.clear();
        await db.meta.clear();
        // Re-stamp immediately. An empty `meta` is indistinguishable from a
        // fresh database, and a fresh database re-runs the legacy import — so a
        // leftover `tcg-demo-store` (one whose removal failed) would come back
        // to life on the next boot, undoing the reset.
        await db.meta.put({
          key: META_SCHEMA_VERSION_KEY,
          value: DEMO_SCHEMA_VERSION,
        });
      });
    } catch (error) {
      warnOnce("clear-failed", "Could not clear the stored demo data.", error);
    }
  }

  /**
   * Give up on storage for the rest of the session and continue in memory.
   * Deliberately does not touch `state`: what is already in memory stays usable,
   * and what is already on disk stays as it was.
   */
  private abandonStorage(tag: string, message: string, error?: unknown): void {
    // Idempotent. Abandoning tends to cascade — the timeout fires, the database
    // is closed, and the read that was still in flight then fails against a
    // closed handle — and only the first cause is worth reporting.
    if (this.storageAbandoned) return;

    const db = this.db;
    this.db = null;
    this.storageAbandoned = true;
    this.pending = null;
    this.cancelFlush();
    // Discard any in-flight hydrate result — its database is gone.
    this.generation += 1;
    try {
      db?.close();
    } catch {
      /* closing an already-broken handle is best effort */
    }
    warnOnce(tag, message, error);
  }
}

/* ------------------------------------------------------------------ */
/*  Row <-> state mapping                                              */
/* ------------------------------------------------------------------ */

/**
 * Keep only known slices with a defined value.
 *
 * Unknown keys are ignored rather than stored: a key we do not recognise would
 * survive in `records` forever and be handed back to the store on every future
 * boot. `undefined` is dropped because IndexedDB would round-trip it into an
 * explicit `undefined` property, which reads as "the slice exists and is
 * missing" rather than "the slice was never written".
 */
function pickSlices(
  changes: Partial<PersistedDemoState>,
): Partial<PersistedDemoState> | null {
  if (!changes || typeof changes !== "object") return null;
  const picked: Partial<PersistedDemoState> = {};
  let count = 0;
  for (const slice of DEMO_SLICES) {
    const value = (changes as Record<string, unknown>)[slice];
    if (value === undefined) continue;
    (picked as Record<string, unknown>)[slice] = value;
    count += 1;
  }
  return count ? picked : null;
}

function toRecordRows(state: Partial<PersistedDemoState>): DemoRecordRow[] {
  const picked = pickSlices(state);
  if (!picked) return [];
  return Object.entries(picked).map(([key, value]) => ({ key, value }));
}

/**
 * Rebuild state from stored rows. Returns `null` when nothing recognisable is
 * stored — the caller's signal to seed a fresh demo, so it must not be a
 * non-null empty object.
 */
function readRecordRows(
  rows: DemoRecordRow[],
): Partial<PersistedDemoState> | null {
  const known = new Set<string>(DEMO_SLICES);
  const state: Partial<PersistedDemoState> = {};
  let count = 0;
  for (const row of rows) {
    // Rows for slices this build does not know about are left in place,
    // untouched: a newer release may still want them.
    if (!row || typeof row.key !== "string" || !known.has(row.key)) continue;
    if (row.value === undefined) continue;
    (state as Record<string, unknown>)[row.key as DemoSlice] = row.value;
    count += 1;
  }
  return count ? state : null;
}

function readSchemaVersion(row: DemoMetaRow | undefined): number | null {
  const value = row?.value;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/* ------------------------------------------------------------------ */
/*  Factories                                                          */
/* ------------------------------------------------------------------ */

/**
 * The Dexie implementation. Safe to construct anywhere: it opens nothing
 * synchronously, and if IndexedDB turns out to be unusable it degrades to an
 * in-memory store on its own rather than throwing at the caller.
 */
export function createDexiePersistence(): DemoPersistence {
  return new DexieDemoPersistence();
}

/**
 * Pick an implementation. Call this — not `createDexiePersistence` — from the
 * store.
 *
 * Safe during SSR and static prerender: the check runs at call time and nothing
 * in this module touches `window` or `indexedDB` at module scope (§5 R5).
 */
export function createDemoPersistence(): DemoPersistence {
  // No warning on the server: there is nothing wrong with a prerender having no
  // IndexedDB, and a build log full of storage warnings trains people to ignore
  // the one that matters.
  if (typeof window === "undefined") return createMemoryPersistence();

  if (!isIndexedDbUsable()) {
    warnOnce(
      "indexeddb-unavailable",
      "IndexedDB is not available in this browser; demo changes are kept in memory only.",
    );
    return createMemoryPersistence();
  }
  return createDexiePersistence();
}

/**
 * Persistence contract for the demo store.
 *
 * Modelled on societyer's `LocalRowStore` (`shared/portable/localRowStore.ts`),
 * deliberately reduced to what TCGer actually needs. The reference's version is
 * ~800 lines because it also carries a change journal, attachments and snapshot
 * export/import; none of that applies to resettable demo fixtures.
 *
 * Three properties matter, and they are the ones the previous
 * `zustand/persist` → localStorage arrangement did not provide:
 *
 * 1. **Slice-level commits.** The old store serialised its entire state on
 *    every mutation. Catalog enrichment writes card art back into those rows,
 *    so the blob grows without bound against a ~5 MB localStorage quota and is
 *    rewritten in full each time a single quantity changes.
 * 2. **Async hydration that callers can await.** IndexedDB is asynchronous
 *    where localStorage is not. Anything branching on "is the demo empty" —
 *    `init()` and `resetDemo()` — must wait, or a returning visitor is
 *    re-seeded over their own collection.
 * 3. **Explicit versioning.** The released localStorage payload carries no
 *    version field, so a reader cannot tell a current payload from an old one.
 *    Every implementation stamps `schemaVersion` and migrates on read.
 *
 * Implementations must never throw at the caller. Storage can be unavailable
 * (private browsing, blocked IndexedDB, exhausted quota) and the demo has to
 * keep running in memory when it is — degraded, never broken.
 */

import type {
  DemoBinder,
  DemoProfile,
  DemoWishlist,
} from "@/stores/demo-store";
import type { Deck, SealedProduct, Trade } from "@/lib/data/demo-portfolio";
import type { UserPreferences } from "@tcg/api-types";

/** Bumped when the shape of a persisted slice changes incompatibly. */
export const DEMO_SCHEMA_VERSION = 1;

/**
 * The persisted projection of the demo store.
 *
 * Deliberately a subset: `decks`, `trades` and `sealed` are re-seeded from
 * `demo-portfolio.ts` on every boot, so they are only persisted once the
 * visitor has actually changed them (see `dirtySlices`).
 */
export interface PersistedDemoState {
  profile: DemoProfile;
  preferences: UserPreferences;
  binders: DemoBinder[];
  wishlists: DemoWishlist[];
  decks: Deck[];
  trades: Trade[];
  sealed: SealedProduct[];
  initialized: boolean;
}

export type DemoSlice = keyof PersistedDemoState;

export const DEMO_SLICES: readonly DemoSlice[] = [
  "profile",
  "preferences",
  "binders",
  "wishlists",
  "decks",
  "trades",
  "sealed",
  "initialized",
] as const;

export interface DemoPersistence {
  /**
   * Resolves once the backing store has been read. Never rejects: a storage
   * failure resolves with nothing loaded so the caller proceeds in memory.
   */
  whenHydrated(): Promise<void>;

  /**
   * The hydrated state, or `null` when this browser has nothing stored (a
   * first visit, or storage unavailable). Callers must treat `null` as "seed
   * a fresh demo" and anything else as "a returning visitor".
   *
   * Only valid after `whenHydrated()` resolves.
   */
  snapshot(): Partial<PersistedDemoState> | null;

  /**
   * Persist only the slices given. Writes are coalesced and applied
   * atomically; a failed write leaves the previous persisted state intact.
   */
  commit(changes: Partial<PersistedDemoState>): void;

  /** Drop everything this implementation owns. Used by "reset demo". */
  clear(): Promise<void>;
}

/**
 * Fallback used when no storage is available at all. Keeps the demo working
 * in memory rather than letting a storage failure surface to the user.
 */
export function createMemoryPersistence(): DemoPersistence {
  let state: Partial<PersistedDemoState> | null = null;
  return {
    whenHydrated: () => Promise.resolve(),
    snapshot: () => state,
    commit: (changes) => {
      state = { ...(state ?? {}), ...changes };
    },
    clear: () => {
      state = null;
      return Promise.resolve();
    },
  };
}

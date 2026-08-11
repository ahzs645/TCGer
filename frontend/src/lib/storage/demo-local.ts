/**
 * Reader for the *legacy* demo payload: the single localStorage key that
 * `zustand/persist` wrote before the demo store moved to IndexedDB.
 *
 * This module exists to be paranoid on behalf of `demo-db.ts`. The payload it
 * reads is live in real browsers today (the public GitHub Pages demo), it
 * carries no version field of its own, and there is exactly one chance to read
 * it correctly — so every function here is written to fail *closed*: on
 * anything unexpected it returns "nothing importable" and leaves the raw
 * localStorage string exactly as it found it. Deleting data we could not read
 * is the one outcome that cannot be undone.
 *
 * Nothing here throws. Callers treat `null` as "no legacy data" and carry on.
 */

import { DEMO_STORE_STORAGE_KEY } from "./keys";
import type {
  DemoBinder,
  DemoProfile,
  DemoWishlist,
} from "@/stores/demo-store";
import type { Deck, SealedProduct, Trade } from "@/lib/data/demo-portfolio";
import type { UserPreferences } from "@tcg/api-types";
import type { DemoSlice, PersistedDemoState } from "./demo-persistence";

/**
 * The key `zustand/persist` was configured with in `demo-store.ts`.
 *
 * TODO(keys): this belongs in the persistence-key registry
 * (`frontend/src/lib/storage/keys.ts`, Stage 0 of the data-layer plan) and
 * Re-exported from the storage registry so there is exactly one definition of
 * this string in the tree — a second literal here is precisely the drift the
 * registry exists to prevent, and a mismatch would make clearAllLocalData()
 * silently miss the key.
 */
export const LEGACY_DEMO_STORAGE_KEY = DEMO_STORE_STORAGE_KEY;

export interface LegacyDemoPayload {
  /** Only the slices that parsed AND validated. Never empty. */
  state: Partial<PersistedDemoState>;
  /** zustand's own persist version, or `null` if the envelope had none. */
  persistVersion: number | null;
  /** Slice names that were present in the payload but rejected. Diagnostics only. */
  rejectedSlices: DemoSlice[];
}

/**
 * Read and validate the legacy payload.
 *
 * Returns `null` for every "do not import" case — key absent, storage
 * unreadable, JSON invalid, envelope unrecognised, or nothing inside it
 * survived validation. In all of those cases the stored string is left
 * untouched, so a later release with a better reader can still recover it.
 */
export function readLegacyDemoState(): LegacyDemoPayload | null {
  const raw = readRawLegacyValue();
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Truncated or hand-edited JSON. Nothing to import; the string stays.
    return null;
  }

  const envelope = unwrapPersistEnvelope(parsed);
  if (!envelope) return null;

  const state: Partial<PersistedDemoState> = {};
  const rejectedSlices: DemoSlice[] = [];
  let accepted = 0;

  for (const [slice, read] of Object.entries(SLICE_READERS) as [
    DemoSlice,
    (value: unknown) => unknown,
  ][]) {
    // Absent slices are normal (the payload predates whatever we added last);
    // they simply are not imported. Only a *present but malformed* slice is a
    // rejection worth reporting.
    if (!(slice in envelope.state)) continue;
    const value = read((envelope.state as Record<string, unknown>)[slice]);
    if (value === undefined) {
      rejectedSlices.push(slice);
      continue;
    }
    (state as Record<string, unknown>)[slice] = value;
    accepted += 1;
  }

  // Nothing usable: treat as "no legacy data" rather than importing an empty
  // shell, which would otherwise mark this visitor as "returning" and suppress
  // the seed they should get.
  if (accepted === 0) return null;

  return { state, persistVersion: envelope.version, rejectedSlices };
}

/**
 * Drop the legacy key. Only safe to call once the payload is durably in the new
 * store; see the ordering comment at the import site in `demo-db.ts`.
 *
 * A failure here is deliberately swallowed: the import already committed, and a
 * leftover key is harmless because the import guard is a marker in the database,
 * not the presence of this key.
 */
export function removeLegacyDemoState(): void {
  try {
    window.localStorage.removeItem(LEGACY_DEMO_STORAGE_KEY);
  } catch {
    /* private mode / disabled storage — nothing to clean up */
  }
}

/**
 * `window.localStorage` itself can throw on property access (Chrome with
 * third-party storage blocked in an iframe, Firefox with `dom.storage.enabled`
 * off), which is why even the read is wrapped.
 */
function readRawLegacyValue(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_DEMO_STORAGE_KEY);
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Unwrap zustand's persist envelope.
 *
 * Verified against the installed copy of the middleware rather than assumed:
 * `node_modules/zustand/middleware.js` `setItem()` (v5.0.14, ~line 360) writes
 *
 *     storage.setItem(options.name, { state: partialize({...get()}), version: options.version })
 *
 * through `createJSONStorage`, whose `setItem` is
 * `storage.setItem(name, JSON.stringify(newValue, replacer))` (~line 302) — so
 * the stored string is `{"state":{...},"version":n}`. `version` defaults to `0`
 * (~line 336) and `demo-store.ts` passes only `{ name: "tcg-demo-store" }`, so
 * released payloads all carry `"version":0`. Rehydration reads
 * `deserializedStorageValue.state` (~line 409), confirming the same shape on
 * the way back in.
 *
 * A bare state object (no envelope) is also accepted — some payload in the wild
 * may predate the middleware or have been written by hand — but only when it
 * actually looks like demo state, so a random JSON object is not mistaken for
 * one.
 */
function unwrapPersistEnvelope(
  parsed: unknown,
): { state: Record<string, unknown>; version: number | null } | null {
  if (!isPlainObject(parsed)) return null;

  if (isPlainObject(parsed.state)) {
    return {
      state: parsed.state,
      version: typeof parsed.version === "number" ? parsed.version : null,
    };
  }

  if (looksLikeDemoState(parsed)) return { state: parsed, version: null };

  return null;
}

function looksLikeDemoState(value: Record<string, unknown>): boolean {
  return Object.keys(SLICE_READERS).some((slice) => slice in value);
}

/* ------------------------------------------------------------------ */
/*  Slice validators                                                    */
/* ------------------------------------------------------------------ */

/**
 * One reader per slice. Each returns the value to import, or `undefined` to
 * reject the slice.
 *
 * The bias is *repair, not policing*: a row that merely lacks a field we do not
 * key on is kept, while a row that would crash the store on read (a binder with
 * no `cards` array — `demo-store.ts` iterates `binder.cards` unguarded) is
 * normalised, and a row that cannot be addressed at all (no string `id`) is
 * dropped. Rejecting a whole slice for one bad row would lose more than it
 * protects.
 */
const SLICE_READERS: Record<DemoSlice, (value: unknown) => unknown> = {
  profile: readProfile,
  preferences: readPreferences,
  // The localStorage payload is schema 1 by definition: it predates rows, so
  // it always carries `binders` and never `collectionRows`. The v1 -> v2
  // migration converts what this reader imports.
  collectionRows: () => undefined,
  binders: readBinders,
  wishlists: readWishlists,
  decks: readDecks,
  trades: readTrades,
  sealed: readSealed,
  initialized: readInitialized,
};

function readProfile(value: unknown): DemoProfile | undefined {
  if (!isPlainObject(value)) return undefined;
  if (typeof value.username !== "string" || typeof value.email !== "string") {
    return undefined;
  }
  return value as unknown as DemoProfile;
}

function readPreferences(value: unknown): UserPreferences | undefined {
  // Preferences are a flat bag of feature flags that grows over releases. We
  // cannot fill gaps here without importing the store's defaults at runtime,
  // which would create a module cycle (demo-store → demo-db → here). The store
  // owns that merge; this only guarantees the shape is an object.
  if (!isPlainObject(value)) return undefined;
  return value as unknown as UserPreferences;
}

function readBinders(value: unknown): DemoBinder[] | undefined {
  const rows = readIdentifiedRows(value);
  if (!rows) return undefined;
  return rows.map((row) => ({
    ...row,
    cards: readIdentifiedRows(row.cards) ?? [],
  })) as unknown as DemoBinder[];
}

function readWishlists(value: unknown): DemoWishlist[] | undefined {
  const rows = readIdentifiedRows(value);
  if (!rows) return undefined;
  return rows.map((row) => {
    const cards = readIdentifiedRows(row.cards) ?? [];
    // `rules` is optional in the current shape, so an absent one stays absent
    // rather than becoming an invented empty array — "never had rules" and
    // "had rules, all of them unreadable" are different facts.
    if (row.rules === undefined) return { ...row, cards };
    return { ...row, cards, rules: readIdentifiedRows(row.rules) ?? [] };
  }) as unknown as DemoWishlist[];
}

function readDecks(value: unknown): Deck[] | undefined {
  const rows = readIdentifiedRows(value);
  if (!rows) return undefined;
  return rows.map((row) => ({
    ...row,
    cards: readIdentifiedRows(row.cards) ?? [],
  })) as unknown as Deck[];
}

function readTrades(value: unknown): Trade[] | undefined {
  const rows = readIdentifiedRows(value);
  if (!rows) return undefined;
  return rows.map((row) => ({
    ...row,
    giving: asObjectArray(row.giving),
    receiving: asObjectArray(row.receiving),
  })) as unknown as Trade[];
}

function readSealed(value: unknown): SealedProduct[] | undefined {
  const rows = readIdentifiedRows(value);
  if (!rows) return undefined;
  return rows as unknown as SealedProduct[];
}

function readInitialized(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/**
 * An array of plain objects that each carry a string `id`. Anything else in the
 * array is dropped — every consumer keys off `id`, so an id-less row is
 * unreachable and unrenderable.
 */
function readIdentifiedRows(
  value: unknown,
): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (row): row is Record<string, unknown> =>
      isPlainObject(row) && typeof row.id === "string",
  );
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isPlainObject);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

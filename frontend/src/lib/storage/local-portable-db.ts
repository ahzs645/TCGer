/**
 * The local runtime's implementation of {@link PortableDb}.
 *
 * Holds the working set in memory and writes changed rows through to a
 * persistence sink. That is the same arrangement the iOS client already ships
 * (`LocalStore`'s `loadPersistedState` / `persist`), and it is what lets the
 * demo's React selectors keep reading synchronously while the rules below them
 * are written against an async contract.
 *
 * Two properties matter and neither is free:
 *
 * 1. **Row-level writes.** The slice model this replaces committed the entire
 *    `binders` array whenever any part of it changed, so adding one card
 *    rewrote every card the visitor owned. Here a mutation marks one row.
 * 2. **Atomicity.** `transaction()` buffers mutations and applies them in one
 *    go, so a failed quantity reconciliation cannot leave half a group behind.
 *    The contract requires this; the previous store had no notion of it.
 */

import {
  type BinderRow,
  type CardRow,
  type CollectionEntryRow,
  type NewRow,
  type PortableDb,
  type PortableIndexName,
  type PortableQueryOptions,
  type PortableRow,
  type PortableTableName,
  type PortableTables,
  PORTABLE_INDEXES,
} from "@tcg/api-types";

/** Rows grouped by table — the shape the store keeps and persists. */
export interface PortableSnapshot {
  binders: BinderRow[];
  collectionEntries: CollectionEntryRow[];
  cards: CardRow[];
}

export function emptySnapshot(): PortableSnapshot {
  return { binders: [], collectionEntries: [], cards: [] };
}

/**
 * Told which tables changed after every committed mutation, so the owner can
 * persist just those and refresh whatever the UI reads.
 */
export type PortableCommitListener = (
  snapshot: PortableSnapshot,
  changed: ReadonlySet<PortableTableName>,
) => void;

const TABLES: readonly PortableTableName[] = [
  "binders",
  "collectionEntries",
  "cards",
];

let idCounter = 0;

/**
 * Ids are minted locally and are opaque to callers, but they have to survive a
 * round trip through the REST contract and a reload, so they carry a prefix
 * this store can recognise in `normalizeId` and are unique within a session.
 */
function mintId(table: PortableTableName): string {
  idCounter += 1;
  return `local_${table}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
}

function matchesKey<T extends PortableRow>(row: T, key: Partial<T>): boolean {
  for (const [field, value] of Object.entries(key)) {
    if (value === undefined) continue;
    if ((row as Record<string, unknown>)[field] !== value) return false;
  }
  return true;
}

export class LocalPortableDb implements PortableDb {
  private tables: PortableSnapshot;
  private listener: PortableCommitListener | null = null;

  /** Non-null while inside `transaction()`: buffered writes, not yet visible. */
  private staged: PortableSnapshot | null = null;
  private stagedTables: Set<PortableTableName> | null = null;

  constructor(initial: PortableSnapshot = emptySnapshot()) {
    this.tables = initial;
  }

  onCommit(listener: PortableCommitListener | null): void {
    this.listener = listener;
  }

  /** Replace everything, e.g. after hydrating from storage or resetting. */
  load(snapshot: PortableSnapshot): void {
    this.tables = snapshot;
  }

  snapshot(): PortableSnapshot {
    return this.tables;
  }

  /* -------------------------------------------------------------- */
  /*  Reads                                                          */
  /* -------------------------------------------------------------- */

  private read<T extends PortableTableName>(table: T): PortableTables[T][] {
    const source = this.staged ?? this.tables;
    return source[table] as PortableTables[T][];
  }

  get<T extends PortableTableName>(
    table: T,
    id: string,
  ): Promise<PortableTables[T] | null> {
    const row = this.read(table).find((candidate) => candidate._id === id);
    return Promise.resolve(row ?? null);
  }

  // `async` rather than returning a built promise: a method typed as async must
  // reject on a bad index, not throw past the caller's `await`.
  async query<T extends PortableTableName>(
    table: T,
    index: PortableIndexName<T>,
    key: Partial<PortableTables[T]>,
    options?: PortableQueryOptions,
  ): Promise<PortableTables[T][]> {
    // The index is not used to look anything up — the working set is in memory
    // and a scan of it is cheaper than maintaining structures. It is still
    // required and validated, because a rule that queries by a path the hosted
    // runtime has no index for would work here and fall over on Convex.
    const fields = (
      PORTABLE_INDEXES[table] as Record<string, readonly string[]>
    )[index];
    if (!fields) {
      throw new Error(`Unknown index ${String(index)} on ${table}`);
    }
    for (const field of Object.keys(key)) {
      if (!fields.includes(field)) {
        throw new Error(
          `Index ${String(index)} on ${table} cannot serve a lookup by ${field}`,
        );
      }
    }

    let rows = this.read(table).filter((row) => matchesKey(row, key));
    if (options?.order === "desc") {
      rows = [...rows].sort((a, b) => b._creationTime - a._creationTime);
    } else if (options?.order === "asc") {
      rows = [...rows].sort((a, b) => a._creationTime - b._creationTime);
    }
    if (options?.limit !== undefined) rows = rows.slice(0, options.limit);
    return Promise.resolve(rows);
  }

  /* -------------------------------------------------------------- */
  /*  Writes                                                         */
  /* -------------------------------------------------------------- */

  /**
   * Every mutation goes through here so that a write outside `transaction()`
   * still commits atomically — the contract makes no promise that callers wrap
   * single writes, and half-applied single writes would be just as broken.
   */
  private mutate<R>(
    table: PortableTableName,
    apply: (draft: PortableSnapshot) => R,
  ): R {
    if (this.staged) {
      this.stagedTables!.add(table);
      return apply(this.staged);
    }
    const draft: PortableSnapshot = { ...this.tables };
    const result = apply(draft);
    this.tables = draft;
    this.listener?.(this.tables, new Set([table]));
    return result;
  }

  insert<T extends PortableTableName>(
    table: T,
    doc: NewRow<PortableTables[T]>,
  ): Promise<string> {
    const id = mintId(table);
    this.mutate(table, (draft) => {
      const row = {
        ...doc,
        _id: id,
        _creationTime: Date.now(),
      } as PortableTables[T];
      draft[table] = [...(draft[table] as PortableTables[T][]), row] as never;
    });
    return Promise.resolve(id);
  }

  patch<T extends PortableTableName>(
    table: T,
    id: string,
    changes: Partial<NewRow<PortableTables[T]>>,
  ): Promise<void> {
    this.mutate(table, (draft) => {
      const rows = draft[table] as PortableTables[T][];
      const index = rows.findIndex((row) => row._id === id);
      if (index < 0) return;
      const next = [...rows];
      // `undefined` clears, matching Convex's patch: the rules rely on this to
      // express "this field was explicitly cleared" versus "not mentioned".
      next[index] = { ...next[index], ...changes };
      draft[table] = next as never;
    });
    return Promise.resolve();
  }

  delete<T extends PortableTableName>(table: T, id: string): Promise<void> {
    this.mutate(table, (draft) => {
      const rows = draft[table] as PortableTables[T][];
      draft[table] = rows.filter((row) => row._id !== id) as never;
    });
    return Promise.resolve();
  }

  async transaction<R>(
    tables: readonly PortableTableName[],
    fn: () => Promise<R>,
  ): Promise<R> {
    // Declared tables are not needed here — the whole working set is in memory
    // and single-threaded, so there is nothing to lock. Convex and Dexie both
    // require them, which is why the contract carries them.
    void tables;
    if (this.staged) {
      // Already inside one. Nesting shares the outer buffer rather than
      // committing early, so an inner failure still rolls the outer back.
      return fn();
    }
    this.staged = { ...this.tables };
    this.stagedTables = new Set();
    try {
      const result = await fn();
      this.tables = this.staged;
      const changed = this.stagedTables;
      this.staged = null;
      this.stagedTables = null;
      if (changed.size > 0) this.listener?.(this.tables, changed);
      return result;
    } catch (error) {
      // Drop the buffer; `this.tables` was never touched.
      this.staged = null;
      this.stagedTables = null;
      throw error;
    }
  }

  normalizeId(table: PortableTableName, id: string): string | null {
    return id.startsWith(`local_${table}_`) ? id : null;
  }
}

export const PORTABLE_TABLES = TABLES;

import type { EmbeddingIndex } from "./embedding-matcher";
import {
  matchEmbeddingShardsTopK,
  type EmbeddingMatchOptions,
} from "./embedding-search";
import type {
  EmbeddingSearchRequest,
  EmbeddingSearchResponse,
} from "./embedding-search-protocol";
import type { BrowserVideoScanCandidate } from "./scan-types";

export interface EmbeddingSearchWorker {
  onmessage: ((event: MessageEvent<EmbeddingSearchResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: EmbeddingSearchRequest, transfer: Transferable[]): void;
  terminate(): void;
}

/** One serial worker, immutable indexes sent once, and a bounded worker cache. */
export class EmbeddingSearchClient {
  private worker: EmbeddingSearchWorker | null = null;
  private identities = new WeakMap<EmbeddingIndex, number>();
  private registered = new Set<number>();
  private nextIdentity = 0;
  private nextRequest = 0;
  private generation = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private pending: {
    id: number;
    resolve: (value: BrowserVideoScanCandidate[]) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private readonly createWorker: () => EmbeddingSearchWorker) {}

  search(
    query: Float32Array,
    indexes: readonly EmbeddingIndex[],
    options: EmbeddingMatchOptions = {},
  ): Promise<BrowserVideoScanCandidate[]> {
    const generation = this.generation;
    // Own a tiny query copy, never transfer/detach an averaging buffer.
    const capturedQuery = query.slice();
    const capturedIndexes = [...indexes];
    const capturedOptions = {
      ...options,
      allowedExternalIds:
        options.allowedExternalIds && new Set(options.allowedExternalIds),
    };
    const result = this.queue.then(() => {
      if (generation !== this.generation)
        throw new Error("Scanner search was cancelled.");
      return this.dispatch(capturedQuery, capturedIndexes, capturedOptions);
    });
    this.queue = result.catch(() => {});
    return result;
  }

  dispose(): void {
    this.generation++;
    this.worker?.terminate();
    this.worker = null;
    this.registered.clear();
    this.pending?.reject(new Error("Scanner search was cancelled."));
    this.pending = null;
  }

  private dispatch(
    query: Float32Array,
    indexes: readonly EmbeddingIndex[],
    options: EmbeddingMatchOptions,
  ): Promise<BrowserVideoScanCandidate[]> {
    if (!this.worker) {
      const worker = this.createWorker();
      worker.onmessage = ({ data }) => {
        if (!this.pending || this.pending.id !== data.id) return;
        const pending = this.pending;
        this.pending = null;
        this.registered = new Set(data.retainedIndexIds);
        if (data.error) pending.reject(new Error(data.error));
        else pending.resolve(data.candidates ?? []);
      };
      worker.onerror = () => this.dispose();
      worker.onmessageerror = () => this.dispose();
      this.worker = worker;
    }
    const id = ++this.nextRequest;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      try {
        this.worker!.postMessage(
          {
            id,
            query,
            options,
            indexes: indexes.map((index) => {
              let identity = this.identities.get(index);
              if (identity === undefined) {
                identity = ++this.nextIdentity;
                this.identities.set(index, identity);
              }
              return {
                id: identity,
                value: this.registered.has(identity) ? undefined : index,
              };
            }),
          },
          [query.buffer],
        );
      } catch (error) {
        this.dispose();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

let client: EmbeddingSearchClient | undefined;

export async function matchEmbeddingShardsInWorker(
  query: Float32Array,
  indexes: readonly EmbeddingIndex[],
  options: EmbeddingMatchOptions = {},
): Promise<BrowserVideoScanCandidate[]> {
  // Node/SSR tools retain deterministic synchronous matching. Browsers use
  // the worker so vector search cannot block camera UI or navigation.
  if (typeof Worker === "undefined")
    return matchEmbeddingShardsTopK(query, indexes, options);
  if (!client) {
    client = new EmbeddingSearchClient(
      () =>
        new Worker(new URL("./embedding-search.worker.ts", import.meta.url), {
          type: "module",
        }),
    );
    window.addEventListener("pagehide", () => client?.dispose());
  }
  return client.search(query, indexes, options);
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { Worker as NodeWorker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import {
  EmbeddingSearchClient,
  type EmbeddingSearchWorker,
} from "./embedding-search-client";
import { matchEmbeddingShardsTopK } from "./embedding-search";
import type { EmbeddingIndex } from "./embedding-matcher";
import type {
  EmbeddingSearchRequest,
  EmbeddingSearchResponse,
} from "./embedding-search-protocol";

class ThreadWorker implements EmbeddingSearchWorker {
  onmessage: EmbeddingSearchWorker["onmessage"] = null;
  onerror: EmbeddingSearchWorker["onerror"] = null;
  onmessageerror: EmbeddingSearchWorker["onmessageerror"] = null;
  readonly requests: EmbeddingSearchRequest[] = [];
  private readonly thread: NodeWorker;

  constructor() {
    const path = fileURLToPath(
      new URL("./embedding-search.worker.ts", import.meta.url),
    );
    this.thread = new NodeWorker(
      `
      const { parentPort } = require('node:worker_threads');
      globalThis.postMessage = response => parentPort.postMessage(response);
      parentPort.on('message', data => globalThis.onmessage({ data }));
      require('tsx/cjs');
      require(${JSON.stringify(path)});
    `,
      { eval: true },
    );
    this.thread.on("message", (data: EmbeddingSearchResponse) =>
      this.onmessage?.({ data } as MessageEvent<EmbeddingSearchResponse>),
    );
    this.thread.on("error", (error) =>
      this.onerror?.({ message: error.message } as ErrorEvent),
    );
  }

  postMessage(message: EmbeddingSearchRequest, transfer: Transferable[]): void {
    this.requests.push(message);
    this.thread.postMessage(message, transfer as ArrayBuffer[]);
  }

  terminate(): void {
    void this.thread.terminate();
  }
}

function shard(game: string, id: string): EmbeddingIndex {
  return {
    model: "shared",
    dtype: "int8",
    encoder: "arcface",
    dimension: 2,
    tcg: game,
    scale: 127,
    total: 2,
    modelUrl: "/shared.onnx",
    gateUrl: null,
    thresholds: {
      minSimilarity: 0.72,
      minVerifiedSimilarity: 0.65,
      minMargin: 0.08,
    },
    vectors: new Int8Array([127, 0, 0, 127]),
    invNorms: new Float32Array([1 / 127, 1 / 127]),
    entries: [id, `${id}-other`].map((externalId) => ({
      externalId,
      name: externalId,
      setCode: null,
      setName: null,
      rarity: null,
      imageUrl: null,
    })),
  };
}

test("real worker preserves ranking, thresholds, and deck scope without detaching owner buffers", async (t) => {
  const worker = new ThreadWorker();
  const client = new EmbeddingSearchClient(() => worker);
  t.after(() => client.dispose());
  const indexes = [shard("pokemon", "p"), shard("yugioh", "y")];
  const query = new Float32Array([1, 0]);
  const options = {
    topK: 5,
    allowedExternalIds: new Set(["y"]),
    proposalLabel: "worker-test",
  };
  const expected = matchEmbeddingShardsTopK(query, indexes, options);
  assert.deepEqual(await client.search(query, indexes, options), expected);
  assert.deepEqual([...query], [1, 0]);
  assert.equal(indexes[0]!.vectors.byteLength, 4);
  assert.deepEqual(await client.search(query, indexes, options), expected);
  assert.ok(worker.requests[0]!.indexes.every((index) => index.value));
  assert.ok(
    worker.requests[1]!.indexes.every((index) => index.value === undefined),
  );
});

test("queued searches and cache eviction preserve each request's game and encoder contract", async (t) => {
  const worker = new ThreadWorker();
  const client = new EmbeddingSearchClient(() => worker);
  t.after(() => client.dispose());
  const indexes = ["pokemon", "magic", "yugioh", "custom"].map((game) =>
    shard(game, game),
  );
  const query = new Float32Array([1, 0]);
  const results = await Promise.all(
    indexes.map((index) => client.search(query, [index], { topK: 1 })),
  );
  assert.deepEqual(
    results.map((result) => result[0]!.tcg),
    indexes.map((index) => index.tcg),
  );
  assert.equal(
    (await client.search(query, [indexes[0]!], { topK: 1 }))[0]!.tcg,
    "pokemon",
  );
  assert.ok(
    worker.requests[4]!.indexes[0]!.value,
    "evicted indexes must be registered again",
  );
  const incompatible = { ...indexes[1]!, modelUrl: "/other.onnx" };
  assert.deepEqual(await client.search(query, [indexes[0]!, incompatible]), []);
});

test("disposing rejects queued searches instead of publishing stale results", async () => {
  const client = new EmbeddingSearchClient(() => new ThreadWorker());
  const first = client.search(new Float32Array([1, 0]), [
    shard("pokemon", "p"),
  ]);
  const second = client.search(new Float32Array([1, 0]), [shard("magic", "m")]);
  client.dispose();
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every((result) => result.status === "rejected"));
});

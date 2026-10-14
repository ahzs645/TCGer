import { matchEmbeddingShardsTopK } from "./embedding-search";
import type { EmbeddingIndex } from "./embedding-matcher";
import type {
  EmbeddingSearchRequest,
  EmbeddingSearchResponse,
} from "./embedding-search-protocol";

const indexes = new Map<number, EmbeddingIndex>();
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<EmbeddingSearchRequest>) => void;
  postMessage: (response: EmbeddingSearchResponse) => void;
};

scope.onmessage = ({ data }) => {
  try {
    const selected = data.indexes.map(({ id, value }) => {
      if (value) indexes.set(id, value);
      const index = indexes.get(id);
      if (!index)
        throw new Error("Scanner index was released. Retry the scan.");
      // Refresh insertion order for bounded reuse across game/deck switches.
      indexes.delete(id);
      indexes.set(id, index);
      return index;
    });
    const candidates = matchEmbeddingShardsTopK(
      data.query,
      selected,
      data.options,
    );
    while (indexes.size > 3) indexes.delete(indexes.keys().next().value!);
    scope.postMessage({
      id: data.id,
      candidates,
      retainedIndexIds: [...indexes.keys()],
    });
  } catch (error) {
    indexes.clear();
    scope.postMessage({
      id: data.id,
      retainedIndexIds: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

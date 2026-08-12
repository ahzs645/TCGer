import type {
  CollectionTag,
  CollectionCardCopy,
  CollectionCard,
  Binder,
  CreateBinderInput,
  UpdateBinderInput,
  AddCardInput,
  UpdateCardInput,
  CollectionTagResponse,
  CreateTagInput,
  CollectionImportOptions,
  CollectionImportPreview,
  CollectionImportResult,
  CollectionImportRequest,
  CollectionMutationHistoryResponse,
  UndoCollectionMutationResult,
  BulkAddPreview,
  BulkAddRequest,
  BulkAddResult,
} from "@tcg/api-types";
import { API_BASE_URL } from "./base-url";

export interface CollectionsViewerContext {
  id: string;
  email: string;
  username?: string | null;
}

// Re-export shared types with frontend naming convention
export type {
  CollectionTag,
  CollectionCardCopy,
  CollectionCard,
  CollectionTagResponse,
  CreateTagInput,
  CollectionImportOptions,
  CollectionImportPreview,
  CollectionImportResult,
  CollectionMutationAuditEntry,
  CollectionMutationHistoryResponse,
  UndoCollectionMutationResult,
  BulkAddPreview,
  BulkAddRequest,
  BulkAddResult,
} from "@tcg/api-types";

// Frontend uses "Collection" terminology; backend uses "Binder"
export type Collection = Binder;
export type CreateCollectionInput = CreateBinderInput;
export type UpdateCollectionInput = UpdateBinderInput;
export type AddCardToCollectionInput = AddCardInput;
export type UpdateCollectionCardInput = UpdateCardInput;

export const LIBRARY_COLLECTION_ID = "__library__";
function getCollectionsBaseUrl() {
  return API_BASE_URL;
}

function buildHeaders(
  token: string,
  _viewer?: CollectionsViewerContext | null,
  includeJson = true,
): HeadersInit {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };

  if (includeJson) {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

export async function getCollections(
  token: string,
  viewer?: CollectionsViewerContext | null,
): Promise<Collection[]> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections`, {
    headers: buildHeaders(token, viewer),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to fetch collections");
  }

  return response.json();
}

export async function createCollection(
  token: string,
  data: CreateCollectionInput,
  viewer?: CollectionsViewerContext | null,
): Promise<Collection> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections`, {
    method: "POST",
    headers: buildHeaders(token, viewer),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to create collection");
  }

  return response.json();
}

export async function updateCollection(
  token: string,
  collectionId: string,
  data: UpdateCollectionInput,
  viewer?: CollectionsViewerContext | null,
): Promise<Collection> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/${collectionId}`,
    {
      method: "PATCH",
      headers: buildHeaders(token, viewer),
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to update collection");
  }

  return response.json();
}

export async function deleteCollection(
  token: string,
  collectionId: string,
  viewer?: CollectionsViewerContext | null,
): Promise<void> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/${collectionId}`,
    {
      method: "DELETE",
      headers: buildHeaders(token, viewer, false),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to delete collection");
  }
}

export async function addCardToCollection(
  token: string,
  collectionId: string,
  data: AddCardToCollectionInput,
  viewer?: CollectionsViewerContext | null,
): Promise<void> {
  if (collectionId === LIBRARY_COLLECTION_ID) {
    const response = await fetch(
      `${getCollectionsBaseUrl()}/collections/cards`,
      {
        method: "POST",
        headers: buildHeaders(token, viewer),
        body: JSON.stringify(data),
      },
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "Failed to add card to collection");
    }
    await response.json().catch(() => null);
    return;
  }

  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/${collectionId}/cards`,
    {
      method: "POST",
      headers: buildHeaders(token, viewer),
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to add card to collection");
  }
  await response.json().catch(() => null);
}

export async function removeCardFromCollection(
  token: string,
  collectionId: string,
  cardId: string,
  viewer?: CollectionsViewerContext | null,
): Promise<void> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/${collectionId}/cards/${cardId}`,
    {
      method: "DELETE",
      headers: buildHeaders(token, viewer, false),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to remove card from collection");
  }
}

export async function getCollectionMutationHistory(
  token: string,
  viewer?: CollectionsViewerContext | null,
  limit = 50,
): Promise<CollectionMutationHistoryResponse> {
  const params = new URLSearchParams({
    limit: String(Math.min(100, Math.max(1, limit))),
  });
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/history?${params.toString()}`,
    { headers: buildHeaders(token, viewer, false) },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to fetch collection history");
  }
  return response.json();
}

export async function undoCollectionMutation(
  token: string,
  auditId: string,
  idempotencyKey: string,
  viewer?: CollectionsViewerContext | null,
): Promise<UndoCollectionMutationResult> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/history/${encodeURIComponent(auditId)}/undo`,
    {
      method: "POST",
      headers: buildHeaders(token, viewer),
      body: JSON.stringify({ idempotencyKey }),
    },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to undo collection mutation");
  }
  return response.json();
}

export async function updateCollectionCard(
  token: string,
  binderId: string,
  cardId: string,
  data: UpdateCollectionCardInput,
  viewer?: CollectionsViewerContext | null,
): Promise<CollectionCard> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/${binderId}/cards/${cardId}`,
    {
      method: "PATCH",
      headers: buildHeaders(token, viewer),
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to update card in collection");
  }

  return response.json();
}

export async function getTags(
  token: string,
  viewer?: CollectionsViewerContext | null,
): Promise<CollectionTagResponse[]> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections/tags`, {
    headers: buildHeaders(token, viewer),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to fetch tags");
  }

  return response.json();
}

export async function createTag(
  token: string,
  data: CreateTagInput,
  viewer?: CollectionsViewerContext | null,
): Promise<CollectionTagResponse> {
  const response = await fetch(`${getCollectionsBaseUrl()}/collections/tags`, {
    method: "POST",
    headers: buildHeaders(token, viewer),
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to create tag");
  }

  return response.json();
}

async function importRequest<T>(
  token: string,
  action: "preview" | "commit",
  input: CollectionImportRequest,
  viewer?: CollectionsViewerContext | null,
): Promise<T> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/import/${action}`,
    {
      method: "POST",
      headers: buildHeaders(token, viewer),
      body: JSON.stringify(input),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 422) {
    throw new Error(payload.message || `Failed to ${action} collection import`);
  }
  return payload as T;
}

export function previewCollectionCsv(
  token: string,
  csv: string,
  options: CollectionImportOptions,
  viewer?: CollectionsViewerContext | null,
) {
  return importRequest<CollectionImportPreview>(
    token,
    "preview",
    { csv, options },
    viewer,
  );
}

export function commitCollectionCsv(
  token: string,
  csv: string,
  options: CollectionImportOptions,
  viewer?: CollectionsViewerContext | null,
) {
  return importRequest<CollectionImportResult>(
    token,
    "commit",
    { csv, options },
    viewer,
  );
}

export function previewCollectionSource(
  token: string,
  input: CollectionImportRequest,
  viewer?: CollectionsViewerContext | null,
) {
  return importRequest<CollectionImportPreview>(
    token,
    "preview",
    input,
    viewer,
  );
}

export function commitCollectionSource(
  token: string,
  input: CollectionImportRequest,
  viewer?: CollectionsViewerContext | null,
) {
  return importRequest<CollectionImportResult>(
    token,
    "commit",
    input,
    viewer,
  );
}

export async function downloadCollectionImportTemplate(
  token: string,
  viewer?: CollectionsViewerContext | null,
): Promise<Blob> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/import/template`,
    { headers: buildHeaders(token, viewer, false) },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || "Failed to download import template");
  }
  return response.blob();
}

export async function downloadCollectionExport(
  token: string,
  format: "csv" | "json",
  viewer?: CollectionsViewerContext | null,
): Promise<Blob> {
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections/export?format=${format}`,
    { headers: buildHeaders(token, viewer, false) },
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.message || `Failed to export collection as ${format.toUpperCase()}`);
  }
  return response.blob();
}

async function bulkRequest<T>(
  token: string,
  action: "preview" | "commit",
  input: BulkAddRequest,
  viewer?: CollectionsViewerContext | null,
): Promise<T> {
  const suffix = action === "preview" ? "/bulk/preview" : "/bulk";
  const response = await fetch(
    `${getCollectionsBaseUrl()}/collections${suffix}`,
    {
      method: "POST",
      headers: buildHeaders(token, viewer),
      body: JSON.stringify(input),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && !(action === "preview" && response.status === 422)) {
    throw new Error(payload.message || `Failed to ${action} Bulk Add`);
  }
  return payload as T;
}

export function previewBulkAdd(
  token: string,
  input: BulkAddRequest,
  viewer?: CollectionsViewerContext | null,
) {
  return bulkRequest<BulkAddPreview>(token, "preview", input, viewer);
}

export function commitBulkAdd(
  token: string,
  input: BulkAddRequest,
  viewer?: CollectionsViewerContext | null,
) {
  return bulkRequest<BulkAddResult>(token, "commit", input, viewer);
}

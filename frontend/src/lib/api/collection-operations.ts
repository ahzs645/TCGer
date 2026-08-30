import type {
  Card,
  CreateStorageCompartmentInput,
  CreateStorageContainerInput,
  PlaceCollectionEntryInput,
  PsaCertLookupResponse,
  StorageCompartment,
  StorageContainer,
  StoragePlacement,
  PreviewStorageAuditInput,
  StorageAuditPreview,
  StorageAuditResponse,
  TcgCode,
} from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

export type {
  StorageCompartment,
  StorageContainer,
  StoragePlacement,
} from "@tcg/api-types";

export interface UnsortedStorageCopy {
  collectionEntryId: string;
  binderId: string;
  cardId: string;
  name: string;
  printedName?: string;
  setCode?: string;
  collectorNumber?: string;
  imageUrl?: string;
  availableQuantity: number;
}

export interface RapidEntryReceiptLine {
  auditId: string;
  entryId: string;
  rowId: string;
  collectorNumber: string;
  quantity: number;
  card: Card;
}

export interface RapidEntryReceipt {
  receiptId: string;
  addedRows: number;
  addedCopies: number;
  items: Array<Omit<RapidEntryReceiptLine, "card">>;
}

export interface CostSplitResultLine {
  collectionEntryId: string;
  amountCents: number;
  transactionId: string;
  auditId: string;
}

export interface CostSplitResult {
  id: string;
  totalCents: number;
  currency: string;
  lines: CostSplitResultLine[];
}

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(
  token: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...headers(token), ...options.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "Request failed");
  return payload as T;
}

export function getStorageContainers(token: string) {
  return request<StorageContainer[]>(token, "/storage/containers");
}

export function previewStorageAudit(token: string, input: PreviewStorageAuditInput) {
  return request<StorageAuditPreview>(token, "/storage/audits/preview", { method: "POST", body: JSON.stringify(input) });
}

export function commitStorageAudit(token: string, input: PreviewStorageAuditInput) {
  return request<StorageAuditResponse>(token, "/storage/audits", { method: "POST", body: JSON.stringify(input) });
}

export function createStorageContainer(
  token: string,
  input: CreateStorageContainerInput,
) {
  return request<StorageContainer>(token, "/storage/containers", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createStorageCompartment(
  token: string,
  input: CreateStorageCompartmentInput,
) {
  return request<StorageCompartment>(token, "/storage/compartments", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateStorageContainer(
  token: string,
  containerId: string,
  input: { name?: string; order?: number; locked?: boolean },
) {
  return request<StorageContainer>(
    token,
    `/storage/containers/${encodeURIComponent(containerId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function updateStorageCompartment(
  token: string,
  compartmentId: string,
  input: {
    label?: string;
    order?: number;
    pageNumber?: number | null;
    locked?: boolean;
  },
) {
  return request<StorageCompartment>(
    token,
    `/storage/compartments/${encodeURIComponent(compartmentId)}`,
    { method: "PATCH", body: JSON.stringify(input) },
  );
}

export function placeStorageCopy(
  token: string,
  input: PlaceCollectionEntryInput,
) {
  return request<StoragePlacement>(token, "/storage/placements", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function removeStoragePlacement(
  token: string,
  placementId: string,
) {
  const response = await fetch(
    `${API_BASE_URL}/storage/placements/${encodeURIComponent(placementId)}`,
    { method: "DELETE", headers: headers(token) },
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || "Failed to remove storage placement");
  }
}

export function createRapidEntry(
  token: string,
  input: {
    binderId?: string;
    tcg: TcgCode;
    setCode: string;
    entries: Array<{
      rowId: string;
      collectorNumber: string;
      card: Card & { externalId: string };
      quantity?: number;
      condition?: string;
      language?: string;
    }>;
  },
) {
  return request<RapidEntryReceipt>(token, "/collections/rapid-entry", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function splitAcquisitionCost(
  token: string,
  input: {
    totalCents: number;
    currency: string;
    mode: "equal" | "weighted";
    notes?: string;
    lines: Array<{ collectionEntryId: string; weight?: number }>;
  },
) {
  return request<CostSplitResult>(token, "/finance/acquisition-cost-split", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function lookupPsaCertificate(token: string, certNumber: string) {
  return request<PsaCertLookupResponse>(
    token,
    `/grading/psa/certs/${encodeURIComponent(certNumber)}`,
  );
}

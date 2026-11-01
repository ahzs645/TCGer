import { API_BASE_URL } from "./base-url";
import { sessionFetch } from "./session-fetch";

export type {
  InventoryIntakeInput as InventoryIntakeRequest,
  InventoryIntakeReceipt,
} from "@tcg/api-types";
import type {
  InventoryIntakeInput as InventoryIntakeRequest,
  InventoryIntakeReceipt,
} from "@tcg/api-types";

export async function commitInventoryIntake(
  token: string,
  collectionId: string,
  input: InventoryIntakeRequest,
): Promise<InventoryIntakeReceipt> {
  const response = await sessionFetch(
    `${API_BASE_URL}/collections/${encodeURIComponent(collectionId)}/intake`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      payload.message ??
        "The cards could not be saved. Retry this same saved operation.",
    );
  const entryIds = Array.isArray(payload.entryIds)
    ? (payload.entryIds as unknown[])
    : [];
  const rows = Array.isArray(payload.rows)
    ? (payload.rows as Array<{ rowId?: string; entryIds?: unknown[] }>)
    : [];
  const returned = rows.flatMap((row) =>
    Array.isArray(row.entryIds) ? row.entryIds : [],
  );
  if (
    payload.operationId !== input.operationId ||
    rows.length !== input.rows.length ||
    input.rows.some(
      (row) =>
        rows.filter(
          (saved) =>
            saved.rowId === row.rowId &&
            Array.isArray(saved.entryIds) &&
            saved.entryIds.length === (row.quantity ?? 1),
        ).length !== 1,
    ) ||
    entryIds.length !==
      input.rows.reduce((sum, row) => sum + (row.quantity ?? 1), 0) ||
    entryIds.some(
      (id) => typeof id !== "string" || !id || !returned.includes(id),
    ) ||
    new Set(entryIds).size !== entryIds.length ||
    new Set(returned).size !== entryIds.length ||
    (input.sealedInventoryId && typeof payload.openingId !== "string")
  ) {
    throw new Error(
      "The server did not return an intake receipt. Retry this saved operation to recover its result.",
    );
  }
  return payload as InventoryIntakeReceipt;
}

import type { InventorySaleInput, InventorySaleReceipt } from "@tcg/api-types";
import { capturePrivateSession } from "@/lib/private-session";
import { API_BASE_URL } from "@/lib/api/base-url";
import { recordInventorySale } from "@/lib/api/pricing";

export interface SaleDraft {
  input: InventorySaleInput;
  receipt?: InventorySaleReceipt;
}
export const SALE_DRAFT_CHANGED = "tcger:sale-draft-changed";
const notify = () => {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(SALE_DRAFT_CHANGED));
};
function prefix() {
  const session = capturePrivateSession();
  if (!session.user) throw new Error("Sign in to record a sale.");
  return `tcger.sale.v1:${encodeURIComponent(API_BASE_URL)}:${encodeURIComponent(session.user.id)}:`;
}
export function pendingSales(): SaleDraft[] {
  const scope = prefix();
  const result: SaleDraft[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (!key?.startsWith(scope)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const draft = JSON.parse(raw) as SaleDraft;
    if (!draft.input?.operationId || !Array.isArray(draft.input.copyIds))
      throw new Error(
        "A saved sale needs recovery; export browser data before clearing it.",
      );
    if (!draft.receipt) result.push(draft);
  }
  return result;
}
export async function submitDurableSale(
  token: string,
  input: InventorySaleInput,
): Promise<InventorySaleReceipt> {
  const session = capturePrivateSession(token);
  session.assertCurrent();
  const pending = pendingSales().find((sale) =>
    sale.input.copyIds.some((id) => input.copyIds.includes(id)),
  );
  const operation = pending?.input ?? input;
  const key = `${prefix()}${encodeURIComponent(operation.operationId)}`;
  const existing = localStorage.getItem(key);
  const draft: SaleDraft = existing
    ? JSON.parse(existing)
    : { input: operation };
  if (!existing) {
    localStorage.setItem(key, JSON.stringify(draft));
    notify();
  }
  const receipt = await recordInventorySale(token, draft.input);
  session.assertCurrent();
  if (receipt.operationId !== draft.input.operationId)
    throw new Error(
      "The server returned an unexpected receipt. Recover this saved sale before creating another.",
    );
  localStorage.setItem(key, JSON.stringify({ ...draft, receipt }));
  notify();
  return receipt;
}

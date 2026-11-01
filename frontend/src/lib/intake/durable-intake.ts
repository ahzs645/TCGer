import { capturePrivateSession } from "@/lib/private-session";
import { API_BASE_URL } from "@/lib/api/base-url";
import {
  commitInventoryIntake,
  type InventoryIntakeReceipt,
  type InventoryIntakeRequest,
} from "@/lib/api/inventory-intake";

export const INTAKE_CHANGED_EVENT = "tcger:intake-changed";
const notify = () => {
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event(INTAKE_CHANGED_EVENT));
};

export interface IntakeDraft {
  collectionId: string;
  request: InventoryIntakeRequest;
  receipt?: InventoryIntakeReceipt;
}

/** Account and normalized server scope; opaque credentials never enter a key. */
export function intakeStorageKey(key: string): string {
  const session = capturePrivateSession();
  if (!session.user?.id) throw new Error("Sign in before saving an intake.");
  return `tcger.intake.v1:${encodeURIComponent(API_BASE_URL)}:${encodeURIComponent(session.user.id)}:${encodeURIComponent(key)}`;
}

export function loadIntakeDraft(key: string): IntakeDraft | null {
  const raw = localStorage.getItem(intakeStorageKey(key));
  if (!raw) return null;
  const value = JSON.parse(raw) as IntakeDraft;
  if (
    !value.collectionId ||
    !value.request?.operationId ||
    !Array.isArray(value.request.rows)
  ) {
    throw new Error(
      "The saved intake needs recovery. Export browser data before clearing it.",
    );
  }
  return value;
}

/** Freeze the exact payload durably BEFORE any request can commit. */
export function prepareIntakeDraft(
  key: string,
  draft: IntakeDraft,
): IntakeDraft {
  const existing = loadIntakeDraft(key);
  if (existing) return existing;
  const serialized = JSON.stringify(draft);
  localStorage.setItem(intakeStorageKey(key), serialized);
  notify();
  return JSON.parse(serialized) as IntakeDraft;
}

export async function submitIntakeDraft(
  token: string,
  key: string,
  draft: IntakeDraft,
): Promise<InventoryIntakeReceipt> {
  const session = capturePrivateSession(token);
  session.assertCurrent();
  const frozen = prepareIntakeDraft(key, draft);
  // Even a committed operation is replayed to its origin server. A local receipt
  // is useful evidence but does not substitute for the server's durable ledger.
  const receipt = await commitInventoryIntake(
    token,
    frozen.collectionId,
    frozen.request,
  );
  session.assertCurrent();
  localStorage.setItem(
    intakeStorageKey(key),
    JSON.stringify({ ...frozen, receipt }),
  );
  notify();
  return receipt;
}

/** Called only after the scanner's reviewed rows are durably checkpointed. */
export function finishIntakeDraft(key: string): void {
  localStorage.removeItem(intakeStorageKey(key));
  notify();
}

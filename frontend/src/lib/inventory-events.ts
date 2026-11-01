import type { PrivateSession } from "@/lib/private-session";

let revision = 0;
const listeners = new Set<() => void>();
export const inventoryRevision = () => revision;
export function subscribeInventoryChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** One commit publication invalidates every dependent view in this session. */
export function publishInventoryChange(session: PrivateSession): void {
  if (!session.current()) return;
  revision += 1;
  for (const listener of [...listeners]) listener();
}

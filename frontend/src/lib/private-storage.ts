import { API_BASE_URL } from "@/lib/api/base-url";
import { useAuthStore } from "@/stores/auth";

/** Device persistence for private drafts must use the same server/account scope as requests. */
export function privateStorageKey(
  prefix: string,
  userId = useAuthStore.getState().user?.id ?? "local",
) {
  return `${prefix.replace(/:$/, "")}:${encodeURIComponent(API_BASE_URL)}:${encodeURIComponent(userId)}`;
}

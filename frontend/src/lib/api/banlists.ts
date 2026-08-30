import type {
  YugiohBanlistFormat,
  YugiohBanlistSnapshot,
  YugiohBanlistSyncResult,
} from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? "Banlist request failed");
  }
  return response.json() as Promise<T>;
}

export async function getCurrentYugiohBanlist(
  token: string,
  format: YugiohBanlistFormat = "tcg",
): Promise<YugiohBanlistSnapshot | null> {
  return json(await fetch(
    `${API_BASE_URL}/banlists/current?format=${encodeURIComponent(format)}`,
    { headers: { Authorization: `Bearer ${token}` }, credentials: "include" },
  ));
}

export async function synchronizeYugiohBanlists(
  token: string,
): Promise<YugiohBanlistSyncResult> {
  return json(await fetch(`${API_BASE_URL}/banlists/sync`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
  }));
}

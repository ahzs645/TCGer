import type { NotificationResponse } from "@tcg/api-types";

import { API_BASE_URL } from "./base-url";

async function notificationFetch<T>(
  path: string,
  token: string | null,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : response.statusText;
    throw new Error(message || "Could not load activity.");
  }
  return response.json() as Promise<T>;
}

export function getNotifications(
  token: string | null,
): Promise<NotificationResponse[]> {
  return notificationFetch("/notifications", token);
}

export function markNotificationRead(
  token: string | null,
  notificationID: string,
): Promise<NotificationResponse> {
  return notificationFetch(
    `/notifications/${encodeURIComponent(notificationID)}/read`,
    token,
    {
      method: "PATCH",
    },
  );
}

export function markAllNotificationsRead(
  token: string | null,
): Promise<{ success: boolean }> {
  return notificationFetch("/notifications/read-all", token, {
    method: "POST",
  });
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "./notifications";

test("notification API uses authenticated list and mutation routes", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json(
      String(input).endsWith("/read-all")
        ? { success: true }
        : String(input).includes("/read")
          ? {
              id: "notice/1",
              type: "trade",
              title: "Trade",
              body: "Updated",
              read: true,
              createdAt: "2026-08-26T00:00:00.000Z",
            }
          : [],
    );
  };

  try {
    await getNotifications("token");
    await markNotificationRead("token", "notice/1");
    await markAllNotificationsRead("token");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 3);
  assert.equal(requests[0]?.init?.credentials, "include");
  assert.equal(
    new Headers(requests[0]?.init?.headers).get("Authorization"),
    "Bearer token",
  );
  assert.match(requests[1]?.url ?? "", /notice%2F1\/read$/);
  assert.equal(requests[1]?.init?.method, "PATCH");
  assert.equal(requests[2]?.init?.method, "POST");
});

test("notification API surfaces backend messages", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({ message: "Notifications unavailable" }, { status: 501 });
  try {
    await assert.rejects(
      () => getNotifications(null),
      /Notifications unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

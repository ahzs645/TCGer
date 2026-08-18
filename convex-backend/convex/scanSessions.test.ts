import { describe, expect, test } from "vitest";

import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

function headers(subject: string) {
  return {
    Authorization: "Bearer local-test-token",
    "Content-Type": "application/json",
    "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
    "x-tcger-user-id": subject,
    "x-tcger-user-email": `${subject}@example.com`,
  };
}

describe("shared scan sessions", () => {
  test("deduplicates phone events and commits copy metadata to a binder", async () => {
    const t = createTestConvex();
    const ownerHeaders = headers("scan_session_owner");
    const sessionResponse = await t.fetch("/scan-sessions", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ defaultLanguage: "Japanese" }),
    });
    expect(sessionResponse.status).toBe(201);
    const session = await sessionResponse.json();

    const itemPayload = {
      code: session.code,
      clientEventId: "ios-event-1",
      tcg: "pokemon",
      externalId: "sv3-125",
      name: "Pikachu",
      setCode: "SV3",
      confidence: 0.96,
      finishCode: "reverse",
      finishLabel: "Reverse Holo",
    };
    expect((await t.fetch("/scan-sessions/items", {
      method: "POST", headers: ownerHeaders, body: JSON.stringify(itemPayload),
    })).status).toBe(201);
    expect((await t.fetch("/scan-sessions/items", {
      method: "POST", headers: ownerHeaders, body: JSON.stringify(itemPayload),
    })).status).toBe(201);

    const items = await (await t.fetch(`/scan-sessions/${session.id}/items`, { headers: ownerHeaders })).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ language: "Japanese", finishCode: "reverse" });

    const binderResponse = await t.fetch("/collections", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ name: "Phone scans" }),
    });
    expect(binderResponse.status).toBe(201);
    const binder = await binderResponse.json();

    const commitResponse = await t.fetch(`/scan-sessions/${session.id}/commit`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ binderId: binder.id }),
    });
    expect(commitResponse.status).toBe(200);
    expect(await commitResponse.json()).toEqual({ committed: 1 });

    const binderDetail = await (await t.fetch(`/collections/${binder.id}`, { headers: ownerHeaders })).json();
    expect(binderDetail.cards[0]).toMatchObject({
      name: "Pikachu",
      language: "Japanese",
    });
    expect(binderDetail.cards[0].copies[0]).toMatchObject({ finishCode: "reverse" });
  });

  test("does not expose a session code to another account", async () => {
    const t = createTestConvex();
    const session = await (await t.fetch("/scan-sessions", {
      method: "POST",
      headers: headers("scan_session_owner"),
      body: JSON.stringify({}),
    })).json();
    const response = await t.fetch(`/scan-sessions/active?code=${session.code}`, {
      headers: headers("scan_session_other"),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });
});

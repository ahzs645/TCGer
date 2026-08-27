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
    expect(
      (
        await t.fetch("/scan-sessions/items", {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify(itemPayload),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await t.fetch("/scan-sessions/items", {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify(itemPayload),
        })
      ).status,
    ).toBe(201);

    const items = await (
      await t.fetch(`/scan-sessions/${session.id}/items`, {
        headers: ownerHeaders,
      })
    ).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      language: "Japanese",
      finishCode: "reverse",
    });

    const binderResponse = await t.fetch("/collections", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ name: "Phone scans" }),
    });
    expect(binderResponse.status).toBe(201);
    const binder = await binderResponse.json();

    const commitResponse = await t.fetch(
      `/scan-sessions/${session.id}/commit`,
      {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ binderId: binder.id }),
      },
    );
    expect(commitResponse.status).toBe(200);
    expect(await commitResponse.json()).toEqual({ committed: 1 });
    const committedSession = await (
      await t.fetch(`/scan-sessions/${session.id}`, { headers: ownerHeaders })
    ).json();
    expect(committedSession.status).toBe("committed");

    const binderDetail = await (
      await t.fetch(`/collections/${binder.id}`, { headers: ownerHeaders })
    ).json();
    expect(binderDetail.cards[0]).toMatchObject({
      name: "Pikachu",
      language: "Japanese",
    });
    expect(binderDetail.cards[0].copies[0]).toMatchObject({
      finishCode: "reverse",
    });
  });

  test("does not expose a session code to another account", async () => {
    const t = createTestConvex();
    const session = await (
      await t.fetch("/scan-sessions", {
        method: "POST",
        headers: headers("scan_session_owner"),
        body: JSON.stringify({}),
      })
    ).json();
    const response = await t.fetch(
      `/scan-sessions/active?code=${session.code}`,
      {
        headers: headers("scan_session_other"),
      },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  test("rejects a foreign binder before a no-op commit and leaves the session unchanged", async () => {
    const t = createTestConvex();
    const ownerHeaders = headers("scan_session_binder_owner");
    const otherHeaders = headers("scan_session_binder_other");
    const session = await (
      await t.fetch("/scan-sessions", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({}),
      })
    ).json();
    const foreignBinder = await (
      await t.fetch("/collections", {
        method: "POST",
        headers: otherHeaders,
        body: JSON.stringify({ name: "Other account" }),
      })
    ).json();

    const commit = await t.fetch(`/scan-sessions/${session.id}/commit`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ binderId: foreignBinder.id }),
    });
    expect(commit.status).toBe(404);

    const unchanged = await (
      await t.fetch(`/scan-sessions/${session.id}`, { headers: ownerHeaders })
    ).json();
    expect(unchanged.status).toBe("open");
    expect(unchanged).not.toHaveProperty("binderId");
  });

  test("reviews a session by removing, clearing, and committing only selected items", async () => {
    const t = createTestConvex();
    const ownerHeaders = headers("scan_session_reviewer");
    const session = await (
      await t.fetch("/scan-sessions", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ defaultLanguage: "French" }),
      })
    ).json();
    const add = async (
      clientEventId: string,
      externalId: string,
      name: string,
    ) =>
      await (
        await t.fetch("/scan-sessions/items", {
          method: "POST",
          headers: ownerHeaders,
          body: JSON.stringify({
            code: session.code,
            clientEventId,
            tcg: "pokemon",
            externalId,
            name,
          }),
        })
      ).json();
    const first = await add("review-1", "sv3-125", "Pikachu");
    const second = await add("review-2", "sv4-81", "Magneton");
    await add("review-3", "sv5-42", "Gengar");

    const unauthorizedRemove = await t.fetch(
      `/scan-sessions/items/${second.id}`,
      {
        method: "DELETE",
        headers: headers("scan_session_intruder"),
      },
    );
    expect(unauthorizedRemove.status).toBe(404);

    const removeResponse = await t.fetch(`/scan-sessions/items/${second.id}`, {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(removeResponse.status).toBe(200);
    expect(await removeResponse.json()).toEqual({ removed: true });

    const binder = await (
      await t.fetch("/collections", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ name: "Reviewed scans" }),
      })
    ).json();
    const commitResponse = await t.fetch(
      `/scan-sessions/${session.id}/commit`,
      {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({ binderId: binder.id, itemIds: [first.id] }),
      },
    );
    expect(commitResponse.status).toBe(200);
    expect(await commitResponse.json()).toEqual({ committed: 1 });
    const openSession = await (
      await t.fetch(`/scan-sessions/${session.id}`, { headers: ownerHeaders })
    ).json();
    expect(openSession.status).toBe("open");

    const afterCommit = await (
      await t.fetch(`/scan-sessions/${session.id}/items`, {
        headers: ownerHeaders,
      })
    ).json();
    expect(afterCommit).toHaveLength(2);
    expect(
      afterCommit.find((item: { id: string }) => item.id === first.id)
        .committedEntryId,
    ).toBeTruthy();

    const clearResponse = await t.fetch(`/scan-sessions/${session.id}/items`, {
      method: "DELETE",
      headers: ownerHeaders,
    });
    expect(clearResponse.status).toBe(200);
    expect(await clearResponse.json()).toEqual({ removed: 1 });

    const remaining = await (
      await t.fetch(`/scan-sessions/${session.id}/items`, {
        headers: ownerHeaders,
      })
    ).json();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(first.id);
  });

  test("clears finish metadata and rejects edits after a session closes", async () => {
    const t = createTestConvex();
    const ownerHeaders = headers("scan_session_editor");
    const session = await (
      await t.fetch("/scan-sessions", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({}),
      })
    ).json();
    const item = await (
      await t.fetch("/scan-sessions/items", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({
          code: session.code,
          clientEventId: "editable-1",
          tcg: "pokemon",
          externalId: "sv3-125",
          name: "Pikachu",
          finishCode: "reverse",
          finishLabel: "Reverse Holo",
        }),
      })
    ).json();

    const clearFinish = await t.fetch(`/scan-sessions/items/${item.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({
        language: "English",
        finishCode: null,
        finishLabel: null,
      }),
    });
    expect(clearFinish.status).toBe(200);
    expect(await clearFinish.json()).not.toHaveProperty("finishCode");

    await t.run(async (ctx) => {
      await ctx.db.patch(session.id, { status: "closed" });
    });
    const closedEdit = await t.fetch(`/scan-sessions/items/${item.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ language: "Japanese" }),
    });
    expect(closedEdit.status).toBe(400);
  });

  test("rejects malformed optional fields instead of silently omitting them", async () => {
    const t = createTestConvex();
    const ownerHeaders = headers("scan_session_validation");
    const session = await (
      await t.fetch("/scan-sessions", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({}),
      })
    ).json();

    const invalidAdd = await t.fetch("/scan-sessions/items", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        code: session.code,
        clientEventId: "invalid-1",
        tcg: "pokemon",
        externalId: "sv3-125",
        name: "Pikachu",
        language: 42,
      }),
    });
    expect(invalidAdd.status).toBe(400);
  });

  test("enforces the bounded session size before inserting another item", async () => {
    const t = createTestConvex();
    const ownerHeaders = headers("scan_session_limit");
    const session = await (
      await t.fetch("/scan-sessions", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({}),
      })
    ).json();

    await t.run(async (ctx) => {
      const viewer = await ctx.db
        .query("users")
        .withIndex("by_auth_subject", (q) =>
          q.eq("authSubject", "scan_session_limit"),
        )
        .unique();
      if (!viewer) throw new Error("missing test viewer");
      const timestamp = Date.now();
      for (let index = 0; index < 500; index += 1) {
        await ctx.db.insert("scanSessionItems", {
          userId: viewer._id,
          sessionId: session.id,
          clientEventId: `limit-${index}`,
          tcg: "pokemon",
          externalId: `card-${index}`,
          name: `Card ${index}`,
          language: "English",
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    });

    const overflow = await t.fetch("/scan-sessions/items", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        code: session.code,
        clientEventId: "limit-overflow",
        tcg: "pokemon",
        externalId: "overflow",
        name: "Overflow",
      }),
    });
    expect(overflow.status).toBe(400);
  });
});

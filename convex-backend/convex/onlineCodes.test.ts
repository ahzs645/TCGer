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

describe("online code vault", () => {
  test("stores, filters, updates, and deletes codes across games", async () => {
    const t = createTestConvex();
    const requestHeaders = headers("online_code_owner");

    const createResponse = await t.fetch("/online-codes/bulk", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        tcg: "pokemon",
        source: "camera",
        productName: "Destined Rivals booster box",
        codes: [
          { code: "ABCD-1234" },
          { code: " abcd-1234 " },
          { code: "WXYZ-9876" },
        ],
      }),
    });
    expect(createResponse.status).toBe(201);
    const result = await createResponse.json();
    expect(result).toMatchObject({ created: 2, duplicates: 1 });
    expect(result.items[0]).toMatchObject({
      tcg: "pokemon",
      status: "unused",
      source: "camera",
      productName: "Destined Rivals booster box",
    });

    const magicResponse = await t.fetch("/online-codes/bulk", {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify({
        tcg: "magic",
        source: "camera",
        productName: "Prerelease reward",
        codes: [{ code: "ABCDE-12345-FGHIJ-67890-KLMNO" }],
      }),
    });
    expect(magicResponse.status).toBe(201);
    expect(await magicResponse.json()).toMatchObject({
      created: 1,
      items: [{ tcg: "magic", status: "unused" }],
    });

    expect(
      await (await t.fetch("/online-codes", { headers: requestHeaders })).json(),
    ).toHaveLength(3);
    expect(
      await (
        await t.fetch("/online-codes?tcg=magic", { headers: requestHeaders })
      ).json(),
    ).toHaveLength(1);

    const first = result.items[0];
    const updateResponse = await t.fetch(`/online-codes/${first.id}`, {
      method: "PATCH",
      headers: requestHeaders,
      body: JSON.stringify({
        status: "redeemed",
        notes: "Redeemed in Pokémon TCG Live",
      }),
    });
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({
      id: first.id,
      status: "redeemed",
      notes: "Redeemed in Pokémon TCG Live",
    });

    const redeemedResponse = await t.fetch(
      "/online-codes?tcg=pokemon&status=redeemed",
      { headers: requestHeaders },
    );
    expect(redeemedResponse.status).toBe(200);
    expect(await redeemedResponse.json()).toHaveLength(1);

    expect(
      (
        await t.fetch(`/online-codes/${first.id}`, {
          method: "DELETE",
          headers: requestHeaders,
        })
      ).status,
    ).toBe(204);
    expect(
      await (
        await t.fetch("/online-codes?tcg=pokemon", { headers: requestHeaders })
      ).json(),
    ).toHaveLength(1);
  });

  test("does not expose codes across users", async () => {
    const t = createTestConvex();
    const ownerHeaders = headers("online_code_owner");
    const otherHeaders = headers("online_code_other");
    const created = await (
      await t.fetch("/online-codes/bulk", {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({
          tcg: "pokemon",
          source: "manual",
          codes: [{ code: "PRIVATE-1234" }],
        }),
      })
    ).json();

    const foreignUpdate = await t.fetch(
      `/online-codes/${created.items[0].id}`,
      {
        method: "PATCH",
        headers: otherHeaders,
        body: JSON.stringify({ status: "redeemed" }),
      },
    );
    expect(foreignUpdate.status).toBe(404);
    expect(
      await (
        await t.fetch("/online-codes?tcg=pokemon", { headers: otherHeaders })
      ).json(),
    ).toEqual([]);
  });
});

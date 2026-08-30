import { describe, expect, test } from "vitest";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

function bridgeHeaders(subject: string) {
  return {
    Authorization: "Bearer local-test-token",
    "Content-Type": "application/json",
    "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
    "x-tcger-user-id": subject,
    "x-tcger-user-email": `${subject}@example.com`,
  };
}

describe("provider cache, pricing history, alerts and automations", () => {
  test("persists normalized provider data and exposes Convex-mode operations", async () => {
    const t = createTestConvex();
    const headers = bridgeHeaders("pricing-user");
    const now = Date.now();

    const psa = {
      providerResponseHash: "a".repeat(64),
      retrievedAt: new Date(now).toISOString(),
      refreshAfter: new Date(now + 86_400_000).toISOString(),
      grade: 10,
      gradeLabel: "GEM MT 10",
      subject: "PIKACHU-HOLO",
      searchableName: "PIKACHU",
      cardNumber: "58",
    };
    expect(
      (
        await t.fetch("/provider-cache/psa/12345678", {
          method: "PUT",
          headers,
          body: JSON.stringify(psa),
        })
      ).status,
    ).toBe(200);
    const cached = await (
      await t.fetch("/provider-cache/psa/12345678", { headers })
    ).json();
    expect(cached).toMatchObject({
      certNumber: "12345678",
      grader: "PSA",
      grade: 10,
      cached: true,
    });

    for (const [capturedAt, nativePrice] of [
      [now - 2 * 86_400_000, 10],
      [now, 15],
    ] as const) {
      expect(
        (
          await t.fetch("/prices/snapshots", {
            method: "POST",
            headers,
            body: JSON.stringify({
              snapshots: [
                {
                  tcg: "pokemon",
                  externalId: "sv1-58",
                  source: "tcgcsv",
                  capturedAt,
                  nativePrice,
                  nativeCurrency: "USD",
                  matchMethod: "exact-set-number",
                  matchConfidence: 1,
                },
              ],
            }),
          })
        ).status,
      ).toBe(200);
    }
    const movers = await (
      await t.fetch("/prices/analytics/movers?period=7", { headers })
    ).json();
    expect(movers.gainers[0]).toMatchObject({
      externalId: "sv1-58",
      priceChange: 5,
      percentChange: 50,
      currentPrice: 15,
    });

    const alertResponse = await t.fetch("/alerts", {
      method: "POST",
      headers,
      body: JSON.stringify({
        externalId: "sv1-58",
        tcg: "pokemon",
        cardName: "Pikachu",
        targetPrice: 12,
        direction: "below",
      }),
    });
    expect(alertResponse.status).toBe(201);
    const alert = await alertResponse.json();
    expect(alert).toMatchObject({
      cardName: "Pikachu",
      targetPrice: 12,
      isActive: true,
    });

    const automationResponse = await t.fetch("/automations", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Watch Pikachu",
        trigger: "price_change",
        action: "notify",
        config: { alertId: alert.id },
      }),
    });
    expect(automationResponse.status).toBe(201);
    const automation = await automationResponse.json();
    expect(automation).toMatchObject({
      trigger: "price_change",
      action: "notify",
      enabled: true,
    });
    expect(await (await t.fetch("/alerts", { headers })).json()).toHaveLength(
      1,
    );
    expect(
      await (await t.fetch("/automations", { headers })).json(),
    ).toHaveLength(1);
  });
});

import { describe, expect, test } from "vitest";

import {
  attachExternalIds,
  latestOfficialListUrl,
  normalizeYugiohName,
  parseOfficialTcgBanlist,
} from "./lib/yugiohBanlist";

describe("Yu-Gi-Oh banlist synchronization parsing", () => {
  test("parses independent Advanced and Traditional limits", () => {
    const html = `
      <table><tr><th>Type</th><th>Card Name</th><th>Advanced</th><th>Traditional</th><th>Remarks</th></tr>
      <tr><td>Monster</td><td>Archnemeses Protos</td><td>Forbidden</td><td>Limited</td><td>Updated</td></tr>
      <tr><td>Spell</td><td>Called by the Grave</td><td>Limited</td><td>Semi-Limited</td><td></td></tr></table>`;
    const parsed = parseOfficialTcgBanlist(html);

    expect(parsed.advanced).toMatchObject([
      { cardName: "Archnemeses Protos", status: "forbidden", limit: 0, remarks: "Updated" },
      { cardName: "Called by the Grave", status: "limited", limit: 1 },
    ]);
    expect(parsed.traditional).toMatchObject([
      { cardName: "Archnemeses Protos", status: "limited", limit: 1 },
      { cardName: "Called by the Grave", status: "semi-limited", limit: 2 },
    ]);
  });

  test("chooses the newest official dated list and attaches stable card ids", () => {
    const latest = latestOfficialListUrl(
      `<a href="list_2026-02-02/">old</a><a href="/en/limited/list_2026-05-18/">new</a>`,
      "https://www.yugioh-card.com/en/limited/",
    );
    expect(latest).toEqual({
      date: "2026-05-18",
      url: "https://www.yugioh-card.com/en/limited/list_2026-05-18/",
    });

    const entries = parseOfficialTcgBanlist(
      `<tr><td>Monster</td><td>Dark Magician</td><td>Limited</td><td>Limited</td></tr>`,
    ).advanced;
    expect(attachExternalIds(entries, new Map([[normalizeYugiohName("Dark Magician"), "46986414"]]))[0])
      .toMatchObject({ externalId: "46986414", cardName: "Dark Magician" });
  });
});

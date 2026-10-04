import { afterEach, expect, test, vi } from "vitest";
import contracts from "../../../../mobile-parity/api-contracts/interactions.json";
import { assertRequest, assertResponse } from "../../../../tools/api-contracts/match.mjs";

vi.mock("./base-url", () => ({ API_BASE_URL: "https://contract.test" }));
vi.mock("@/lib/game-packages/game-package-client", () => ({ installedCardPrints: vi.fn() }));
import { createCollection, getCollections, updateCollection, deleteCollection, addCardToCollection, updateCollectionCard, removeCardFromCollection } from "./collections";
import { createSealedOpening } from "./sealed";
import { importServerBackup } from "./backups";
import { searchAllCards } from "./cards";
import { searchCardsApi } from "../api-client";

afterEach(() => vi.unstubAllGlobals());

for (const interaction of contracts.interactions as any[]) {
  test(`[api:${interaction.id}] web consumer`, async () => {
    let requests = 0;
    vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
      requests++;
      assertRequest(interaction, url, options);
      // Extra fields must remain backwards compatible with the real client.
      const body = structuredClone(interaction.response.body);
      if (body && !Array.isArray(body)) Object.assign(body, { futureServerField: true });
      return new Response(interaction.response.status === 204 ? null : JSON.stringify(body), { status: interaction.response.status });
    });
    const token = interaction.request.headers.Authorization.replace("Bearer ", "");
    let invoke: () => Promise<unknown>;
    switch (interaction.operation) {
      case "listBinders": invoke = () => getCollections(token); break;
      case "createBinder": invoke = () => createCollection(token, interaction.request.body!); break;
      case "updateBinder": invoke = () => updateCollection(token, "contract-binder", interaction.request.body); break;
      case "deleteBinder": invoke = () => deleteCollection(token, "contract-binder"); break;
      case "addCopy": invoke = () => addCardToCollection(token, "contract-binder", interaction.request.body); break;
      case "updateCopy": invoke = () => updateCollectionCard(token, "contract-binder", "contract-copy", interaction.request.body); break;
      case "removeCopy": invoke = () => removeCardFromCollection(token, "contract-binder", "contract-copy"); break;
      case "openSealed": invoke = () => createSealedOpening(token, "contract-inventory", interaction.request.body); break;
      case "importBackup": invoke = () => importServerBackup(token, interaction.request.body); break;
      case "searchCards": invoke = () => searchAllCards(token, { query: interaction.request.query!.query, tcg: "pokemon", unique: "prints", limit: 1000 }); break;
      default: throw new Error(`Uncovered web operation: ${interaction.operation}`);
    }
    if (interaction.response.status >= 400) await expect(invoke()).rejects.toThrow();
    else {
      const result = await invoke();
      if (!["deleteBinder", "addCopy", "removeCopy"].includes(interaction.operation)) assertResponse(result, interaction.operation === "searchCards" ? interaction.response.body.cards : interaction.response.body);
    }
    expect(requests).toBe(1);
    // The separate scanner/search helper must obey the same exhaustive search contract.
    if (interaction.operation === "searchCards") {
      const call = searchCardsApi({ token, query: interaction.request.query!.query, tcg: "pokemon" });
      if (interaction.response.status >= 400) await expect(call).rejects.toThrow();
      else expect(await call).toEqual(interaction.response.body.cards);
      expect(requests).toBe(2);
    }
  });
}

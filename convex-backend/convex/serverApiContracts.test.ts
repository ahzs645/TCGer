import { describe, expect, test } from "vitest";
import contracts from "../../mobile-parity/api-contracts/interactions.json";
import { assertResponse } from "../../tools/api-contracts/match.mjs";
import { createTestConvex, TEST_BRIDGE_SECRET } from "./test.setup";

const headers = (subject: string) => ({
  "Content-Type": "application/json",
  Authorization: "Bearer contract-test-bridge",
  "x-tcger-bridge-key": TEST_BRIDGE_SECRET,
  "x-tcger-user-id": subject,
});
const createInput = contracts.interactions.find(item => item.id === "collections.create.success")!.request.body!;

describe("shared REST interactions against real Convex HTTP actions", () => {
  for (const interaction of contracts.interactions.filter(item => item.providers.includes("convex")) as any[]) {
    test(`[api:${interaction.id}] convex provider`, async () => {
      const t = createTestConvex();
      // A different user's binder must never leak into this response.
      const other = await t.fetch("/collections", { method: "POST", headers: headers("other-user"), body: JSON.stringify({ name: "Private other binder" }) });
      expect(other.status).toBe(201);
      let actualPath = interaction.request.path;
      const actualBody = structuredClone(interaction.request.body);
      let targetCopy: string | undefined;
      let siblingCopy: string | undefined;
      let inventoryID: string | undefined;
      let targetID = (await other.json()).id;
      if (["binder", "copies", "foreign-copy"].includes(interaction.state)) {
        const created = await t.fetch("/collections", { method: "POST", headers: headers("contract-user"), body: JSON.stringify(createInput) });
        expect(created.status).toBe(201);
        targetID = (await created.json()).id;
      }
      if (["copies", "foreign-copy"].includes(interaction.state)) {
        const owner = interaction.state === "foreign-copy" ? "other-user" : "contract-user";
        const seedBinder = owner === "other-user" ? (await (await t.fetch("/collections", {headers: headers(owner)})).json()).find((b: any) => b.name === "Private other binder").id : targetID;
        const seed = structuredClone(contracts.interactions.find(item => item.id === "collections.copyAdd.success")!.request.body);
        seed.quantity = 2;
        Object.assign(seed, {"acquiredAt": "2026-10-03T12:00:00.000Z", "gradingCompany": "PSA", "gradingScore": "9", "certNumber": "CERT-123", "storageLocation": "Box A"});
        const created = await t.fetch(`/collections/${seedBinder}/cards`, {method: "POST", headers: headers(owner), body: JSON.stringify(seed)});
        expect(created.status).toBe(201);
        const result = await created.json();
        targetCopy = result.copies[0].id;
        siblingCopy = result.copies[1].id;
        actualPath = actualPath.replace("contract-copy", targetCopy!);
      }
      if (["inventory", "foreign-inventory", "inventory-foreign-copy"].includes(interaction.state)) {
        const owner = interaction.state === "foreign-inventory" ? "other-user" : "contract-user";
        const products = await (await t.fetch("/sealed/products", {headers: headers(owner)})).json();
        const inventory = await t.fetch("/sealed/inventory", {method: "POST", headers: headers(owner), body: JSON.stringify({productId: products[0].id, quantity: 2, purchasePrice: 10})});
        expect(inventory.status).toBe(201);
        inventoryID = (await inventory.json()).id;
        actualPath = actualPath.replace("contract-inventory", inventoryID!);
      }
      if (interaction.operation === "openSealed" && actualBody.collectionIds.length) {
        const owner = interaction.state === "inventory-foreign-copy" ? "other-user" : "contract-user";
        const created = await t.fetch("/collections", {method: "POST", headers: headers(owner), body: JSON.stringify({name: "Opening cards"})});
        const binder = await created.json();
        const copy = await t.fetch(`/collections/${binder.id}/cards`, {method: "POST", headers: headers(owner), body: JSON.stringify(contracts.interactions.find(item => item.id === "collections.copyAdd.success")!.request.body)});
        expect(copy.status).toBe(201);
        targetCopy = (await copy.json()).copies[0].id;
        actualBody.collectionIds = [targetCopy];
      }
      const auth = interaction.request.headers.Authorization.includes("expired-")
        ? { "x-tcger-bridge-key": TEST_BRIDGE_SECRET, "Content-Type": "application/json" }
        : headers("contract-user");
      if (actualPath.includes("contract-binder")) actualPath = actualPath.replace("contract-binder", targetID);
      const response = await t.fetch(actualPath, {
        method: interaction.request.method,
        headers: auth,
        body: actualBody === undefined ? undefined : JSON.stringify(actualBody),
      });
      expect(response.status).toBe(interaction.response.status);
      if (response.status !== 204) expect(response.headers.get("content-type")).toContain("application/json");
      assertResponse(response.status === 204 ? null : await response.json(), interaction.response.body, interaction.response.matchers);
      if (["addCopy", "updateCopy", "removeCopy"].includes(interaction.operation)) {
        const persisted = await (await t.fetch(`/collections/${targetID}`, {headers: headers(interaction.state === "foreign" ? "other-user" : "contract-user")})).json();
        const copies = persisted.cards.flatMap((card: any) => card.copies);
        if (interaction.response.status >= 400) {
          expect(copies).toHaveLength(interaction.state === "copies" ? 2 : 0);
        } else if (interaction.operation === "addCopy") {
          expect(copies).toHaveLength(1);
          expect(copies[0].acquisitionPrice).toBe(actualBody.acquisitionPrice);
        } else {
          if (interaction.operation === "removeCopy") { expect(copies).toHaveLength(0); }
          else {
            expect(copies.some((copy: any) => copy.id === siblingCopy && copy.condition === "NM" && copy.acquisitionPrice === 3.5 && copy.storageLocation === "Box A" && copy.certNumber === "CERT-123")).toBe(true);
            if (interaction.id.endsWith("move")) {
              expect(copies).toHaveLength(1);
              const library = await (await t.fetch("/collections/__library__", {headers: headers("contract-user")})).json();
              const moved = library.cards.flatMap((card: any) => card.copies);
              expect(moved).toHaveLength(1);
              expect(moved[0]).toMatchObject({id: targetCopy, condition: "NM", acquisitionPrice: 3.5});
              return;
            }
            expect(copies).toHaveLength(2);
            const changed = copies.find((copy: any) => copy.id === targetCopy);
            if (interaction.id.endsWith("clear")) {
              for (const key of Object.keys(actualBody)) expect(changed[key]).toBeUndefined();
            } else { expect(changed.condition).toBe("LP"); expect(changed.notes).toBe("Reviewed copy"); expect(changed.acquisitionPrice).toBe(3.5); expect(changed).toMatchObject({"acquiredAt": "2026-10-03T12:00:00.000Z", "gradingCompany": "PSA", "gradingScore": "9", "certNumber": "CERT-123", "storageLocation": "Box A"}); }
          }
        }
        if (interaction.state === "foreign-copy") {
          const foreign = await (await t.fetch("/collections", {headers: headers("other-user")})).json();
          expect(foreign.flatMap((b: any) => b.cards.flatMap((card: any) => card.copies))).toHaveLength(2);
        }
      }
      if (interaction.operation === "openSealed") {
        const owner = interaction.state === "foreign-inventory" ? "other-user" : "contract-user";
        const inventories = await (await t.fetch("/sealed/inventory", {headers: headers(owner)})).json();
        expect(inventories.find((item: any) => item.id === inventoryID).quantity).toBe(interaction.response.status === 201 ? 1 : 2);
        const ledgers = await (await t.fetch("/sealed/openings", {headers: headers(owner)})).json();
        expect(ledgers).toHaveLength(interaction.response.status === 201 ? 1 : 0);
        if (ledgers.length) { expect(ledgers[0].openedQuantity).toBe(1); expect(ledgers[0].invested).toBe(10); expect(ledgers[0].activeCopies).toBe(actualBody.collectionIds.length); if (targetCopy) expect(ledgers[0].cards[0].collectionId).toBe(targetCopy); }
      }
      if (interaction.operation === "updateBinder" && interaction.response.status === 200) {
        const persisted = await (await t.fetch("/collections", { headers: headers("contract-user") })).json();
        assertResponse(persisted.find((item: any) => item.id === targetID), interaction.response.body, interaction.response.matchers);
      }
      if (interaction.operation === "deleteBinder" && interaction.response.status === 204) {
        const persisted = await (await t.fetch("/collections", {headers: headers("contract-user")})).json();
        expect(persisted.some((item: any) => item.id === targetID)).toBe(false);
      }
      if (interaction.state === "foreign") {
        const otherState = await (await t.fetch("/collections", {headers: headers("other-user")})).json();
        expect(otherState.find((item: any) => item.id === targetID)?.name).toBe("Private other binder");
      }
      if (interaction.operation === "importBackup" && interaction.response.status === 200) {
        const repeat = await t.fetch("/backups", {method: "POST", headers: headers("contract-user"), body: JSON.stringify(interaction.request.body)});
        expect(repeat.status).toBe(200);
        const exported = await (await t.fetch("/backups", {headers: headers("contract-user")})).json();
        expect(exported.binders.filter((item: any) => item.name === "Imported Contract Binder")).toHaveLength(1);
        expect(exported.sections.futureFeature).toEqual({retained: true});
      }
      if (interaction.operation === "createBinder" && interaction.response.status === 201) {
        const persisted = await (await t.fetch("/collections", { headers: headers("contract-user") })).json();
        expect(persisted).toHaveLength(2);
        assertResponse(persisted[1], interaction.response.body, interaction.response.matchers);
      }
    });
  }
});

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type {
  InventoryIntakeInput,
  InventoryIntakeReceipt,
} from "@tcg/api-types";
import type {
  DemoPersistence,
  PersistedDemoState,
} from "@/lib/storage/demo-persistence";
import {
  setDemoPersistence,
  useDemoStore,
  whenDemoStoreHydrated,
} from "@/stores/demo-store";
import { demoAtomicIntake, demoRemovePhysicalCopy } from "./demo-inventory";
import {
  exportLocalBackup,
  importLocalBackup,
} from "@/lib/storage/portable-backup";
let disk: Partial<PersistedDemoState> | null;
let fail: boolean;
let persistence: DemoPersistence;
beforeEach(async () => {
  disk = null;
  fail = false;
  persistence = {
    whenHydrated: async () => undefined,
    snapshot: () => disk,
    commit: (patch) => {
      disk = { ...disk, ...structuredClone(patch) };
    },
    clear: async () => {
      disk = null;
    },
    commitDurably: async (patch) => {
      if (fail) throw new Error("Injected durable failure");
      disk = { ...disk, ...structuredClone(patch) };
    },
  };
  setDemoPersistence(persistence);
  await whenDemoStoreHydrated();
  useDemoStore.getState().init();
});
function request(): InventoryIntakeInput {
  return {
    operationId: "demo-operation-1",
    source: "scanner",
    rows: [
      {
        rowId: "physical-row",
        cardId: "demo-reviewed-card",
        quantity: 2,
        condition: "NM",
        notes: "Owned copies",
        acquisitionPrice: 10,
        acquisitionCurrency: "CAD",
        cardData: {
          externalId: "demo-reviewed-card",
          tcg: "pokemon",
          name: "Reviewed actual card",
        },
      },
    ],
  };
}
const count = () =>
  useDemoStore.getState().collectionRows.collectionEntries.length;

test("demo durably commits exact copy IDs and its receipt together, including replay after reload", async () => {
  const binder = useDemoStore.getState().binders[0]!.id;
  const before = count();
  const result = await demoAtomicIntake(binder, request());
  assert.equal(result.status, 200);
  const first = (await result.json()) as InventoryIntakeReceipt;
  assert.equal(first.entryIds.length, 2);
  assert.equal(count(), before + 2);
  const copies = useDemoStore
    .getState()
    .collectionRows.collectionEntries.filter((entry) =>
      first.entryIds.includes(entry._id),
    );
  assert.ok(
    copies.every(
      (copy) =>
        copy.quantity === 1 &&
        copy.notes === "Owned copies" &&
        copy.acquisitionCurrency === "CAD",
    ),
  );
  const backup = await exportLocalBackup();
  const exportedCopy = backup.binders
    .flatMap((item) => item.cards)
    .find((item) => item.id === first.entryIds[0]);
  assert.equal(exportedCopy?.acquisitionCurrency, "CAD");
  assert.equal(exportedCopy?.acquisitionPrice, 10);
  await importLocalBackup(backup);
  const projectedCopy = useDemoStore
    .getState()
    .binders.flatMap((item) => item.cards)
    .flatMap((item) => item.copies ?? [])
    .find((item) => item.id === first.entryIds[0]);
  assert.equal(projectedCopy?.acquisitionCurrency, "CAD");
  setDemoPersistence(persistence);
  await whenDemoStoreHydrated();
  const replay = await demoAtomicIntake(binder, request());
  assert.deepEqual(await replay.json(), first);
  assert.equal(count(), before + 2);
  const conflict = request();
  conflict.rows[0]!.quantity = 3;
  assert.equal((await demoAtomicIntake(binder, conflict)).status, 409);
  assert.equal(count(), before + 2);
});

test("a failed demo durable commit exposes neither copies nor a successful receipt", async () => {
  const binder = useDemoStore.getState().binders[0]!.id;
  const before = count();
  fail = true;
  const result = await demoAtomicIntake(binder, request());
  assert.equal(result.status, 409);
  assert.equal(count(), before);
  assert.equal(
    useDemoStore.getState().portableSections.inventoryIntakeOperations,
    undefined,
  );
  fail = false;
  assert.equal((await demoAtomicIntake(binder, request())).status, 200);
  assert.equal(count(), before + 2);
});

test("explicit demo deletion preserves the surviving sibling's identity and metadata", async () => {
  const binder = useDemoStore.getState().binders[0]!.id;
  const receipt = (await (
    await demoAtomicIntake(binder, request())
  ).json()) as InventoryIntakeReceipt;
  const sibling = structuredClone(
    useDemoStore
      .getState()
      .collectionRows.collectionEntries.find(
        (copy) => copy._id === receipt.entryIds[1],
      ),
  );
  const result = await demoRemovePhysicalCopy(binder, receipt.entryIds[0]!);
  assert.equal(result.status, 204);
  assert.equal(
    useDemoStore
      .getState()
      .collectionRows.collectionEntries.find(
        (copy) => copy._id === receipt.entryIds[0],
      ),
    undefined,
  );
  assert.deepEqual(
    useDemoStore
      .getState()
      .collectionRows.collectionEntries.find(
        (copy) => copy._id === receipt.entryIds[1],
      ),
    sibling,
  );
});

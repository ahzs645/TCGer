import {
  addCopies,
  inventoryIntakeSchema,
  type InventoryIntakeReceipt,
  type CopyFields,
} from "@tcg/api-types";
import {
  commitDemoBackup,
  demoBackupSnapshot,
  useDemoStore,
  type DemoCollectionAuditRecord,
} from "@/stores/demo-store";
import {
  COLLECTION_TABLES,
  LocalPortableDb,
  emptySnapshot,
  rowsOf,
} from "@/lib/storage/local-portable-db";
import { LOCAL_USER_ID } from "@/lib/storage/legacy-collection-rows";

// Serialize new operations and replays within this local demo runtime. The
// durable commit stores the complete receipt beside the changed copy rows.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action, action);
  queue = next.catch(() => undefined);
  return next;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function demoAtomicIntake(
  collectionId: string,
  body: unknown,
): Promise<Response> {
  return serialized(async () => {
    const parsed = inventoryIntakeSchema.safeParse(body);
    if (!parsed.success)
      return json(
        { message: parsed.error.issues[0]?.message ?? "Invalid intake" },
        400,
      );
    const input = parsed.data;
    if (input.sealedInventoryId)
      return json(
        {
          message:
            "The browser demo does not keep a physical sealed-opening ledger. Use a connected server for linked openings.",
        },
        501,
      );
    useDemoStore.getState().init();
    const before = await demoBackupSnapshot();
    const sections = before.portableSections ?? {};
    const operations = (sections.inventoryIntakeOperations ?? {}) as Record<
      string,
      { fingerprint: string; receipt: InventoryIntakeReceipt }
    >;
    const fingerprint = JSON.stringify({ collectionId, input });
    const previous = operations[input.operationId];
    if (previous)
      return previous.fingerprint === fingerprint
        ? json(previous.receipt)
        : json(
            {
              message:
                "This operation ID was already used for different reviewed cards.",
            },
            409,
          );
    const db = new LocalPortableDb({
      ...emptySnapshot(),
      ...structuredClone(before.collectionRows!),
    });
    const destination =
      collectionId === "__library__"
        ? db.snapshot().binders[0]?._id
        : collectionId;
    if (!destination)
      return json({ message: "Choose an existing demo binder." }, 404);
    const rows: InventoryIntakeReceipt["rows"] = [];
    try {
      for (const row of input.rows) {
        if (!row.cardData)
          return json(
            { message: "A reviewed printing snapshot is required." },
            400,
          );
        const { rowId, cardId, cardData, quantity, tags, newTags, ...fields } =
          row;
        if (newTags?.length)
          return json(
            { message: "Create tags before saving this intake." },
            400,
          );
        const created = await addCopies(db, {
          userId: LOCAL_USER_ID,
          binderId: destination,
          quantity: quantity ?? 1,
          card: { ...cardData, externalId: cardData.externalId ?? cardId },
          fields: fields as CopyFields,
          embeddedTags: (tags ?? []).flatMap((id) =>
            (before.tags ?? []).filter((tag) => tag.id === id),
          ),
        });
        rows.push({ rowId, entryIds: created.map((copy) => copy._id) });
      }
      const receipt: InventoryIntakeReceipt = {
        operationId: input.operationId,
        entryIds: rows.flatMap((row) => row.entryIds),
        rows,
      };
      const after = rowsOf(db.snapshot(), COLLECTION_TABLES);
      const history: DemoCollectionAuditRecord = {
        id: crypto.randomUUID(),
        operationKind: "add",
        actorId: LOCAL_USER_ID,
        affectedCopies: receipt.entryIds.length,
        binderId: destination,
        summary: `Saved ${receipt.entryIds.length} reviewed physical copies`,
        canUndo: true,
        createdAt: new Date().toISOString(),
        before: structuredClone(before.collectionRows!),
        after: structuredClone(after),
      };
      await commitDemoBackup(
        {
          collectionRows: after,
          collectionHistory: [
            history,
            ...(before.collectionHistory ?? []).map((entry) => ({
              ...entry,
              canUndo: false,
            })),
          ].slice(0, 25),
          portableSections: {
            ...sections,
            inventoryIntakeOperations: {
              ...operations,
              [input.operationId]: { fingerprint, receipt },
            },
          },
        },
        true,
        before,
      );
      return json(receipt);
    } catch (error) {
      return json(
        {
          message:
            error instanceof Error
              ? error.message
              : "The reviewed cards could not be stored durably.",
        },
        409,
      );
    }
  });
}

export function demoRemovePhysicalCopy(
  collectionId: string,
  copyId: string,
): Promise<Response> {
  return serialized(async () => {
    const before = await demoBackupSnapshot();
    const rows = before.collectionRows!;
    const entry = rows.collectionEntries.find(
      (row) =>
        row._id === copyId &&
        row.binderId === collectionId &&
        row.userId === LOCAL_USER_ID,
    );
    if (!entry) return json({ message: "Physical copy not found" }, 404);
    const after = {
      ...rows,
      collectionEntries: rows.collectionEntries.filter(
        (row) => row._id !== entry._id,
      ),
    };
    const history: DemoCollectionAuditRecord = {
      id: crypto.randomUUID(),
      operationKind: "remove",
      actorId: LOCAL_USER_ID,
      affectedCopies: 1,
      binderId: collectionId,
      summary: "Removed one physical copy",
      canUndo: true,
      createdAt: new Date().toISOString(),
      before: structuredClone(rows),
      after: structuredClone(after),
    };
    try {
      await commitDemoBackup(
        {
          collectionRows: after,
          collectionHistory: [
            history,
            ...(before.collectionHistory ?? []).map((item) => ({
              ...item,
              canUndo: false,
            })),
          ].slice(0, 25),
        },
        true,
        before,
      );
      return new Response(null, { status: 204 });
    } catch (error) {
      return json(
        {
          message:
            error instanceof Error
              ? error.message
              : "The copy could not be removed durably.",
        },
        409,
      );
    }
  });
}

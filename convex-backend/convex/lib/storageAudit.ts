export type AuditCandidate = {
  compartmentId: string;
  compartmentLabel: string;
  slotIndex: number;
  collectionEntryId?: string;
  tcg?: string;
  externalId?: string;
  name?: string;
  quantity: number;
};

export type AuditComparison = {
  compartmentId: string;
  compartmentLabel: string;
  slotIndex: number;
  status: "correct" | "missing" | "wrong" | "extra";
  expectedCollectionEntryId?: string;
  expectedExternalId?: string;
  expectedName?: string;
  observedCollectionEntryId?: string;
  observedExternalId?: string;
  observedName?: string;
  expectedQuantity: number;
  observedQuantity: number;
};

function key(row: Pick<AuditCandidate, "compartmentId" | "slotIndex">) {
  return `${row.compartmentId}:${row.slotIndex}`;
}

function identity(row: AuditCandidate) {
  return row.externalId
    ? `card:${row.tcg ?? "unknown"}:${row.externalId}`
    : row.collectionEntryId
      ? `entry:${row.collectionEntryId}`
      : "";
}

export function reconcileStorageAudit(expected: AuditCandidate[], observed: AuditCandidate[]) {
  const collapse = (rows: AuditCandidate[]) => {
    const bySlot = new Map<string, AuditCandidate>();
    for (const row of rows) {
      const slotKey = key(row);
      const prior = bySlot.get(slotKey);
      if (prior && identity(prior) === identity(row)) prior.quantity += row.quantity;
      else bySlot.set(slotKey, { ...row });
    }
    return bySlot;
  };
  const expectedBySlot = collapse(expected);
  const observedBySlot = collapse(observed);
  const keys = [...new Set([...expectedBySlot.keys(), ...observedBySlot.keys()])].sort();
  const items: AuditComparison[] = keys.map((slotKey) => {
    const expectedRow = expectedBySlot.get(slotKey);
    const observedRow = observedBySlot.get(slotKey);
    const row = expectedRow ?? observedRow!;
    const status = !expectedRow
      ? "extra"
      : !observedRow
        ? "missing"
        : identity(expectedRow) === identity(observedRow) && expectedRow.quantity === observedRow.quantity
          ? "correct"
          : "wrong";
    return {
      compartmentId: row.compartmentId,
      compartmentLabel: row.compartmentLabel,
      slotIndex: row.slotIndex,
      status,
      expectedCollectionEntryId: expectedRow?.collectionEntryId,
      expectedExternalId: expectedRow?.externalId,
      expectedName: expectedRow?.name,
      observedCollectionEntryId: observedRow?.collectionEntryId,
      observedExternalId: observedRow?.externalId,
      observedName: observedRow?.name,
      expectedQuantity: expectedRow?.quantity ?? 0,
      observedQuantity: observedRow?.quantity ?? 0,
    };
  });
  return {
    items,
    summary: {
      correct: items.filter((item) => item.status === "correct").length,
      missing: items.filter((item) => item.status === "missing").length,
      wrong: items.filter((item) => item.status === "wrong").length,
      extra: items.filter((item) => item.status === "extra").length,
    },
  };
}

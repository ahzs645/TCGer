export interface CostSplitLine {
  copyId: string;
  weight: number;
}

export interface CostSplitAllocation extends CostSplitLine {
  amountCents: number;
}

/** Split an integer total without manufacturing or losing a cent. */
export function allocateCostCents(
  totalCents: number,
  lines: CostSplitLine[],
): CostSplitAllocation[] {
  if (!Number.isSafeInteger(totalCents) || totalCents < 0) {
    throw new Error(
      "Total cost must be a non-negative integer number of cents.",
    );
  }
  if (lines.length === 0) return [];
  if (
    lines.some(
      (line) =>
        !line.copyId || !Number.isFinite(line.weight) || line.weight <= 0,
    )
  ) {
    throw new Error("Every selected copy must have a positive weight.");
  }

  const weightTotal = lines.reduce((sum, line) => sum + line.weight, 0);
  const shares = lines.map((line, index) => {
    const exact = (totalCents * line.weight) / weightTotal;
    const floor = Math.floor(exact);
    return { line, index, floor, fraction: exact - floor };
  });
  const remaining =
    totalCents - shares.reduce((sum, share) => sum + share.floor, 0);
  const remainderOrder = [...shares].sort(
    (left, right) =>
      right.fraction - left.fraction ||
      left.line.copyId.localeCompare(right.line.copyId) ||
      left.index - right.index,
  );
  const bonus = new Set(
    remainderOrder.slice(0, remaining).map((share) => share.index),
  );

  return shares.map(({ line, index, floor }) => ({
    ...line,
    amountCents: floor + (bonus.has(index) ? 1 : 0),
  }));
}

export function collectorNumberKey(value: string): string {
  return value.trim().replace(/^#/, "").toLocaleLowerCase();
}

import { z } from "zod";

const money = z.number().finite().min(0).max(100_000_000);
export const gradingHistoryPointSchema = z.object({
  date: z.string(),
  price: money,
});
export const gradingOutcomeSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  grade: z.number().positive().max(10).optional(),
  price: money.optional(),
  population: z.number().int().nonnegative().max(1_000_000_000).optional(),
  salesCount: z.number().int().nonnegative().max(1_000_000_000).optional(),
  confidence: z.string().optional(),
  source: z.string(),
  history: z.array(gradingHistoryPointSchema).default([]),
});
export const gradingCostsSchema = z.object({
  grading: money,
  shipping: money,
  insurance: money,
  upcharge: money,
  sellingFeePercent: z.number().finite().min(0).max(100),
  sellingFixed: money,
  rawSellingFeePercent: z.number().finite().min(0).max(100),
  rawSellingFixed: money,
});
export const gradingCalculationInputSchema = z
  .object({
    rawValue: money,
    costs: gradingCostsSchema,
    outcomes: z.array(gradingOutcomeSchema).max(100),
    interpolate: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (
      new Set(value.outcomes.map((row) => row.key)).size !==
      value.outcomes.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate grade outcomes",
      });
  });
export type GradingOutcome = z.infer<typeof gradingOutcomeSchema>;
export type GradingCosts = z.infer<typeof gradingCostsSchema>;
export type GradingCalculationInput = z.infer<
  typeof gradingCalculationInputSchema
>;
export const emptyGradingCosts: GradingCosts = {
  grading: 0,
  shipping: 0,
  insurance: 0,
  upcharge: 0,
  sellingFeePercent: 0,
  sellingFixed: 0,
  rawSellingFeePercent: 0,
  rawSellingFixed: 0,
};
export interface GradingCalculation {
  totalCost: number;
  rawNet: number;
  population: number;
  pricedPopulation: number;
  expectedGain: number | null;
  expectedValue: number | null;
  verdict: "grade" | "borderline" | "keep" | "insufficient";
  breakEven: string | null;
  rows: Array<
    GradingOutcome & {
      estimated: boolean;
      gain: number | null;
      probability: number | null;
    }
  >;
}

/** Shared economics. Population describes submitted cards, not an individual copy's odds.
 * Missing population outcomes never disappear from the denominator. No extrapolation. */
export function calculateGrading(
  input: GradingCalculationInput,
): GradingCalculation {
  const { rawValue, costs, outcomes, interpolate } =
    gradingCalculationInputSchema.parse(input);
  const totalCost =
    costs.grading + costs.shipping + costs.insurance + costs.upcharge;
  const rawNet =
    rawValue * (1 - costs.rawSellingFeePercent / 100) - costs.rawSellingFixed;
  const population = outcomes.reduce(
    (sum, row) => sum + (row.population ?? 0),
    0,
  );
  const anchors = outcomes
    .filter((row) => row.grade != null && row.price != null && row.price > 0)
    .sort((a, b) => a.grade! - b.grade!);
  const rows = outcomes.map((row) => {
    let price = row.price;
    let estimated = false;
    if (price == null && row.grade != null && interpolate) {
      const lower = anchors.filter((a) => a.grade! < row.grade!).pop();
      const upper = anchors.find((a) => a.grade! > row.grade!);
      if (lower && upper) {
        const position =
          (row.grade - lower.grade!) / (upper.grade! - lower.grade!);
        price = Math.exp(
          Math.log(lower.price!) +
            position * Math.log(upper.price! / lower.price!),
        );
        estimated = true;
      }
    }
    return {
      ...row,
      price,
      estimated,
      gain:
        price == null
          ? null
          : price * (1 - costs.sellingFeePercent / 100) -
            costs.sellingFixed -
            totalCost -
            rawNet,
      probability: population > 0 ? (row.population ?? 0) / population : null,
    };
  });
  const pricedPopulation = rows.reduce(
    (sum, row) => sum + (row.price != null ? (row.population ?? 0) : 0),
    0,
  );
  const complete = population > 0 && pricedPopulation === population;
  const expectedValue = complete
    ? rows.reduce(
        (sum, row) => sum + (row.price ?? 0) * (row.probability ?? 0),
        0,
      )
    : null;
  const expectedGain = complete
    ? rows.reduce(
        (sum, row) => sum + (row.gain ?? 0) * (row.probability ?? 0),
        0,
      )
    : null;
  const verdict =
    expectedGain == null
      ? "insufficient"
      : Math.abs(expectedGain) <= Math.max(0.01, rawValue * 0.2)
        ? "borderline"
        : expectedGain > 0
          ? "grade"
          : "keep";
  // This is a qualifying observed outcome, not a promise that every higher grade has the same economics.
  const breakEven =
    rows
      .filter((row) => row.grade != null && row.gain != null && row.gain > 0)
      .sort((a, b) => a.grade! - b.grade!)[0]?.label ?? null;
  return {
    totalCost,
    rawNet,
    population,
    pricedPopulation,
    expectedValue,
    expectedGain,
    verdict,
    breakEven,
    rows,
  };
}

export const gradingSnapshotRequestSchema = z.object({
  tcgPlayerId: z.string().trim().regex(/^\d+$/),
  language: z.enum(["english", "japanese"]).default("english"),
});
export type GradingSnapshotRequest = z.infer<
  typeof gradingSnapshotRequestSchema
>;
export const gradingSnapshotSchema = z.object({
  tcgPlayerId: z.string(),
  name: z.string(),
  setName: z.string(),
  collectorNumber: z.string(),
  currency: z.literal("USD"),
  source: z.string(),
  sourceUrl: z.string().url(),
  retrievedAt: z.string(),
  priceAsOf: z.string().nullable(),
  warnings: z.array(z.string()),
  graders: z.array(
    z.object({
      grader: z.string(),
      gemRate: z.number().nullable(),
      outcomes: z.array(gradingOutcomeSchema),
    }),
  ),
  rawQuotes: z.array(
    z.object({ printing: z.string(), condition: z.string(), price: money }),
  ),
});
export type GradingSnapshot = z.infer<typeof gradingSnapshotSchema>;

export function blankGradingOutcomes(grader: string): GradingOutcome[] {
  const grades = Array.from({ length: 10 }, (_, i) => 10 - i);
  if (["BGS", "CGC"].includes(grader))
    grades.push(...Array.from({ length: 9 }, (_, i) => 9.5 - i));
  const rows: GradingOutcome[] = grades
    .sort((a, b) => b - a)
    .map((grade) => ({
      key: `${grader.toLowerCase()}${grade}`,
      label: `${grader} ${grade}`,
      grade,
      source: "manual",
      history: [],
    }));
  const specialty =
    grader === "BGS"
      ? ["pristine", "perfect"]
      : grader === "CGC"
        ? ["pristine"]
        : [];
  return [
    ...specialty.map((label) => ({
      key: `${grader.toLowerCase()}${label}`,
      label: `${grader} ${label}`,
      source: "manual",
      history: [],
    })),
    ...rows,
  ];
}

// Actual paid submission costs are separate from hypothetical sale costs and raw market value.
export const gradingExpenseSchema = z.object({
  id: z.string(),
  cardName: z.string().trim().min(1),
  grader: z.string(),
  serviceTier: z.string(),
  currency: z.enum(["USD", "CAD", "EUR", "GBP"]),
  paidAt: z.string(),
  grading: money,
  shipping: money,
  insurance: money,
  upcharge: money,
});
export type GradingExpense = z.infer<typeof gradingExpenseSchema>;
export const gradingSearchRequestSchema = z.object({
  search: z.string().trim().min(3).max(100),
  language: z.enum(["english", "japanese"]).default("english"),
});
export const gradingSearchResultSchema = z.object({
  cards: z.array(
    z.object({
      tcgPlayerId: z.string(),
      name: z.string(),
      setName: z.string(),
      collectorNumber: z.string(),
    }),
  ),
});
export type GradingSearchResult = z.infer<typeof gradingSearchResultSchema>;

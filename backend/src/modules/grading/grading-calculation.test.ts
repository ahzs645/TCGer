import { readFileSync } from 'fs';
import { resolve } from 'path';
import { calculateGrading, gradingCalculationInputSchema } from '@tcg/api-types';
const fixtures = JSON.parse(
  readFileSync(
    resolve(__dirname, '../../../../mobile-parity/fixtures/grading-calculations.json'),
    'utf8',
  ),
);
for (const fixture of fixtures) {
  test(fixture.name, () => {
    const actual = calculateGrading(fixture.input);
    for (const [key, expected] of Object.entries(fixture.expected)) {
      const value = actual[key as keyof typeof actual];
      if (typeof expected === 'number') expect(value).toBeCloseTo(expected, 8);
      else expect(value).toEqual(expected);
    }
  });
}
test('rejects negative amounts, invalid percentages, and duplicate outcomes', () => {
  const input = fixtures[0].input;
  expect(gradingCalculationInputSchema.safeParse({ ...input, rawValue: -1 }).success).toBe(false);
  expect(
    gradingCalculationInputSchema.safeParse({
      ...input,
      costs: { ...input.costs, sellingFeePercent: 101 },
    }).success,
  ).toBe(false);
  expect(
    gradingCalculationInputSchema.safeParse({
      ...input,
      outcomes: [input.outcomes[0], input.outcomes[0]],
    }).success,
  ).toBe(false);
});

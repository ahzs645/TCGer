jest.mock('../../config/env', () => ({
  env: { POKEMON_PRICE_TRACKER_LICENSE_ACK: true, POKEMON_PRICE_TRACKER_API_KEY: 'test-key' },
}));
jest.mock('./graded-price.service', () => ({ queryGradingProvider: jest.fn() }));
import { queryGradingProvider } from './graded-price.service';
import { normalizeGradingSnapshot, fetchGradingSnapshot } from './grading-snapshot.service';
const request = { tcgPlayerId: '123', language: 'english' as const };
test('joins exact population identity, half grades, gem percentages, specialty and unclassified outcomes', () => {
  const result = normalizeGradingSnapshot(
    {
      name: 'Card',
      ebay: {
        salesByGrade: {
          bgs9_5: { smartMarketPrice: { price: '125', confidence: 'low' }, count: 7 },
        },
        priceHistory: { bgs9_5: { '2026-09-01': { average: 120 } } },
      },
    },
    {
      data: [
        { tcgPlayerId: '999', populationByGrader: { BGS: { g9_5: 999 } } },
        {
          tcgPlayerId: '123',
          populationByGrader: {
            BGS: { g9_5: 20, auth: 2, perfect: 3, totalPopulation: 30, gemRate: 10 },
          },
        },
      ],
    },
    request,
  );
  const grader = result.graders[0];
  expect(grader.gemRate).toBe(0.1);
  expect(grader.outcomes.find((r) => r.grade === 9.5)).toMatchObject({
    price: 125,
    population: 20,
    salesCount: 7,
    history: [{ date: '2026-09-01', price: 120 }],
  });
  expect(grader.outcomes.find((r) => r.key === 'bgsunclassified')?.population).toBe(5);
  expect(grader.outcomes.reduce((sum, r) => sum + (r.population ?? 0), 0)).toBe(30);
});
test('unavailable prices are not zero and raw prices retain printing and condition', () => {
  const result = normalizeGradingSnapshot(
    {
      prices: { variants: { Holofoil: { 'Lightly Played': { price: 12 } } } },
      ebay: { salesByGrade: { psa10: { smartMarketPrice: { price: null }, medianPrice: 0 } } },
    },
    null,
    request,
  );
  expect(result.graders[0].outcomes[0].price).toBeUndefined();
  expect(result.rawQuotes).toEqual([
    { printing: 'Holofoil', condition: 'Lightly Played', price: 12 },
  ]);
  expect(result.warnings.length).toBe(2);
});

test('exact product lookup preserves prices on population failure and caches the result', async () => {
  const query = queryGradingProvider as jest.Mock;
  query.mockReset();
  query.mockResolvedValueOnce({
    data: [
      {
        tcgPlayerId: '456',
        name: 'Exact card',
        ebay: { salesByGrade: { psa10: { medianPrice: 50, count: 2 } } },
      },
    ],
  });
  query.mockRejectedValueOnce(new Error('403 plan does not include population'));
  const input = { tcgPlayerId: '456', language: 'english' as const };
  const first = await fetchGradingSnapshot(input);
  expect(first.graders[0].outcomes.find((r) => r.key === 'psa10')?.price).toBe(50);
  expect(first.warnings.join(' ')).toContain('Population lookup failed');
  expect(first.graders[0].outcomes).toHaveLength(10);
  expect(await fetchGradingSnapshot(input)).toBe(first);
  expect(query).toHaveBeenCalledTimes(2);
});
test('never accepts a different product returned by the provider', async () => {
  const query = queryGradingProvider as jest.Mock;
  query.mockReset();
  query.mockResolvedValueOnce({ data: [{ tcgPlayerId: '999', name: 'Wrong card' }] });
  await expect(
    fetchGradingSnapshot({ tcgPlayerId: '789', language: 'english' }),
  ).rejects.toMatchObject({ status: 404 });
  expect(query).toHaveBeenCalledTimes(1);
});

test('does not use overlapping population counts as grading odds', () => {
  const result = normalizeGradingSnapshot(
    {},
    {
      data: {
        tcgPlayerId: '123',
        populationByGrader: { BGS: { g10: 10, perfect: 2, totalPopulation: 10 } },
      },
    },
    request,
  );
  expect(result.graders[0].outcomes.every((row) => row.population == null)).toBe(true);
  expect(result.warnings.join(' ')).toContain('may overlap');
});

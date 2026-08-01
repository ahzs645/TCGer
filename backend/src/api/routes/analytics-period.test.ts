import { parseAnalyticsPeriod } from './analytics-period';

describe('parseAnalyticsPeriod', () => {
  test.each([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
    ['180d', 180],
    ['1y', 365]
  ])('maps %s to %i days', (period, expectedDays) => {
    expect(parseAnalyticsPeriod(period)).toBe(expectedDays);
  });

  test('accepts bare numbers and clamps them to supported bounds', () => {
    expect(parseAnalyticsPeriod('45')).toBe(45);
    expect(parseAnalyticsPeriod('0')).toBe(1);
    expect(parseAnalyticsPeriod('999')).toBe(365);
  });

  test('uses 30 days for invalid values', () => {
    expect(parseAnalyticsPeriod('1week')).toBe(30);
    expect(parseAnalyticsPeriod(undefined)).toBe(30);
  });
});

import { evaluateCatalogMatchSafety, type ScanMatch } from './scan.service';

function match(confidence: number, id = String(confidence)): ScanMatch {
  return {
    externalId: id,
    tcg: 'pokemon',
    name: id,
    setCode: 'sv1',
    setName: 'Set',
    rarity: null,
    imageUrl: null,
    confidence,
    distance: Math.round((1 - confidence) * 768),
  };
}

describe('catalog match safety', () => {
  it('rejects captures without an in-catalog candidate', () => {
    expect(evaluateCatalogMatchSafety([]).reason).toBe('no-catalog-match');
  });

  it('rejects weak nearest-neighbour guesses', () => {
    expect(evaluateCatalogMatchSafety([match(0.6)]).reason).toBe('low-confidence');
  });

  it('refuses effectively tied catalog candidates', () => {
    expect(evaluateCatalogMatchSafety([match(0.9, 'a'), match(0.897, 'b')]).reason).toBe(
      'ambiguous',
    );
  });

  it('accepts a strong candidate with a useful margin', () => {
    expect(evaluateCatalogMatchSafety([match(0.91, 'a'), match(0.85, 'b')]).accepted).toBe(true);
  });
});

import { matchTcgCsvGroup, normalizeTcgCsvCollectorNumber } from './tcgcsv-price-provider';

describe('TCGCSV conservative matching', () => {
  const groups = [
    { groupId: 1, abbreviation: 'SV01', name: 'SV01: Scarlet & Violet Base Set' },
    { groupId: 2, abbreviation: 'BS', name: 'Base Set' },
    { groupId: 3, abbreviation: 'XY08', name: 'XY - BREAKthrough' },
  ];

  it('prefers an exact abbreviation over a name suffix', () => {
    expect(matchTcgCsvGroup(groups, 'SV01', 'Scarlet & Violet', 3)).toMatchObject({
      groupId: '1',
      confidence: 1,
      method: 'exact-id',
    });
  });

  it('refuses ambiguous exact matches', () => {
    expect(
      matchTcgCsvGroup(
        [...groups, { groupId: 4, abbreviation: 'SV01', name: 'Duplicate' }],
        'SV01',
        undefined,
        3,
      ),
    ).toBeNull();
  });

  it('normalizes provider fractions without dropping letter prefixes', () => {
    expect(normalizeTcgCsvCollectorNumber('004/102')).toBe('4');
    expect(normalizeTcgCsvCollectorNumber('TG-012/030')).toBe('tg012');
  });
});

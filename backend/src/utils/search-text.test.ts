import { normalizeSearchText, searchTerms } from './search-text';

describe('search text normalization', () => {
  it.each(['Mr. Mime', 'mr mime', 'mr.mime', '  MR - MIME  '])(
    'normalizes %s to the same key',
    (value) => {
      expect(normalizeSearchText(value)).toBe('mrmime');
    }
  );

  it('folds diacritics and width variants', () => {
    expect(normalizeSearchText('Ｆｌａｂéｂé')).toBe('flabebe');
  });

  it('exposes normalized terms for provider fallbacks', () => {
    expect(searchTerms('Mr.mime')).toEqual(['mr', 'mime']);
  });
});

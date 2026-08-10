/**
 * Build a comparison-only key while preserving the original value for display.
 * Unicode compatibility folding handles width variants, and search punctuation
 * is treated as a word boundary rather than as a required literal character.
 */
export function normalizeSearchText(value: string): string {
  return searchTerms(value).join('');
}

export function searchTerms(value: string): string[] {
  const folded = value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US');

  return folded.match(/[\p{L}\p{N}]+/gu) ?? [];
}

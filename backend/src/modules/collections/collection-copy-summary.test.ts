import { formatCollectionCopyCount } from './collection-copy-summary';

describe('collection copy count summaries', () => {
  it.each([
    [0, '0 collection copies'],
    [1, '1 collection copy'],
    [2, '2 collection copies'],
  ])('formats %i with the correct noun', (count, expected) => {
    expect(formatCollectionCopyCount(count)).toBe(expected);
  });
});

export function formatCollectionCopyCount(count: number): string {
  return `${count} collection ${count === 1 ? 'copy' : 'copies'}`;
}

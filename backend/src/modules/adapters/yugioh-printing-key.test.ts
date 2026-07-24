import {
  buildYugiohPrintingKey,
  normalizeYugiohRarity,
  parseYugiohPrintingKey
} from './yugioh-printing-key';

describe('Yu-Gi-Oh printing keys', () => {
  test('builds a deterministic explicit printing key', () => {
    const first = buildYugiohPrintingKey({
      baseExternalId: '46986414',
      setCode: ' sdy-en006 ',
      rarity: ' Ultra   Rare ',
      artworkId: '46986414'
    });
    const second = buildYugiohPrintingKey({
      baseExternalId: '46986414',
      setCode: 'SDY-EN006',
      rarity: 'ultra rare',
      artworkId: '46986414'
    });

    expect(first).toBe(second);
    expect(first).toBe(
      'yugioh:print:v1:46986414:SDY-EN006:ultra%20rare:46986414'
    );
  });

  test('round-trips delimiters and unicode safely', () => {
    const key = buildYugiohPrintingKey({
      baseExternalId: 'card:1',
      setCode: 'lob-en001',
      rarity: 'Collector’s Rare',
      artworkId: 'art/1'
    });

    expect(parseYugiohPrintingKey(key)).toEqual({
      baseExternalId: 'card:1',
      setCode: 'LOB-EN001',
      rarity: 'collector’s rare',
      artworkId: 'art/1'
    });
  });

  test.each(['46986414', 'yugioh:print:v1:', 'yugioh:print:v1:a:b:c', 'yugioh:print:v1:%ZZ:b:c:d'])(
    'rejects malformed key %s',
    (key) => {
      expect(parseYugiohPrintingKey(key)).toBeNull();
    }
  );

  test('normalizes rarity case and whitespace', () => {
    expect(normalizeYugiohRarity('  Secret   Rare ')).toBe('secret rare');
  });
});

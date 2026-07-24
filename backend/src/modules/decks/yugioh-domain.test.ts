import {
  calculateMissingDeckCards,
  evaluateYugiohBanlist,
  inferYugiohZone,
  parseYdk,
  resolveYugiohBaseId,
  serializeYdk
} from './yugioh-domain';

describe('Yu-Gi-Oh deck domain', () => {
  test('resolves a base identity from an exact printing snapshot', () => {
    expect(
      resolveYugiohBaseId({
        externalId: 'yugioh:46986414:sdy-006:ultra-rare:46986414',
        cardData: { baseId: '46986414' }
      })
    ).toBe('46986414');
  });

  test('routes extra deck monster types without treating side deck cards as extra', () => {
    expect(inferYugiohZone({ zone: 'extra', isSideboard: true })).toBe('extra');
    expect(
      inferYugiohZone({
        cardData: { attributes: { type: 'Fusion Monster' } }
      })
    ).toBe('extra');
    expect(
      inferYugiohZone({
        isSideboard: true,
        cardData: { attributes: { type: 'Fusion Monster' } }
      })
    ).toBe('side');
  });

  test('allocates owned copies across zones and returns zone-preserving missing cards', () => {
    const missing = calculateMissingDeckCards(
      [
        {
          externalId: 'print-a',
          name: 'Dark Magician',
          quantity: 2,
          zone: 'main',
          cardData: { baseId: '46986414' }
        },
        {
          externalId: 'print-b',
          name: 'Dark Magician',
          quantity: 1,
          zone: 'side',
          cardData: { baseId: '46986414' }
        }
      ],
      [{ externalId: '46986414', quantity: 2 }]
    );

    expect(missing).toEqual([
      {
        externalId: '46986414',
        name: 'Dark Magician',
        quantity: 1,
        zone: 'side'
      }
    ]);
  });

  test('applies classical limits across all zones by base identity', () => {
    const result = evaluateYugiohBanlist(
      [
        {
          externalId: 'printing-a',
          name: 'Limited Card',
          quantity: 1,
          zone: 'main',
          cardData: { baseId: '12345678' }
        },
        {
          externalId: 'printing-b',
          name: 'Limited Card',
          quantity: 1,
          zone: 'side',
          cardData: { baseId: '12345678' }
        }
      ],
      {
        type: 'classical',
        name: 'TCG',
        cards: { '12345678': 'Limited' }
      }
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  test('calculates Genesys points including duplicate copies', () => {
    const result = evaluateYugiohBanlist(
      [
        {
          externalId: '12345678',
          name: 'Point Card',
          quantity: 3,
          zone: 'main'
        }
      ],
      {
        type: 'genesys',
        name: 'Genesys',
        maxPoints: 10,
        cards: { '12345678': 4 }
      }
    );

    expect(result).toMatchObject({ valid: false, points: 12 });
  });

  test('round-trips valid passcodes through YDK zones and reports invalid identities', () => {
    const serialized = serializeYdk([
      { externalId: '11111111', name: 'Main Card', quantity: 2, zone: 'main' },
      { externalId: '22222222', name: 'Extra Card', quantity: 1, zone: 'extra' },
      { externalId: '33333333', name: 'Side Card', quantity: 1, zone: 'side' },
      { externalId: 'not-a-passcode', name: 'Unknown', quantity: 1, zone: 'main' }
    ]);

    expect(serialized.skipped).toHaveLength(1);
    expect(parseYdk(serialized.content)).toEqual([
      { externalId: '11111111', name: '11111111', quantity: 2, zone: 'main' },
      { externalId: '22222222', name: '22222222', quantity: 1, zone: 'extra' },
      { externalId: '33333333', name: '33333333', quantity: 1, zone: 'side' }
    ]);
  });

  test('keeps the same passcode as independent main, extra, and side entries on import', () => {
    expect(
      parseYdk(['#main', '11111111', '#extra', '11111111', '!side', '11111111'].join('\n'))
    ).toEqual([
      { externalId: '11111111', name: '11111111', quantity: 1, zone: 'main' },
      { externalId: '11111111', name: '11111111', quantity: 1, zone: 'extra' },
      { externalId: '11111111', name: '11111111', quantity: 1, zone: 'side' }
    ]);
  });
});

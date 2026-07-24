import { collectionImportTemplate, previewCollectionImport } from './import.service';

describe('collection CSV import', () => {
  it('accepts the export-style headings and quoted values', () => {
    const preview = previewCollectionImport(
      [
        'Binder,Card Name,TCG,Set Code,Set Name,Rarity,External ID,Condition,Language,Notes,Price,Acquisition Price,Serial Number,Foil,Signed,Altered,Tags,Acquired At,Created At',
        'Trade,"Pikachu, Flying",pokemon,sv1,Base,Rare,sv1-25,NM,en,"clean, centered",12.5,2.25,,Yes,No,No,"PC; Electric",2026-01-02,2026-01-02',
      ].join('\n'),
    );

    expect(preview.valid).toBe(true);
    expect(preview.rows[0]).toMatchObject({
      binderName: 'Trade',
      cardName: 'Pikachu, Flying',
      quantity: 1,
      isFoil: true,
      price: 12.5,
      tags: ['PC', 'Electric'],
    });
  });

  it('rejects invalid quantities and non-finite prices', () => {
    const preview = previewCollectionImport(
      'tcg,external_id,card_name,quantity,price\npokemon,sv1-1,Pikachu,0,Infinity',
    );

    expect(preview.valid).toBe(false);
    expect(preview.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'quantity' }),
        expect.objectContaining({ field: 'price' }),
      ]),
    );
  });

  it.each(['onepiece', 'lorcana', 'dragonball'] as const)(
    'accepts %s CSV imports',
    (tcg) => {
      const preview = previewCollectionImport(
        `tcg,external_id,card_name,quantity\n${tcg},${tcg}-card,Example Card,1`,
      );

      expect(preview.valid).toBe(true);
      expect(preview.rows[0]).toMatchObject({
        tcg,
        externalId: `${tcg}-card`,
      });
    },
  );

  it('provides a valid machine-readable template header', () => {
    const template = collectionImportTemplate();
    expect(template).toContain('tcg,external_id,card_name');
    expect(template.endsWith('\n')).toBe(true);
  });

  it('preserves exact printing and collectible edition fields from CSV', () => {
    const preview = previewCollectionImport([
      'tcg,external_id,card_name,base_external_id,printing_key,artwork_id,collector_number,set_code,rarity,edition,quantity',
      'yugioh,yugioh:print:v1:46986414:sdy-006:ultra-rare:46986414,Dark Magician,46986414,yugioh:print:v1:46986414:sdy-006:ultra-rare:46986414,46986414,SDY-006,SDY-006,Ultra Rare,First Edition,2',
    ].join('\n'));

    expect(preview.valid).toBe(true);
    expect(preview.rows[0]).toMatchObject({
      baseExternalId: '46986414',
      printingKey: expect.stringContaining('yugioh:print:v1'),
      artworkId: '46986414',
      collectorNumber: 'SDY-006',
      edition: 'First Edition',
      quantity: 2,
    });
  });
});

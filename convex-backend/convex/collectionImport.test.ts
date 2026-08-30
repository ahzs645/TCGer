import { describe, expect, test } from "vitest";
import {
  collectionImportTemplate,
  previewCollectionImport,
  previewCollectionImportSource,
} from "./lib/collectionImport";

describe("collection CSV import parser", () => {
  test("accepts export headings and merges duplicate rows", () => {
    const preview = previewCollectionImport(
      [
        "TCG,External ID,Card Name,Binder,Quantity,Price,Tags",
        'pokemon,sv1-1,"Pikachu, Pal","Trade Binder",2,1.25,wants;promo',
        'pokemon,sv1-1,"Pikachu, Pal","Trade Binder",1,1.25,wants;promo',
      ].join("\n"),
    );
    expect(preview.valid).toBe(true);
    expect(preview.rows).toHaveLength(1);
    expect(preview.totalCopies).toBe(3);
  });

  test("rejects invalid prices and excessive copy counts", () => {
    const invalidPrice = previewCollectionImport(
      "tcg,external_id,card_name,price\nmagic,abc,Lotus,Infinity",
    );
    expect(invalidPrice.valid).toBe(false);
    expect(invalidPrice.issues.some((issue) => issue.field === "price")).toBe(
      true,
    );

    const excessive = previewCollectionImport(
      "tcg,external_id,card_name,quantity\nmagic,abc,Lotus,501",
    );
    expect(excessive.valid).toBe(false);
  });

  test("ships a machine-readable template", () => {
    expect(collectionImportTemplate()).toContain(
      "tcg,external_id,card_name,set_code",
    );
  });

  test.each(["onepiece", "lorcana", "dragonball"] as const)(
    "accepts %s collection rows",
    (tcg) => {
      const preview = previewCollectionImport(
        `tcg,external_id,card_name\n${tcg},card-1,Example Card`,
      );
      expect(preview.valid).toBe(true);
      expect(preview.rows[0]?.tcg).toBe(tcg);
    },
  );

  test("normalizes ManaBox and TCGPlayer marketplace profiles", () => {
    const manaBox = previewCollectionImportSource({
      format: "manabox-csv",
      content: "Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,Purchase price,Condition,Language\nSol Ring,cmm,Commander Masters,396,foil,Uncommon,2,00000000-0000-0000-0000-000000000001,4.25,Near Mint,English",
    });
    expect(manaBox.valid).toBe(true);
    expect(manaBox.rows[0]).toMatchObject({ tcg: "magic", externalId: "00000000-0000-0000-0000-000000000001", quantity: 2, isFoil: true, acquisitionPrice: 4.25 });

    const tcgPlayer = previewCollectionImportSource({
      format: "tcgplayer-csv",
      content: "TCGplayer Id,Product Line,Set Name,Product Name,Rarity,Condition,TCG Market Price,Total Quantity\n12345,Pokemon,Base Set,Pikachu,Common,Near Mint,5.50,3",
    });
    expect(tcgPlayer.valid).toBe(true);
    expect(tcgPlayer.rows[0]).toMatchObject({ tcg: "pokemon", externalId: "tcgplayer:12345", quantity: 3, price: 5.5 });
  });

  test("keeps unresolved Moxfield rows out of commit-ready previews", () => {
    const preview = previewCollectionImportSource({
      format: "moxfield-csv",
      content: "Count,Name,Edition,Condition,Language,Foil\n1,Sol Ring,CMM,Near Mint,English,false",
    });
    expect(preview.valid).toBe(false);
    expect(preview.issues).toContainEqual(expect.objectContaining({ field: "externalId" }));
  });
});

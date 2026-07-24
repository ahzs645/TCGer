import { describe, expect, test } from "vitest";
import {
  collectionImportTemplate,
  previewCollectionImport,
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
});

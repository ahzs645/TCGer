import {
  parseCardmarketSinglesText,
  parseCollectionImportSource,
  parseCollectionJson,
} from "./collection-import-parser";

describe("multi-format collection import parser", () => {
  it("parses Cardmarket Yu-Gi-Oh singles and reports exact-print ambiguity", () => {
    const result = parseCardmarketSinglesText([
      "Order contents",
      "Yugioh Singles:",
      "2 Dark Magician 006 EN NM SDY UR First Edition clean copy 1,20 EUR",
      "1 Blue-Eyes White Dragon 001 DE EX SDK SCR 12.50 EUR",
      "3 malformed row",
      "Pokemon Singles:",
    ].join("\n"));

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({
      quantity: 2,
      cardName: "Dark Magician",
      collectorNumber: "SDY-006",
      language: "EN",
      condition: "Near Mint",
      rarity: "Ultra Rare",
      edition: "First Edition",
      notes: "clean copy",
      price: 1.2,
      currency: "EUR",
    });
    expect(result.ambiguities).toHaveLength(2);
    expect(result.failures).toEqual([
      expect.objectContaining({ sourceRow: 5, code: "UNRECOGNIZED_ROW" }),
    ]);
  });

  it("applies an explicit exact-print resolution without losing source metadata", () => {
    const result = parseCardmarketSinglesText(
      "1 Dark Magician 006 EN NM SDY UR First Edition 1,20 EUR",
      {
        1: {
          externalId: "yugioh:print:v1:46986414:sdy-006:ultra-rare:46986414",
          baseExternalId: "46986414",
          printingKey: "yugioh:print:v1:46986414:sdy-006:ultra-rare:46986414",
          artworkId: "46986414",
        },
      },
    );

    expect(result.ambiguities).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      externalId: expect.stringContaining("yugioh:print:v1"),
      baseExternalId: "46986414",
      artworkId: "46986414",
      collectorNumber: "SDY-006",
    });
  });

  it("normalizes export-style JSON aliases and emits machine-readable failures", () => {
    const result = parseCollectionJson(JSON.stringify({
      cards: [
        {
          game: "pokemon",
          external_id: "sv1-001",
          card_name: "Bulbasaur",
          qty: 2,
          set_code: "SV1",
          is_foil: "yes",
          tags: "Starter; Grass",
        },
        { game: "yugioh", quantity: 0 },
      ],
    }));

    expect(result.rows[0]).toMatchObject({
      tcg: "pokemon",
      externalId: "sv1-001",
      cardName: "Bulbasaur",
      quantity: 2,
      isFoil: true,
      tags: ["Starter", "Grass"],
    });
    expect(result.failures).toEqual([
      expect.objectContaining({ sourceRow: 2, code: "INVALID_FIELD" }),
    ]);
  });

  it("auto-detects JSON and exposes the PDF extraction boundary", () => {
    expect(parseCollectionImportSource({
      content: '[{"tcg":"magic","externalId":"abc","name":"Sol Ring"}]',
      format: "auto",
    }).format).toBe("json");

    const pdf = parseCollectionImportSource({
      content: "%PDF-1.7",
      fileName: "order.pdf",
    });
    expect(pdf.failures[0]).toMatchObject({
      code: "PDF_TEXT_EXTRACTION_REQUIRED",
    });
  });
});

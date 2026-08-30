import assert from "node:assert/strict";
import test from "node:test";

import { serializeCollectionImportRequest } from "./collections";

test("rich collection imports preserve format, filename, and resolutions", () => {
  const payload = JSON.parse(
    serializeCollectionImportRequest({
      content: '[{"name":"Pikachu"}]',
      fileName: "collection.json",
      format: "json",
      resolutions: {
        "1": { externalId: "sv3-025", printingKey: "pokemon:sv3:025" },
      },
      options: { createMissingBinders: true },
    }),
  );
  assert.equal(payload.content, '[{"name":"Pikachu"}]');
  assert.equal(payload.fileName, "collection.json");
  assert.equal(payload.format, "json");
  assert.equal(payload.resolutions["1"].externalId, "sv3-025");
});

test("legacy CSV imports remain accepted", () => {
  const payload = JSON.parse(
    serializeCollectionImportRequest({ csv: "name,quantity\nPikachu,1" }),
  );
  assert.match(payload.csv, /Pikachu/);
});

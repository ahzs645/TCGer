import assert from "node:assert/strict";
import test from "node:test";

import { scanIndexAssetUrl } from "./scan-index-assets";

test("resolves local and publisher-relative scan artifacts against the CDN root", () => {
  const root = "https://assets.example.com/scan-index/";
  assert.equal(
    scanIndexAssetUrl("manifest.json", root),
    "https://assets.example.com/scan-index/manifest.json",
  );
  assert.equal(
    scanIndexAssetUrl("objects/model.onnx", root),
    "https://assets.example.com/scan-index/objects/model.onnx",
  );
});

test("remaps legacy same-origin model URLs and preserves absolute URLs", () => {
  const root = "https://assets.example.com/scan-index";
  assert.equal(
    scanIndexAssetUrl("/scan-index/card-embeddings.onnx", root),
    "https://assets.example.com/scan-index/card-embeddings.onnx",
  );
  assert.equal(
    scanIndexAssetUrl("https://cdn.example.com/model.onnx", root),
    "https://cdn.example.com/model.onnx",
  );
});

test("rejects traversal in publisher-controlled artifact paths", () => {
  assert.throws(
    () => scanIndexAssetUrl("objects/../secret", "/scan-index"),
    /Invalid scan-index artifact path/,
  );
});

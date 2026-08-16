import assert from "node:assert/strict";
import test from "node:test";

import { getAppRoute } from "./app-routes";

test("keeps application routes inside the demo namespace", () => {
  assert.equal(getAppRoute("/wishlists", "/demo/guides"), "/demo/wishlists");
  assert.equal(getAppRoute("/scan", "/demo/dashboard"), "/demo/scan");
  assert.equal(
    getAppRoute("/shared/demo-share-token", "/demo/collections"),
    "/demo/shared/demo-share-token",
  );
  assert.equal(getAppRoute("/", "/demo/cards"), "/demo/dashboard");
});

test("leaves application routes unprefixed outside demo mode", () => {
  assert.equal(getAppRoute("/wishlists", "/guides"), "/wishlists");
  assert.equal(getAppRoute("scan", "/dashboard"), "/scan");
});

test("does not prefix an already demo-scoped target twice", () => {
  assert.equal(
    getAppRoute("/demo/wishlists", "/demo/guides"),
    "/demo/wishlists",
  );
});

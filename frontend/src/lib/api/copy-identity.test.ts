import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { updateCollectionCard, removeCollectionCopy } from "./collections";
afterEach(() => mock.restoreAll());
test("legacy virtual-copy IDs reach the server intact instead of becoming URL fragments", async () => {
  const urls: string[] = [];
  mock.method(
    globalThis,
    "fetch",
    async (url: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(url));
      return init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : Response.json({ id: "entry#2" });
    },
  );
  await updateCollectionCard("token", "binder", "entry#2", {
    notes: "Only second copy",
  });
  await removeCollectionCopy("token", "binder", "entry#2");
  assert.match(urls[0]!, /\/cards\/entry%232$/);
  assert.match(urls[1]!, /\/copies\/entry%232$/);
  assert.ok(urls.every((url) => new URL(url).hash === ""));
});

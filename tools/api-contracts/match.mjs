import assert from "node:assert/strict";

// Responses allow additional fields; requests must preserve the exact declared
// payload. Only explicitly marked generated IDs/timestamps are variable.
export function assertResponse(actual, expected, matchers = {}, pointer = "") {
  const matcher = matchers[pointer];
  if (matcher) {
    assert.equal(typeof actual, "string", pointer);
    assert.ok(actual.length > 0, pointer);
    if (matcher === "iso-date-time") {
      assert.match(actual, /^\d{4}-\d{2}-\d{2}T/, pointer);
      assert.ok(Number.isFinite(Date.parse(actual)), pointer);
    } else assert.equal(matcher, "nonempty-string", `Unknown matcher at ${pointer}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), pointer);
    assert.equal(actual.length, expected.length, `${pointer}: array length`);
    expected.forEach((item, index) => assertResponse(actual[index], item, matchers, `${pointer}/${index}`));
  } else if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object" && !Array.isArray(actual), pointer);
    for (const [key, value] of Object.entries(expected)) {
      assert.ok(Object.hasOwn(actual, key), `${pointer}/${key}: missing required response field`);
      assertResponse(actual[key], value, matchers, `${pointer}/${key}`);
    }
  } else assert.deepEqual(actual, expected, pointer);
}

export function assertRequest(interaction, url, options = {}) {
  const parsed = new URL(url);
  assert.equal(parsed.pathname, interaction.request.path);
  assert.equal(options.method ?? "GET", interaction.request.method);
  assert.deepEqual(Object.fromEntries(parsed.searchParams), interaction.request.query ?? {});
  const headers = new Headers(options.headers);
  for (const [name, value] of Object.entries(interaction.request.headers)) assert.equal(headers.get(name), value, name);
  if (interaction.request.body !== undefined) {
    assert.match(headers.get("content-type") ?? "", /application\/json/);
    assert.deepEqual(JSON.parse(options.body), interaction.request.body);
  } else assert.ok(options.body === undefined || options.body === null);
}

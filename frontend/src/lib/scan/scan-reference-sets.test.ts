import assert from "node:assert/strict";
import test from "node:test";

import { referenceWindowMatches } from "./scan-reference-sets";

test("matches a labeled window by expected printing ID within tolerance", () => {
  assert.equal(
    referenceWindowMatches(
      {
        id: "pikachu",
        name: "Pikachu",
        startSeconds: 10,
        endSeconds: 12,
        expectedExternalIds: ["sv3-125"],
      },
      [
        {
          timestampSeconds: 14,
          bestMatch: { externalId: "sv3-125", name: "Pikachu" },
        },
      ],
    ),
    true,
  );
});

test("does not accept the right name with the wrong printing when IDs are labeled", () => {
  assert.equal(
    referenceWindowMatches(
      {
        id: "pikachu",
        name: "Pikachu",
        startSeconds: 10,
        endSeconds: 12,
        expectedExternalIds: ["sv3-125"],
      },
      [
        {
          timestampSeconds: 11,
          bestMatch: { externalId: "base1-58", name: "Pikachu" },
        },
      ],
    ),
    false,
  );
});

test("does not count a printing that the scanner rejected below threshold", () => {
  assert.equal(
    referenceWindowMatches(
      {
        id: "pikachu",
        name: "Pikachu",
        startSeconds: 10,
        endSeconds: 12,
        expectedExternalIds: ["SV3-125"],
      },
      [
        {
          timestampSeconds: 11,
          bestMatch: {
            externalId: "sv3-125",
            name: "Pikachu",
            passedThreshold: false,
          },
        },
      ],
    ),
    false,
  );
});

test("falls back to accepted names when a window has no printing ID", () => {
  assert.equal(
    referenceWindowMatches(
      {
        id: "trainer",
        name: "Professor's Research",
        acceptedNames: ["Professors Research"],
        startSeconds: 2,
        endSeconds: 3,
      },
      [
        {
          timestampSeconds: 2.5,
          bestMatch: { externalId: "x", name: "Professors Research" },
        },
      ],
    ),
    true,
  );
});

import { describe, expect, test } from "vitest";
import { formatCollectionCopyCount } from "./lib/copyLabels";

describe("collection copy count summaries", () => {
  test.each([
    [0, "0 collection copies"],
    [1, "1 collection copy"],
    [2, "2 collection copies"]
  ])("formats %i with the correct noun", (count, expected) => {
    expect(formatCollectionCopyCount(count)).toBe(expected);
  });
});

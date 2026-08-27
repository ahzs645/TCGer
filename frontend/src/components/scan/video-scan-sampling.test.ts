import assert from "node:assert/strict";
import test from "node:test";

import {
  clampAnalysisInterval,
  shouldAnalyzeVideoTime,
} from "./video-scan-sampling";

test("clamps and rounds the scanner analysis interval", () => {
  assert.equal(clampAnalysisInterval(10), 100);
  assert.equal(clampAnalysisInterval(526), 550);
  assert.equal(clampAnalysisInterval(5_000), 2_000);
});

test("analyzes the first frame and then honors the configured interval", () => {
  assert.equal(shouldAnalyzeVideoTime(0, -1, 500), true);
  assert.equal(shouldAnalyzeVideoTime(1.4, 1, 500), false);
  assert.equal(shouldAnalyzeVideoTime(1.5, 1, 500), true);
  assert.equal(shouldAnalyzeVideoTime(0.2, 1, 500), true);
});

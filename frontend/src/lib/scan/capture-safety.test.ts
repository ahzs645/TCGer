import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptRecognition,
  armNextCapture,
  catalogRejectionMessage,
  INITIAL_CAPTURE_SAFETY,
  observeGuidePresence,
} from "./capture-safety";

test("accepting one card disarms repeated recognition", () => {
  const accepted = acceptRecognition(INITIAL_CAPTURE_SAFETY, "scan-1");
  assert.equal(accepted.armed, false);
  assert.deepEqual(acceptRecognition(accepted, "scan-2"), accepted);
});

test("capture rearms after the card leaves for three frames", () => {
  let state = acceptRecognition(INITIAL_CAPTURE_SAFETY, "scan-1");
  state = observeGuidePresence(state, false);
  state = observeGuidePresence(state, false);
  assert.equal(state.armed, false);
  state = observeGuidePresence(state, false);
  assert.equal(state.armed, true);
});

test("explicit next rearms immediately and catalog rejections are explained", () => {
  assert.equal(armNextCapture().armed, true);
  assert.match(
    catalogRejectionMessage({
      accepted: false,
      setCodeHint: "MEW",
      candidateSetCode: "OBF",
    })!,
    /outside pinned set MEW/,
  );
});

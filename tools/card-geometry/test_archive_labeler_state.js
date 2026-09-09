"use strict";

// Execute the browser labeler's real state functions in a small DOM sandbox.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const geometry = require("./corner-editor/geometry.js");

const elements = new Map();
function element() {
  return { value: "", checked: true, disabled: false, hidden: false, textContent: "", className: "",
    addEventListener() {}, focus() {}, replaceChildren(...children) { this.children = children; },
    append(...children) { this.children = [...(this.children || []), ...children]; },
    setAttribute(name, value) { (this.attributes ||= {})[name] = value; },
    getContext() { return { clearRect() {}, drawImage() {}, fillRect() {}, getImageData() { return {}; } }; } };
}
function $(selector) { if (!elements.has(selector)) elements.set(selector, element()); return elements.get(selector); }
const storage = new Map();
const localStorage = { getItem: (k) => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const context = {
  window: { CardEditorGeometry: geometry, CardLabelLayers: require("./archive-labeler/layers.js"), localStorage, location: { search: "" }, addEventListener() {} }, document: { querySelector: $, addEventListener() {}, createElement: element },
  localStorage, devicePixelRatio: 1, console, fetch: () => Promise.reject(new Error("test bootstrap")),
  Image: function Image() {}, Option: function Option(text, value) { this.text = text; this.value = value; }, setTimeout, JSON, Math, Number, String, Object, Array, Promise, URLSearchParams, URL,
};
context.window.window = context.window;
vm.createContext(context);
const source = fs.readFileSync(path.join(__dirname, "archive-labeler/labeler.js"), "utf8");
vm.runInContext(source + "\nglobalThis.__labeler = { state, seeded, accept, rotateActive, applyDirection, payloadTargets, dirty, loadTargets, snapshot, undo, save, load, navigate, advanceCard, orderedNeighbor, filteredFrames, queueNumber, frameReference, selectTarget, cardNumber, reviewNumbers, configureReviewBatch, renderReviewBatch, setLayer, coveredCorners, markCovered, overlapPairs, relativeLayer, renderOverlaps, nextUnknownOverlap, coveringQuads, cropShape };", context);
const api = context.__labeler, state = api.state;
state.frame = { recordId: "frame-1", instances: [
  { sourceAnnotationIndex: 0, displayCardNumber: 2, seedBox: { left: .1, top: .1, right: .4, bottom: .5 } },
  { sourceAnnotationIndex: 1, displayCardNumber: 3, seedBox: { left: .5, top: .1, right: .8, bottom: .5 } },
] };
state.keys = ["0", "1"]; state.active = 0; state.direction = 0; $("#direction").value = "0";
state.targets = { 0: api.seeded("0"), 1: api.seeded("1") };
assert.equal(api.cardNumber(0), 2);
assert.equal(api.cardNumber(1), 3);

// Landscape-printed cards keep their upright corner order; only preview shape changes.
state.image = {width: 1280, height: 1280};
const landscapeCorners = [[.21,.35],[.78,.34],[.81,.76],[.20,.79]];
const beforeShape = JSON.stringify(landscapeCorners);
assert.equal(api.cropShape(landscapeCorners, "0"), "landscape");
assert.equal(api.cropShape(landscapeCorners.slice(1).concat(landscapeCorners.slice(0, 1)), "0"), "portrait");
state.image = {width: 500, height: 1000};
assert.equal(api.cropShape(landscapeCorners, "0"), "portrait", "compare source-pixel lengths, not normalized coordinates");
state.cropShapes["frame-1:0"] = "landscape";
assert.equal(api.cropShape(landscapeCorners, "0"), "landscape", "explicit shape overrides perspective inference");
assert.equal(api.cropShape(landscapeCorners, "1"), "portrait", "a shape override belongs only to its card");
assert.equal(JSON.stringify(landscapeCorners), beforeShape, "viewing cannot change labeled corner order");
state.cropShapes = {}; state.image = null;

// Imported references seed the editor without silently becoming human labels.
const originalSeed = JSON.stringify(state.targets);
const referenceInstance = state.frame.instances[0];
referenceInstance.seedCorners = [[.12,.1],[.4,.13],[.37,.5],[.1,.46]];
referenceInstance.seedCornerVisibility = ["visible", "visible", "visible", "occluded"];
referenceInstance.seedOrientationKnown = false;
const referenceBefore = JSON.stringify(referenceInstance);
state.targets[0] = api.seeded("0");
assert.equal(JSON.stringify(state.targets[0].corners), JSON.stringify(referenceInstance.seedCorners));
assert.equal(state.targets[0].orientationKnown, false);
assert.equal(state.targets[0].status, "seeded");
assert.equal(JSON.stringify(api.payloadTargets()), "{}", "untouched references are not confirmed labels");
state.targets[0].corners[0][0] = .2;
assert.equal(JSON.stringify(referenceInstance), referenceBefore, "editing cannot change the source reference");
state.targets[0] = api.seeded("0");
assert.equal(state.targets[0].corners[0][0], .12, "reset restores the reference rather than the box");
state.direction = 1;
const referenceRotated = api.seeded("0");
assert.equal(referenceRotated.corners[0][0], .4);
assert.equal(referenceRotated.cornerVisibility[2], "occluded");
assert.equal(referenceRotated.orientationKnown, false, "a remembered page direction does not verify printed top");
delete referenceInstance.seedCorners; delete referenceInstance.seedCornerVisibility; delete referenceInstance.seedOrientationKnown;
state.direction = 0; state.targets = JSON.parse(originalSeed);

const initialCorners = JSON.stringify(state.targets);
$("#layer-other").value = "1"; $("#layer-relation").value = "above";
api.setLayer();
assert.equal(JSON.stringify(state.layers), '[{"above":0,"below":1}]', "separate cards can have a layer relation");
assert.equal(JSON.stringify(state.targets), initialCorners, "setting a layer does not move or confirm corners");
assert.equal(JSON.parse(storage.get("archive-draft:frame-1")).occlusionRelations[0].above, 0);
api.undo();
assert.equal(state.layers.length, 0, "Undo restores the previous layer graph");
$("#layer-forward").onclick();
assert.equal(JSON.stringify(state.layers), '[{"above":0,"below":1}]');
$("#layer-backward").onclick();
assert.equal(JSON.stringify(state.layers), '[{"above":1,"below":0}]', "forward/backward swap the selected card relative to the comparison card");
assert.equal(JSON.stringify(state.targets), initialCorners, "moving forward/backward preserves full corners and approval state");
api.undo(); api.undo();
assert.equal(state.layers.length, 0);
state.dirty = false;
$("#preview-mode").value = "layers"; $("#preview-mode").onchange();
assert.equal(state.dirty, false, "preview mode is a viewing preference, not a label edit");
assert.equal(storage.get("archive-labeler-preview-mode"), "layers");

// A selected card can intersect several independent cards; the panel must expose
// every one even when the optional comparison selector points somewhere else.
const pairFrame = state.frame;
const quad = (l,t,r,b) => [[l,t],[r,t],[r,b],[l,b]];
state.keys = ["0","1","2","3","4"];
state.frame = {recordId:"multi-overlap", instances:state.keys.map((k) => ({sourceAnnotationIndex:Number(k),displayCardNumber:Number(k)+1}))};
state.targets = Object.fromEntries([quad(.2,.2,.8,.8),quad(.1,.1,.4,.5),quad(.6,.1,.9,.5),quad(.1,.6,.3,.9),quad(.9,.8,1,1)].map((corners,i) => [i,{corners,cornerVisibility:["visible","visible","visible","visible"],status:"confirmed"}]));
state.layers = []; state.active = 0; state.compareKey = "4";
const multiBefore = JSON.stringify(state.targets);
assert.equal(JSON.stringify(api.overlapPairs()), '[["0","1"],["0","2"],["0","3"]]');
api.renderOverlaps();
assert.equal($("#overlap-list").children.length, 3, "all overlapping cards appear, regardless of the comparison dropdown");
assert.match($("#overlap-summary").textContent, /3 cards overlap Card 1 · 3 orders unknown/);
api.setLayer("below", "1"); api.setLayer("below", "2");
api.renderOverlaps();
assert.equal(api.coveringQuads("0").length, 2, "the combined mask includes both known covering cards");
assert.match($("#overlap-summary").textContent, /1 order unknown/);
const lastRowButtons = $("#overlap-list").children[2].children[1].children[2].children;
assert.equal(lastRowButtons[1].attributes["aria-label"], "Place Card 1 below Card 4");
lastRowButtons[1].onclick();
assert.equal(api.coveringQuads("0").length, 3, "each overlap row edits its own card relationship");
assert.equal(JSON.stringify(state.targets), multiBefore, "ordering all overlaps never changes reviewed geometry");
api.renderOverlaps();
assert.equal($("#next-overlap").disabled, true);
api.undo(); api.renderOverlaps();
assert.match($("#frame-overlaps").textContent, /3 overlapping pairs · 1 order still unknown/);
state.active = 4; state.compareKey = null;
api.nextUnknownOverlap();
assert.equal(state.active, 0);
assert.equal(state.compareKey, "3", "next unknown checks the entire photo");
state.layers = [{above:1,below:2},{above:2,below:0}];
assert.equal(api.relativeLayer("0","1"), "below", "transitive ordering resolves overlapping pairs too");
state.targets["3"] = {skip:"occluded"};
api.renderOverlaps();
assert.equal($("#overlap-list").children.length, 2, "skipped cards are excluded from overlap checks");
assert.equal($("#next-overlap").disabled, true);
state.targets["2"].corners = quad(.9,.1,1,.5);
assert.equal(api.overlapPairs().length, 1, "checks follow edited outlines, not stale boxes");
state.frame = pairFrame; state.keys = ["0","1"]; state.targets = JSON.parse(initialCorners); state.layers = []; state.active = 0; state.compareKey = null; state.undo = []; state.dirty = false;

state.active = 1;
state.targets["1"].corners = [[.3,.2],[.6,.2],[.6,.4],[.3,.4]];
state.layers = [{above:0,below:1}];
assert.equal(JSON.stringify(api.coveredCorners()), '[0,3]');
assert.equal(state.targets["1"].cornerVisibility[0], "visible", "coverage is a suggestion until applied");
api.markCovered();
assert.equal(JSON.stringify(state.targets["1"].cornerVisibility), '["occluded","visible","visible","occluded"]');
assert.equal(state.targets["1"].status, "edited");
api.undo();
$("#skip").value = "occluded"; $("#skip").onchange();
assert.equal(state.layers.length, 0, "skipping a card removes its direct layer relationships");
api.undo();
assert.equal(JSON.stringify(state.layers), '[{"above":0,"below":1}]', "Undo restores both a skipped card and its layers");
state.targets = JSON.parse(initialCorners); state.layers = []; state.active = 0; state.undo = []; state.dirty = false;

assert.equal(state.targets[0].status, "seeded");
state.pending = [[.1, .1]];
api.accept();
assert.equal(state.targets[0].status, "seeded", "an unfinished redraw cannot confirm the old box");
state.pending = null;
api.accept();
assert.equal(state.targets[0].status, "confirmed");
assert.equal(state.active, 1);
assert.deepEqual(Object.keys(api.payloadTargets()), ["0"]);

state.active = 1;
api.rotateActive();
assert.equal(state.targets[1].status, "edited");
const rotated = JSON.stringify(state.targets[1].corners);
$("#direction").value = "1";
api.applyDirection();
assert.equal(state.targets[1].status, "edited");
assert.equal(JSON.stringify(state.targets[1].corners), rotated);
assert.deepEqual(Object.keys(api.payloadTargets()), ["0"]);

state.active = 0;
api.rotateActive();
assert.equal(state.targets[0].status, "edited");
assert.equal(JSON.stringify(api.payloadTargets()), "{}");

state.active = 1; state.corner = 3; state.direction = 1;
api.snapshot();
state.active = 0; state.corner = 0; state.direction = 2; $("#direction").value = "2";
api.undo();
assert.equal(state.active, 1);
assert.equal(state.corner, 3);
assert.equal(state.direction, 1);

state.frame.label = { revision: 4, targets: { "0": { corners: [[.1, .1], [.4, .1], [.4, .5], [.1, .5]] } } };
state.targets[0] = { ...state.targets[0], status: "edited" };
api.dirty();
const draft = JSON.parse(storage.get("archive-draft:frame-1"));
assert.equal(draft.revision, 4);
assert.equal(api.loadTargets({ "0": { corners: draft.targets[0].corners, status: "edited" } })["0"].status, "edited");
assert.equal(api.loadTargets(state.frame.label.targets)["0"].status, "confirmed");

// Exercise the actual asynchronous save path, with only its HTTP boundary mocked.
state.frames = [{ id: "frame-1" }];
state.layers = [{ above: 0, below: 1 }];
context.savedBodies = [];
vm.runInContext(`api = async (url, options) => {
  if (url === "/api/frames") return { progress: { framesComplete: 0, frames: 1, targetsLabeled: 0, targetsSkipped: 0, targets: 2 }, frames: [{ id: "frame-1", complete: false, scene: "all", archive: "a", targets: 2 }] };
  const body = JSON.parse(options.body);
  savedBodies.push(body);
  return { ...body, recordId: "frame-1", revision: body.revision + 1, complete: false };
};`, context);
api.save(false).then(async (saved) => {
  assert.equal(saved, true, "save completes including rendering refreshed frame options");
  assert.equal(context.savedBodies.length, 1);
  assert.deepEqual(context.savedBodies[0].occlusionRelations, [{ above: 0, below: 1 }], "server saves include layers alongside drafts");
  assert.equal(JSON.stringify(context.savedBodies[0].targets), "{}", "drafts are not submitted as confirmed labels");
  assert.deepEqual(Object.keys(context.savedBodies[0].drafts), ["0", "1"], "Save sends edited corners to server draft storage");
  assert.equal(JSON.stringify(context.savedBodies[0].drafts["1"].corners), rotated);
  const savedDraft = JSON.parse(storage.get("archive-draft:frame-1"));
  assert.equal(savedDraft.revision, 5);
  assert.equal(savedDraft.unsavedChanges, false);
  assert.equal(savedDraft.targets["1"].status, "edited");
  assert.deepEqual(savedDraft.occlusionRelations, [{ above: 0, below: 1 }]);
  assert.equal(JSON.stringify(savedDraft.targets["1"].corners), rotated);
  assert.equal(state.dirty, false, "Save & next must not prompt to leave a persisted draft");

  // Approve-on-Next is opt-in, and changing the mode alone cannot approve cards.
  assert.equal($("#approve-next").checked, false);
  $("#approve-next").checked = true;
  $("#approve-next").onchange();
  assert.equal(storage.get("archive-labeler-approve-next"), "true");
  assert.equal(state.targets["1"].status, "edited");
  state.keys.push("2");
  state.targets = { "0": api.seeded("0"), "1": api.seeded("1"), "2": { skip: "reflected-padding" } };
  state.targets["1"].status = "edited";
  state.active = 0;
  state.frames = [{ id: "frame-1" }, { id: "frame-2" }];
  state.filtered = state.frames;
  assert.equal(api.queueNumber("frame-2"), 2, "frame numbering remains queue-stable");
  assert.match(api.frameReference(), /^F1 \/ C/);
  api.selectTarget(1);
  assert.equal(storage.get("archive-labeler-last-card:frame-1"), "1", "selected card is remembered");
  state.active = 0;
  $("#filter-scene").value = "all";
  $("#incomplete").checked = true;
  state.frames[0].complete = true;
  assert.deepEqual(api.filteredFrames("frame-1").map((f) => f.id), ["frame-1", "frame-2"], "active completed frame stays selectable");
  $("#incomplete").checked = false;
  context.loadCalls = [];
  context.failSave = false;
  vm.runInContext(`load = async (id) => { loadCalls.push(id); };
    api = async (url, options) => {
  if (url === "/api/frames") return { progress: {}, frames: [{ id: "frame-1", complete: false, scene: "all", archive: "a", targets: 3 }, { id: "frame-2", complete: false, scene: "all", archive: "a", targets: 3 }] };
      if (failSave) throw Error("Simulated server rejection");
      const body = JSON.parse(options.body);
      savedBodies.push(body);
      return { ...body, recordId: "frame-1", revision: body.revision + 1, complete: Object.keys(body.targets).length === state.keys.length };
    };`, context);

  // A failed request neither approves local drafts nor advances the page.
  context.failSave = true;
  assert.equal(await api.save(true), false);
  assert.equal(state.targets["0"].status, "seeded");
  assert.equal(state.targets["1"].status, "edited");
  assert.equal(context.loadCalls.length, 0);
  context.failSave = false;

  // Invalid and unfinished outlines fail before any request is submitted.
  const requestsBefore = context.savedBodies.length;
  state.targets["1"].corners.reverse();
  assert.equal(await api.save(true), false);
  assert.equal(context.savedBodies.length, requestsBefore);
  assert.equal(state.targets["0"].status, "seeded");
  state.targets["1"].corners.reverse();
  state.pending = [[.1, .1]];
  assert.equal(await api.save(true), false);
  assert.equal(context.savedBodies.length, requestsBefore);
  state.pending = null;

  // N only approves the active card, saves it, and selects the next pending one.
  await api.advanceCard();
  assert.equal(state.targets["0"].status, "confirmed");
  assert.equal(state.targets["1"].status, "edited");
  assert.equal(state.targets["0"].status, "confirmed");
  assert.equal(context.savedBodies.at(-1).targets["1"], undefined);
  assert.equal(context.savedBodies.at(-1).drafts["1"].status, "edited", "N also persists the other draft without approving it");
  assert.deepEqual(context.savedBodies.at(-1).targets["2"], { skip: "reflected-padding" });
  assert.equal(context.loadCalls.length, 0);

  // The page's Next control approves all remaining cards, saves once, and advances.
  assert.equal(api.orderedNeighbor(1).id, "frame-2", "next uses queue order after save");
  await api.navigate(1);
  assert.equal(state.targets["1"].status, "confirmed");
  assert.deepEqual(Object.keys(context.savedBodies.at(-1).targets), ["0", "1", "2"]);
  assert.deepEqual(context.savedBodies.at(-1).targets["2"], { skip: "reflected-padding" });
  assert.equal(api.orderedNeighbor(1)?.id, "frame-2");
  state.targets["0"].status = "edited";
  state.targets["0"].corners[0] = [.12, .1];
  assert.equal(await api.save(false), true, "Save frame honors the same approval setting as Next");
  assert.equal(state.targets["0"].status, "confirmed");
  assert.deepEqual(context.savedBodies.at(-1).targets["0"].corners[0], [.12, .1]);
  assert.deepEqual(context.savedBodies.at(-1).drafts, {});
  state.frame.recordId = "frame-2"; state.frames[1].complete = true;
  assert.equal(api.orderedNeighbor(-1).id, "frame-1", "Previous can return to the just-saved completed frame");
  assert.equal(storage.has("archive-draft:frame-1"), false);

  state.targets["0"].cornerSource = "detector";
  assert.equal(api.payloadTargets()["0"].cornerSource, "detector", "plain saves retain bot provenance");
  assert.equal(api.payloadTargets(["0"])["0"].cornerSource, "human", "explicit approval records human review");
  state.active = 0;
  api.accept();
  assert.equal(state.targets["0"].cornerSource, "human", "C can confirm an unchanged bot outline");

  // Execute the real image load when Previous enters a filtered-out completed frame.
  state.frames[0].complete = true;
  $("#incomplete").checked = true;
  state.filtered = [state.frames[1]];
  context.mockFrame = { recordId: "frame-1", instances: state.frame.instances,
    label: { revision: 9, complete: false, reviewer: "Ahmad", targets: {}, occlusionRelations: [{ above: 1, below: 0 }],
      drafts: { "1": { corners: [[.51,.1],[.8,.1],[.8,.5],[.5,.5]], cornerVisibility: ["visible","visible","visible","visible"], orientationKnown: true, status: "edited" } } } };
  context.Image = class { constructor() { this.width = 100; this.height = 100; }
    set src(value) { Promise.resolve().then(() => this.onload()); } };
  vm.runInContext("api = async () => mockFrame; draw = () => {};", context);
  await api.load("frame-1");
  assert.equal(state.frame.recordId, "frame-1");
  assert.equal($("#frame").value, "frame-1", "Previous visibly selects the completed frame");
  assert.ok($("#frame").children.some((option) => option.value === "frame-1"));
  assert.equal(state.active, 1, "returning restores the selected card");
  assert.equal(storage.get("archive-labeler-last-frame"), "frame-1");
  assert.equal(state.targets["1"].status, "edited", "a browser with no local draft restores the server draft");
  assert.equal(state.targets["1"].corners[0][0], .51);
  assert.equal(JSON.stringify(state.layers), '[{"above":1,"below":0}]', "returning reloads saved layer relationships");

  // Color filtering never renumbers frames; Previous still reaches a saved color page.
  state.frames = [
    { id: "color-1", scene: "all", colorMode: "color", complete: true },
    { id: "gray-2", scene: "all", colorMode: "grayscale", complete: false },
    { id: "color-3", scene: "all", colorMode: "color", complete: false },
  ];
  state.frame = { recordId: "color-1" };
  $("#filter-color").value = "color";
  assert.deepEqual(api.filteredFrames().map((f) => f.id), ["color-1", "color-3"]);
  assert.equal(api.orderedNeighbor(1).id, "color-3");
  assert.equal(api.queueNumber("color-3"), 3);
  state.frame.recordId = "color-3";
  assert.equal(api.orderedNeighbor(-1).id, "color-1");
  $("#filter-color").value = "grayscale";
  assert.deepEqual(api.filteredFrames().map((f) => f.id), ["gray-2"]);
  $("#filter-color").value = "all";
  assert.deepEqual(api.filteredFrames().map((f) => f.id), ["gray-2", "color-3"]);

  // A spot-check keeps stable references and navigation inside its selected photos,
  // including completed photos and the previously saved page on return.
  state.frames.push({ id: "color-4", scene: "all", colorMode: "color", complete: true });
  state.frames.push({ id: "color-5", scene: "all", colorMode: "color", complete: true });
  state.reviewNumbers = api.reviewNumbers("?review=1,4,4,invalid,0,-2");
  api.configureReviewBatch();
  assert.equal($("#incomplete").checked, false);
  assert.equal($("#incomplete").disabled, true);
  assert.deepEqual(api.filteredFrames().map((f) => f.id), ["color-1", "color-4"]);
  state.frame.recordId = "color-1";
  assert.equal(api.orderedNeighbor(1).id, "color-4", "Next skips photos outside the batch");
  state.frame.recordId = "color-4";
  assert.equal(api.orderedNeighbor(-1).id, "color-1");
  assert.equal(api.orderedNeighbor(1), null, "the last review photo cannot advance into the full queue");
  assert.equal(api.queueNumber(), 4, "batch position does not renumber F references");
  api.renderReviewBatch();
  assert.equal($("#review-position").textContent, "Review batch · Photo 2 of 2");
  state.reviewNumbers = null;
  api.configureReviewBatch();
  assert.equal($("#review-batch").hidden, true);
  assert.equal($("#incomplete").disabled, false);
  assert.equal(api.orderedNeighbor(1).id, "color-5");
  console.log("archive labeler state behavior passes");
}).catch((error) => { console.error(error); process.exitCode = 1; });

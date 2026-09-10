"use strict";
const $ = (s) => document.querySelector(s);
const G = window.CardEditorGeometry;
const L = window.CardLabelLayers;
const clone = (x) => JSON.parse(JSON.stringify(x));
const CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"];
function reviewNumbers(search) {
  const value = new URLSearchParams(search).get("review");
  return value === null ? null : new Set(value.split(",").filter((n) => /^[1-9]\d*$/.test(n)).map(Number));
}
// Every queued card starts as a movable outline seeded from its box ("seeded").
// Changes are drafts ("edited") until explicitly accepted ("confirmed");
// Drafts are saved separately from confirmed training labels.
const state = {
  frames: [], filtered: [], frame: null, image: null, pixels: null,
  targets: {}, keys: [], active: 0, corner: 0, pending: null, undo: [], dirty: false, direction: 0,
  drag: null, busy: false, view: { scale: 1, tx: 0, ty: 0 },
  reviewNumbers: reviewNumbers(window.location.search),
  layers: [],
  compareKey: null,
  cropShapes: {},
};
$("#reviewer").value = localStorage.getItem("archive-labeler-reviewer") || "";
let defaultReviewer = "";
function reviewerName() { return $("#reviewer").value.trim() || defaultReviewer; }
function showReviewer() { $("#reviewer-name").textContent = reviewerName() ? `· ${reviewerName()}` : ""; }
$("#reviewer").addEventListener("input", showReviewer);
$("#approve-next").checked = localStorage.getItem("archive-labeler-approve-next") === "true";
const savedColorFilter = localStorage.getItem("archive-labeler-color-filter");
$("#filter-color").value = ["all", "color", "grayscale"].includes(savedColorFilter) ? savedColorFilter : "color";
$("#filter-multiple").checked = localStorage.getItem("archive-labeler-multiple-filter") === "true";
function approveOnNext() { return $("#approve-next").checked; }
const savedPreviewMode = localStorage.getItem("archive-labeler-preview-mode");
$("#preview-mode").value = ["masked", "layers", "original"].includes(savedPreviewMode) ? savedPreviewMode : localStorage.getItem("archive-labeler-clip-layers") === "false" ? "original" : "masked";
function previewMode() { return $("#preview-mode").value; }

function status(message, error = false) { $("#status").textContent = message; $("#status").className = error ? "error" : ""; }
async function api(url, options) {
  const r = await fetch(url, options), j = await r.json();
  if (!r.ok) throw Error(j.error || r.statusText);
  return j;
}
function activeKey() { return state.keys[state.active]; }
function activeLabel() { return state.targets[activeKey()]; }
function cardNumber(index = state.active) {
  return state.frame?.instances?.[index]?.displayCardNumber ?? index + 1;
}
function seedBox(key) {
  const b = state.frame.instances.find((i) => String(i.sourceAnnotationIndex) === key).seedBox;
  return [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];
}
// Direction the printed top points in the photo (quarter turns clockwise from
// image-up). The printed top-left of a card whose top points right is the
// image top-right corner of its box, and so on.
function direction() { return state.direction; }
function setDirection(value) { state.direction = Number(value) || 0; $("#direction").value = String(state.direction); }
function rotateOrder(quad, turns) {
  const k = ((turns % 4) + 4) % 4;
  return quad.slice(k).concat(quad.slice(0, k));
}
function rotateLabel(t, turns) {
  t.corners = rotateOrder(t.corners, turns);
  t.cornerVisibility = rotateOrder(t.cornerVisibility, turns);
}
function seeded(key) {
  const instance = state.frame.instances.find((i) => String(i.sourceAnnotationIndex) === key);
  if (instance.seedCorners) return {
    corners: rotateOrder(clone(instance.seedCorners), direction()),
    cornerVisibility: rotateOrder(clone(instance.seedCornerVisibility), direction()),
    orientationKnown: instance.seedOrientationKnown === true, status: "seeded",
  };
  return { corners: rotateOrder(seedBox(key), direction()), cornerVisibility: ["visible", "visible", "visible", "visible"], orientationKnown: true, status: "seeded" };
}
function isLabel(t) { return t && (t.skip || t.status === "confirmed"); }
function frameGeom(canvas) {
  const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
  if (canvas.width !== Math.round(r.width * d) || canvas.height !== Math.round(r.height * d)) {
    canvas.width = Math.round(r.width * d); canvas.height = Math.round(r.height * d);
  }
  const margin = 0.04, v = state.view;
  const base = Math.min(canvas.width / (state.image.width * (1 + 2 * margin)), canvas.height / (state.image.height * (1 + 2 * margin)));
  const s = base * v.scale;
  return { x: (canvas.width - state.image.width * s) / 2 + v.tx * d, y: (canvas.height - state.image.height * s) / 2 + v.ty * d, w: state.image.width * s, h: state.image.height * s, d };
}
function toCanvas(f, [x, y]) { return [f.x + x * f.w, f.y + y * f.h]; }
function outline(ctx, q, f, color, width = 2, label = "", dash = []) {
  ctx.setLineDash(dash.map((v) => v * f.d));
  ctx.beginPath();
  q.forEach((p, i) => { const [x, y] = toCanvas(f, p); ctx[i ? "lineTo" : "moveTo"](x, y); });
  ctx.closePath(); ctx.strokeStyle = color; ctx.lineWidth = width * f.d; ctx.stroke(); ctx.setLineDash([]);
  if (label) { const [x, y] = toCanvas(f, q[0]); ctx.font = `bold ${13 * f.d}px system-ui`; ctx.fillStyle = color; ctx.fillText(label, x + 5 * f.d, y - 6 * f.d); }
}
function handle(ctx, f, p, radius, fill, text) {
  const [x, y] = toCanvas(f, p);
  ctx.beginPath(); ctx.arc(x, y, radius * f.d, 0, 2 * Math.PI); ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 1.5 * f.d; ctx.strokeStyle = "#0d121c"; ctx.stroke();
  if (text) { ctx.font = `${11 * f.d}px system-ui`; ctx.fillStyle = "#fff"; ctx.fillText(text, x + 9 * f.d, y - 9 * f.d); }
}
function coveringQuads(key) {
  return L.above(state.layers, key).map((index) => state.targets[index])
    .filter((t) => t?.corners && !t.skip && !G.labelQuadError(t.corners)).map((t) => t.corners);
}
function lowerQuads(key) {
  return layerKeys().filter((k) => L.above(state.layers, k).includes(Number(key)))
    .map((k) => state.targets[k].corners).filter((q) => !G.labelQuadError(q));
}
function coveredCorners(key = activeKey()) {
  const t = state.targets[key], covers = coveringQuads(key);
  return (t?.corners || []).map((p, i) => t.cornerVisibility[i] === "visible" && covers.some((q) => G.pointInQuad(p, q)) ? i : -1).filter((i) => i >= 0);
}
function cropShape(quad, key) {
  const chosen = state.cropShapes[`${state.frame?.recordId}:${key}`] || "auto";
  if (chosen !== "auto") return chosen;
  if (!quad || quad.length !== 4 || !state.image) return "portrait";
  const edge = (a, b) => Math.hypot((a[0]-b[0])*state.image.width, (a[1]-b[1])*state.image.height);
  const width = edge(quad[0],quad[1]) + edge(quad[3],quad[2]);
  const height = edge(quad[0],quad[3]) + edge(quad[1],quad[2]);
  return width > height ? "landscape" : "portrait";
}
function preview(canvas, q, key) {
  const shape = cropShape(q, key), short = Math.min(canvas.width, canvas.height), long = Math.max(canvas.width, canvas.height);
  const width = shape === "landscape" ? long : short, height = shape === "landscape" ? short : long;
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  canvas.setAttribute("data-shape", shape);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!q || q.length !== 4) return;
  try { const p = G.layerPreview(state.pixels, q, canvas.width, canvas.height, coveringQuads(key), lowerQuads(key), previewMode()); ctx.putImageData(new ImageData(p.data, p.width, p.height), 0, 0); return p; }
  catch { /* invalid quads stay blank */ }
}
function autoVisibility(label) {
  label.cornerVisibility = label.corners.map(([x, y], i) => {
    const outside = x < 0 || x > 1 || y < 0 || y > 1, current = label.cornerVisibility?.[i] || "visible";
    return outside ? "outsideFrame" : current === "outsideFrame" ? "visible" : current;
  });
}
const COLORS = { seeded: "#ffc465", edited: "#f3c969", confirmed: "#58e0a2", skip: "#6b7687", active: "#ff91d4" };
function draw() {
  if (!state.image) return;
  renderLayers();
  const canvas = $("#editor"), f = frameGeom(canvas), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#080c13"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, f.x, f.y, f.w, f.h);
  if ($("#reference-overlay").checked) state.frame.instances.forEach((instance) => {
    if (instance.referencePolygon) outline(ctx, instance.referencePolygon, f, "#ffce71", 1.5, "", [3, 3]);
  });
  state.keys.forEach((key, i) => {
    const t = state.targets[key], selected = i === state.active;
    if (t.skip) { outline(ctx, seedBox(key), f, selected ? COLORS.active : COLORS.skip, selected ? 3 : 1.5, `${cardNumber(i)} skipped`, [6, 4]); return; }
    const color = selected ? COLORS.active : COLORS[t.status];
    outline(ctx, t.corners, f, color, selected ? 3 : t.status === "seeded" ? 1.5 : 2, `${cardNumber(i)}${t.status === "confirmed" ? " ✓" : ""}${t.orientationKnown === false ? " ?" : ""}`, t.status === "seeded" ? [5, 4] : []);
    t.corners.forEach((p, c) => {
      const vis = t.cornerVisibility[c];
      if (selected) handle(ctx, f, p, 8, vis === "visible" ? (c === state.corner ? "#ffc465" : "#58e0a2") : "#9dacbf", ["TL", "TR", "BR", "BL"][c] + (vis === "visible" ? "" : ` (${vis})`));
      else handle(ctx, f, p, 5, vis === "visible" ? color : "#9dacbf", "");
    });
  });
  if (state.pending) {
    if (state.pending.length > 1) outline(ctx, state.pending, f, "#ffb96a", 2);
    state.pending.forEach((p) => handle(ctx, f, p, 5, "#ffb96a", ""));
  }
  const t = activeLabel();
  const activePreview = preview($("#crop"), t?.corners, activeKey());
  const other = state.compareKey, otherPreview = preview($("#other-crop"), state.targets[other]?.corners, other);
  renderPreviewStatus(activePreview, otherPreview);
  renderOverlaps(activePreview);
  const z = $("#zoom"), zc = z.getContext("2d"), p = state.pending?.at(-1) || t?.corners?.[state.corner];
  zc.clearRect(0, 0, z.width, z.height);
  if (p) {
    zc.drawImage(state.image, p[0] * state.image.width - 32, p[1] * state.image.height - 32, 64, 64, 0, 0, z.width, z.height);
    zc.strokeStyle = "#ffc465"; zc.beginPath(); zc.moveTo(100, 110); zc.lineTo(120, 110); zc.moveTo(110, 100); zc.lineTo(110, 120); zc.stroke();
  }
  hint(); targetList(); drawStrip();
}
function drawStrip() {
  const strip = $("#strip");
  strip.replaceChildren(...state.keys.map((key, i) => {
    const t = state.targets[key], c = document.createElement("canvas");
    c.width = 60; c.height = 84;
    c.className = (i === state.active ? "active " : "") + (t.skip ? "skip" : t.status);
    c.title = `Card ${cardNumber(i)} · ${t.skip ? "skipped" : t.status === "seeded" ? "untouched" : t.status === "edited" ? "draft · press C to confirm" : t.cornerSource === "detector" ? "confirmed · bot" : "confirmed"}${t.orientationKnown === false ? " · orientation unknown" : ""} · click to select`;
    if (!t.skip) preview(c, t.corners, key);
    const ctx = c.getContext("2d");
    ctx.font = "bold 11px system-ui"; ctx.fillStyle = "#fff"; ctx.strokeStyle = "#000"; ctx.lineWidth = 3;
    ctx.strokeText(String(cardNumber(i)), 3, 12); ctx.fillText(String(cardNumber(i)), 3, 12);
    c.onclick = () => selectTarget(i);
    return c;
  }));
}
function queueNumber(id = state.frame?.recordId) {
  const index = state.frames.findIndex((f) => f.id === id);
  return index < 0 ? "?" : index + 1;
}
function frameReference() {
  return `F${queueNumber()} / C${cardNumber()} · ${state.frame?.recordId || "?"} · annotation ${activeKey()}`;
}
function hint() {
  const t = activeLabel(), n = cardNumber();
  const pending = state.keys.some((key) => !isLabel(state.targets[key]));
  $("#save-next").textContent = approveOnNext() ? "Approve & next →" : pending ? "Save draft & next →" : "Save & next →";
  $("#save").textContent = approveOnNext() && pending ? "Approve & save" : pending ? "Save draft" : "Save frame";
  $("#hint").textContent = state.pending
    ? `Card ${n}: click the ${CORNER_NAMES[state.pending.length]} corner (${state.pending.length + 1}/4). Escape cancels.`
    : t?.skip ? `Card ${n} is skipped (${t.skip}). Restore card (B) brings its corners back; D redraws them.`
    : approveOnNext() ? `Card ${n}: adjust if needed. Save, Next, or Enter approves and saves all unskipped cards on the page. N approves this card.`
    : t?.status === "seeded" ? `Card ${n}: check the ${state.frame.instances[state.active].seedCorners ? "reference outline" : "box"} and crop. Drag handles if needed; C confirms. D redraws from scratch.${state.frame.instances[state.active].seedSource?.startsWith("reference-polygon-enclosing-box") ? " This is an enclosing box: check each corner carefully." : ""}`
    : t?.status === "edited" ? `Card ${n}: draft changed. Press C to confirm after checking TL → TR → BR → BL; O marks the selected corner hidden.`
    : `Card ${n}: confirmed. Dragging, R, O, or changing orientation makes a draft; press C again to confirm.`;
  $("#draw").textContent = state.pending ? "Cancel drawing" : "Draw corners (D)";
  $("#seed").textContent = t?.skip ? "Restore card (B)" : state.frame.instances[state.active]?.seedCorners ? "Reset to reference (B)" : "Reset to box (B)";
  $("#orientation").checked = t?.corners ? t.orientationKnown : true;
  $("#undo").disabled = !state.undo.length;
  $("#clear").disabled = !t || t.status === "seeded";
  $("#accept").disabled = !!state.pending || !t || !!t.skip || (!['seeded', 'edited'].includes(t.status) && t.cornerSource !== "detector");
}
function targetList() {
  const list = $("#targets");
  list.replaceChildren(...state.keys.map((key, i) => {
    const div = document.createElement("div"), t = state.targets[key];
    div.className = i === state.active ? "active" : "";
    const text = t.skip ? `skipped · ${t.skip}` : t.status === "seeded" ? "not yet labeled" : t.status === "confirmed" ? (t.cornerSource === "detector" ? "confirmed · bot" : "confirmed") : "draft · confirm";
    div.innerHTML = `<span>Card ${cardNumber(i)}</span><span class="${t.skip ? "skipped" : t.status === "confirmed" ? "done" : ""}">${text}</span>`;
    div.onclick = () => selectTarget(i);
    return div;
  }));
  $("#target").replaceChildren(...state.keys.map((key, i) => new Option(`Card ${cardNumber(i)}`, i)));
  $("#target").value = String(state.active);
  const done = state.keys.filter((k) => isLabel(state.targets[k])).length;
  $("#done").textContent = `${done}/${state.keys.length} cards done`;
  $("#frame").title = `${frameReference()} · ${state.frame.sceneSlice} · ${state.frame.sourceArchiveId}`;
  $("#copy-reference").title = frameReference();
}
function snapshot() {
  state.undo.push({ targets: clone(state.targets), active: state.active, corner: state.corner, direction: state.direction, layers: clone(state.layers) });
  if (state.undo.length > 60) state.undo.shift();
}
function dirty() {
  state.dirty = true;
  status("Unsaved changes · Save frame when ready");
  persistDraft();
}
const pendingDraftBackups = new Map();
let draftBackupTimer, draftBackupInFlight = false;
async function flushDraftBackups() {
  if (draftBackupInFlight || !pendingDraftBackups.size) return;
  const batch = new Map(pendingDraftBackups);
  draftBackupInFlight = true;
  try {
    const response = await fetch('/api/draft-backup', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({drafts: Object.fromEntries(batch)}), keepalive: false});
    if (!response.ok) throw Error('Draft backup failed');
    for (const [key, value] of batch) if (pendingDraftBackups.get(key) === value) pendingDraftBackups.delete(key);
    document.querySelector('[data-draft-backup-status]').textContent = 'Draft recovery saved';
  } catch (_) {
    document.querySelector('[data-draft-backup-status]').textContent = 'Draft backup pending — keep this tab open';
  } finally {
    draftBackupInFlight = false;
    if (pendingDraftBackups.size) draftBackupTimer = setTimeout(flushDraftBackups, 5000);
  }
}
function persistDraft() {
  const value = JSON.stringify({ targets: state.targets, occlusionRelations: state.layers, revision: state.frame.label?.revision || 0, notes: $("#notes").value, direction: direction(), unsavedChanges: state.dirty });
  localStorage.setItem(`archive-draft:${state.frame.recordId}`, value);
  pendingDraftBackups.set(state.frame.recordId, value);
  document.querySelector('[data-draft-backup-status]').textContent = 'Draft recovery pending';
  clearTimeout(draftBackupTimer);
  draftBackupTimer = setTimeout(flushDraftBackups, 1000);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) flushDraftBackups(); });
function layerKeys() { return state.keys.filter((k) => state.targets[k]?.corners && !state.targets[k].skip); }
function cardName(key) { return `Card ${cardNumber(state.keys.indexOf(String(key)))}`; }
function relativeLayer(key, other) {
  if (L.above(state.layers, key).includes(Number(other))) return "below";
  if (L.above(state.layers, other).includes(Number(key))) return "above";
  return "unknown";
}
function overlapPairs() {
  const keys = layerKeys().filter((k) => !G.labelQuadError(state.targets[k].corners)), pairs = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (G.quadsOverlap(state.targets[keys[i]].corners, state.targets[keys[j]].corners)) pairs.push([keys[i], keys[j]]);
    }
  }
  return pairs;
}
function renderOverlaps(selected) {
  const key = activeKey(), name = cardName(key), pairs = overlapPairs();
  const others = pairs.filter((pair) => pair.includes(key)).map((pair) => pair.find((k) => k !== key));
  const unknown = others.filter((other) => relativeLayer(key, other) === "unknown");
  const remaining = pairs.filter(([a, b]) => relativeLayer(a, b) === "unknown").length;
  $("#frame-overlaps").textContent = `Whole photo: ${pairs.length} overlapping pair${pairs.length === 1 ? "" : "s"} · ${remaining} order${remaining === 1 ? "" : "s"} still unknown`;
  $("#next-overlap").disabled = !remaining;
  $("#overlap-summary").textContent = activeLabel()?.skip ? `${name} is skipped. Restore it to check overlaps.` : !others.length ? `No other card outlines overlap ${name}.` : `${others.length} card${others.length === 1 ? "" : "s"} overlap${others.length === 1 ? "s" : ""} ${name} · ${unknown.length} order${unknown.length === 1 ? "" : "s"} unknown`;
  $("#preview-coverage").textContent = `${name}: ${Math.round((selected?.coveredFraction || 0) * 100)}% covered by all assigned layers.${unknown.length ? " Unknown overlaps remain unmasked; set their order below." : ""}`;
  $("#overlap-list").replaceChildren(...others.map((other) => {
    const relation = relativeLayer(key, other), otherName = cardName(other);
    const row = document.createElement("div"), crop = document.createElement("canvas"), info = document.createElement("div"), title = document.createElement("strong"), description = document.createElement("p"), buttons = document.createElement("div");
    row.className = `overlap-card ${relation}`;
    crop.width = 90; crop.height = 125; crop.setAttribute("aria-label", `${otherName} rectified preview`);
    preview(crop, state.targets[other].corners, other);
    title.textContent = otherName;
    description.textContent = relation === "unknown" ? `${name} / ${otherName}: order unknown` : `${name} is ${relation.toUpperCase()} ${otherName}`;
    buttons.className = "layer-move-buttons";
    for (const direction of ["above", "below"]) {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = direction === "above" ? "Above ↑" : "Below ↓";
      button.title = `Place ${name} ${direction} ${otherName}`; button.setAttribute("aria-label", button.title);
      button.setAttribute("aria-pressed", String(relation === direction));
      button.onclick = () => setLayer(direction, other);
      buttons.append(button);
    }
    info.append(title, description, buttons); row.append(crop, info); return row;
  }));
}
function nextUnknownOverlap() {
  if (state.busy) return;
  const pairs = overlapPairs(), current = pairs.findIndex((p) => p.includes(activeKey()) && p.includes(state.compareKey));
  for (let step = 1; step <= pairs.length; step++) {
    const pair = pairs[(current + step) % pairs.length];
    if (relativeLayer(...pair) !== "unknown") continue;
    selectTarget(state.keys.indexOf(pair[0])); state.compareKey = pair[1]; draw(); return;
  }
}
function renderLayers() {
  const key = activeKey(), choices = layerKeys().filter((k) => k !== key);
  const single = state.keys.length < 2;
  for (const selector of ["#card-layers", "#preview-mode-control", "#preview-coverage", "#overlap-summary", "#overlap-list", "#overlap-audit", "#any-card-comparison"]) $(selector).hidden = single;
  if (!choices.includes(state.compareKey)) state.compareKey = choices.find((k) => activeLabel()?.corners && G.quadsOverlap(activeLabel().corners, state.targets[k].corners)) || choices[0] || null;
  $("#layer-selected").textContent = cardName(key);
  for (const selector of ["#layer-other", "#preview-other"]) {
    $(selector).replaceChildren(...choices.map((k) => new Option(cardName(k), k)));
    $(selector).value = state.compareKey || "";
  }
  const disabled = !!activeLabel()?.skip || !choices.length;
  for (const selector of ["#layer-other", "#preview-other", "#layer-relation", "#layer-set", "#layer-forward", "#layer-backward"]) $(selector).disabled = disabled;
  $("#layer-list").replaceChildren(...state.layers.map((r, i) => {
    const row = document.createElement("span"), text = document.createElement("span"), remove = document.createElement("button");
    row.className = "layer-chip"; text.textContent = `${cardName(r.above)} above ${cardName(r.below)}`;
    remove.textContent = "×"; remove.type = "button"; remove.title = `Remove ${text.textContent}`;
    remove.setAttribute("aria-label", remove.title);
    remove.onclick = () => { if (state.busy) return; snapshot(); state.layers.splice(i, 1); changed(); };
    row.append(text, remove); return row;
  }));
  $("#layer-empty").hidden = !!state.layers.length;
  const count = coveredCorners().length;
  $("#mark-covered").textContent = count ? `Mark ${count} covered corner${count === 1 ? "" : "s"} hidden` : "No visible corners covered";
  $("#mark-covered").disabled = !count;
}
function renderPreviewStatus(selected, other) {
  const key = activeKey(), reference = state.compareKey, name = cardName(key), otherName = reference == null ? "Other card" : cardName(reference);
  $("#crop-shape").value = state.cropShapes[`${state.frame?.recordId}:${key}`] || "auto";
  $("#crop-title").textContent = `${name} · selected`;
  $("#other-crop-title").textContent = otherName;
  const isBelow = reference != null && L.above(state.layers, key).includes(Number(reference));
  const isAbove = reference != null && L.above(state.layers, reference).includes(Number(key));
  $("#preview-relationship").textContent = !activeLabel()?.corners ? `${name} is skipped · restore it to set its layer.` : reference == null ? "No other card to compare." : isAbove ? `${name} is ABOVE ${otherName}` : isBelow ? `${name} is BELOW ${otherName}` : `${name} / ${otherName}: order not set`;
  $("#layer-forward").title = `Place ${name} above ${otherName}`;
  $("#layer-backward").title = `Place ${name} below ${otherName}`;
  $("#preview-legend").textContent = previewMode() === "layers" ? "Pink hatch: covered by a card above · Green: this card is on top" : previewMode() === "original" ? "Original photo pixels inside each outline; masking is off." : "Checkerboard: covered or outside the photo · Photo pixels: visible card";
}
function setLayer(relation = $("#layer-relation").value, reference = $("#layer-other").value) {
  if (state.busy) return;
  if (!layerKeys().includes(activeKey()) || !layerKeys().includes(String(reference))) return;
  const key = Number(activeKey()), other = Number(reference);
  const [upper, lower] = relation === "below" ? [other, key] : [key, other];
  try {
    const next = L.setRelation(state.layers, upper, lower, layerKeys());
    if (JSON.stringify(next) === JSON.stringify(state.layers)) return;
    snapshot(); state.layers = next; state.compareKey = String(reference); $("#layer-relation").value = relation; changed();
  } catch (e) { status(e.message, true); }
}
function markCovered() {
  if (state.busy) return;
  const corners = coveredCorners(); if (!corners.length) return;
  snapshot(); const t = activeLabel();
  for (const i of corners) t.cornerVisibility[i] = "occluded";
  t.status = "edited"; changed();
}
function changed() { dirty(); draw(); }
function selectTarget(i) {
  if (state.active !== i) state.compareKey = null;
  state.active = Math.max(0, Math.min(state.keys.length - 1, i)); state.corner = 0; state.pending = null;
  if (state.frame) localStorage.setItem(`archive-labeler-last-card:${state.frame.recordId}`, activeKey());
  draw();
}
function nextPending() {
  for (let step = 1; step <= state.keys.length; step++) {
    const i = (state.active + step) % state.keys.length;
    if (!isLabel(state.targets[state.keys[i]])) { selectTarget(i); return; }
  }
  selectTarget((state.active + 1) % state.keys.length);
}
async function advanceCard() {
  if (!approveOnNext()) { nextPending(); return; }
  if (await save(false, [activeKey()])) nextPending();
}
function startDraw() { state.pending = state.pending ? null : []; state.corner = 0; draw(); $("#editor").focus(); }
function rotateActive() {
  const t = activeLabel();
  if (!t?.corners || t.skip) return;
  snapshot(); rotateLabel(t, 1); t.status = "edited"; state.corner = 0; changed();
}
function applyDirection() {
  // Re-seed every untouched box in the newly chosen orientation.
  snapshot();
  state.direction = Number($("#direction").value) || 0;
  for (const key of state.keys) if (state.targets[key].status === "seeded") {
    state.targets[key] = seeded(key);
    state.targets[key].orientationKnown = true;
  }
  changed();
}
function accept() {
  if (state.pending) { status("Finish the four corners or press Escape before confirming.", true); return; }
  const t = activeLabel();
  if (!t || t.skip || (!["seeded", "edited"].includes(t.status) && t.cornerSource !== "detector")) return;
  const error = G.labelQuadError(t.corners);
  if (error) { status(`${error}. Fix the corners before confirming.`, true); return; }
  snapshot(); t.status = "confirmed"; t.cornerSource = "human"; changed(); nextPending();
}
function pointer(e) {
  const c = $("#editor"), r = c.getBoundingClientRect(), f = frameGeom(c);
  const cx = (e.clientX - r.left) * c.width / r.width, cy = (e.clientY - r.top) * c.height / r.height;
  return { canvas: [cx, cy], image: [((cx - f.x) / f.w), ((cy - f.y) / f.h)].map((v) => Math.max(-0.5, Math.min(1.5, v))) };
}
function nearestHandle(f, canvasPoint) {
  let best = null, bestDistance = (14 * f.d) ** 2;
  state.keys.forEach((key, i) => {
    const t = state.targets[key];
    if (!t.corners) return;
    t.corners.forEach((p, c) => {
      const [x, y] = toCanvas(f, p), dist = (canvasPoint[0] - x) ** 2 + (canvasPoint[1] - y) ** 2;
      const bias = i === state.active ? 0 : 1; // the selected card wins ties
      if (dist + bias < bestDistance) { bestDistance = dist + bias; best = [i, c]; }
    });
  });
  return best;
}
function insideTarget(p) {
  for (let i = 0; i < state.keys.length; i++) {
    const t = state.targets[state.keys[i]], q = t.corners || seedBox(state.keys[i]);
    let inside = false;
    for (let a = 0, b = 3; a < 4; b = a++) {
      const [xa, ya] = q[a], [xb, yb] = q[b];
      if ((ya > p[1]) !== (yb > p[1]) && p[0] < ((xb - xa) * (p[1] - ya)) / (yb - ya) + xa) inside = !inside;
    }
    if (inside) return i;
  }
  return null;
}
$("#editor").onpointerdown = (e) => {
  if (!state.image || state.busy) return;
  const c = $("#editor"), { canvas: cp, image: p } = pointer(e);
  c.focus();
  if (state.pending) {
    state.pending.push(p);
    if (state.pending.length === 4) {
      const error = G.labelQuadError(state.pending);
      if (error) { status(`${error}. Start the four points again.`, true); state.pending = []; }
      else {
        snapshot();
        const t = { corners: state.pending, cornerVisibility: ["visible", "visible", "visible", "visible"], orientationKnown: $("#orientation").checked, status: "edited" };
        autoVisibility(t); state.targets[activeKey()] = t; state.pending = null; state.corner = 0; dirty();
      }
    }
    draw(); return;
  }
  const f = frameGeom(c), hit = nearestHandle(f, cp);
  if (hit) {
    snapshot(); state.active = hit[0]; state.corner = hit[1];
    state.drag = { kind: "handle" }; c.setPointerCapture(e.pointerId); draw(); return;
  }
  const inside = insideTarget(p);
  if (inside !== null) { selectTarget(inside); return; }
  state.drag = { kind: "pan", start: [e.clientX, e.clientY], view: { ...state.view } };
  c.setPointerCapture(e.pointerId);
};
$("#editor").onpointermove = (e) => {
  if (!state.drag) return;
  if (state.drag.kind === "pan") {
    state.view.tx = state.drag.view.tx + (e.clientX - state.drag.start[0]);
    state.view.ty = state.drag.view.ty + (e.clientY - state.drag.start[1]);
    draw(); return;
  }
  const t = activeLabel();
  t.corners[state.corner] = pointer(e).image;
  if (["seeded", "confirmed"].includes(t.status)) t.status = "edited";
  autoVisibility(t); draw();
};
function endDrag() {
  if (!state.drag) return;
  const kind = state.drag.kind; state.drag = null;
  if (kind === "handle") changed();
}
$("#editor").onpointerup = endDrag;
$("#editor").onpointercancel = endDrag;
$("#editor").onwheel = (e) => {
  if (!state.image) return;
  e.preventDefault();
  const c = $("#editor"), r = c.getBoundingClientRect(), d = devicePixelRatio || 1, before = frameGeom(c);
  const cx = (e.clientX - r.left) * c.width / r.width, cy = (e.clientY - r.top) * c.height / r.height;
  const ix = (cx - before.x) / before.w, iy = (cy - before.y) / before.h;
  state.view.scale = Math.max(1, Math.min(12, state.view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
  const after = frameGeom(c);
  // Keep the image point under the cursor fixed while zooming.
  state.view.tx += (cx - (after.x + ix * after.w)) / d;
  state.view.ty += (cy - (after.y + iy * after.h)) / d;
  if (state.view.scale === 1) state.view.tx = state.view.ty = 0;
  draw();
};
$("#editor").ondblclick = () => { state.view = { scale: 1, tx: 0, ty: 0 }; draw(); };
$("#editor").onkeydown = (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const key = e.key.toLowerCase();
  if (e.key === "Escape") { state.pending = null; draw(); return; }
  if (key === "d") { e.preventDefault(); startDraw(); return; }
  if (key === "b") { e.preventDefault(); snapshot(); state.targets[activeKey()] = seeded(activeKey()); state.pending = null; changed(); return; }
  if (key === "c") { e.preventDefault(); accept(); return; }
  if (key === "r") { e.preventDefault(); rotateActive(); return; }
  if (key === "n") { e.preventDefault(); advanceCard(); return; }
  if (key === "s") { e.preventDefault(); $("#more-tools").open = true; $("#skip").focus(); return; }
  if (key === "o") {
    const t = activeLabel();
    if (t?.corners && !t.skip) {
      snapshot(); const v = t.cornerVisibility[state.corner];
      t.cornerVisibility[state.corner] = v === "occluded" ? "visible" : v === "visible" ? "occluded" : v;
      if (["seeded", "confirmed"].includes(t.status)) t.status = "edited";
      changed();
    }
    return;
  }
  if (key === "0") { state.view = { scale: 1, tx: 0, ty: 0 }; draw(); return; }
  if (key === "=" || key === "+" || key === "-") {
    state.view.scale = Math.max(1, Math.min(12, state.view.scale * (key === "-" ? 1 / 1.25 : 1.25)));
    if (state.view.scale === 1) state.view.tx = state.view.ty = 0;
    draw(); return;
  }
  if (e.key === "Enter") { e.preventDefault(); save(true); return; }
  if (/^[1-4]$/.test(e.key)) { state.corner = Number(e.key) - 1; draw(); return; }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key], t = activeLabel();
  if (delta && t?.corners && !t.skip) {
    e.preventDefault(); snapshot();
    const q = t.corners[state.corner], step = e.shiftKey ? 5 : 1;
    q[0] = Math.max(-0.5, Math.min(1.5, q[0] + (delta[0] * step) / state.image.width));
    q[1] = Math.max(-0.5, Math.min(1.5, q[1] + (delta[1] * step) / state.image.height));
    if (["seeded", "confirmed"].includes(t.status)) t.status = "edited";
    autoVisibility(t); changed();
  }
};
$("#draw").onclick = startDraw;
$("#seed").onclick = () => { snapshot(); state.targets[activeKey()] = seeded(activeKey()); state.pending = null; changed(); $("#editor").focus(); };
$("#accept").onclick = accept;
$("#rotate").onclick = rotateActive;
$("#reference-overlay").onchange = draw;
$("#crop-shape").onchange = () => {
  state.cropShapes[`${state.frame?.recordId}:${activeKey()}`] = $("#crop-shape").value;
  draw();
};
$("#direction").onchange = () => { if (state.frame) applyDirection(); };
$("#help").onclick = () => { const panel = $("#help-panel"); panel.hidden = !panel.hidden; $("#help").setAttribute("aria-expanded", String(!panel.hidden)); };
document.addEventListener("pointerdown", (e) => { if (!$("#help-panel").hidden && !e.target.closest("#help-panel, #help")) $("#help-panel").hidden = true; });
document.addEventListener("pointerdown", (e) => {
  for (const menu of document.querySelectorAll(".compact-menu[open]")) if (!menu.contains(e.target)) menu.open = false;
});
document.addEventListener("click", (e) => {
  if (e.target.closest("#more-tools button")) $("#more-tools").open = false;
});
$("#clear").onclick = () => { const t = activeLabel(); if (!t || t.status === "seeded") return; snapshot(); state.targets[activeKey()] = seeded(activeKey()); state.pending = null; changed(); };
$("#skip").onchange = () => {
  const reason = $("#skip").value; $("#skip").value = "";
  if (!reason) return;
  snapshot();
  state.layers = state.layers.filter((r) => r.above !== Number(activeKey()) && r.below !== Number(activeKey()));
  state.targets[activeKey()] = { skip: reason }; state.pending = null; changed(); nextPending();
};
function undo() {
  if (!state.undo.length) return;
  const previous = state.undo.pop();
  state.targets = previous.targets; state.active = previous.active; state.corner = previous.corner;
  state.layers = previous.layers || [];
  state.direction = previous.direction; $("#direction").value = String(state.direction);
  state.pending = null; changed();
}
$("#undo").onclick = undo;
$("#orientation").onchange = () => { const t = activeLabel(); if (t?.corners && !t.skip) { snapshot(); t.orientationKnown = $("#orientation").checked; if (["seeded", "confirmed"].includes(t.status)) t.status = "edited"; changed(); } };
$("#target").onchange = () => selectTarget(Number($("#target").value));
$("#notes").addEventListener("input", dirty);

function loadTargets(saved) {
  const targets = {};
  for (const key of state.keys) {
    const s = saved?.[key];
    if (s?.skip) targets[key] = { skip: s.skip };
    else if (s?.corners) targets[key] = { ...clone(s), status: s.status === "seeded" ? "seeded" : s.status || "confirmed" };
    else targets[key] = seeded(key);
  }
  return targets;
}
async function load(id) {
  if (state.busy) return;
  state.busy = true;
  try {
    status("Loading image…");
    const frame = await api(`/api/frame/${id}`), image = new Image();
    // The load event, unlike decode(), also completes in a background tab.
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(Error("Image failed to load")); image.src = `/image/${id}`; });
    state.frame = frame; state.image = image; state.view = { scale: 1, tx: 0, ty: 0 };
    const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
    c.getContext("2d").drawImage(image, 0, 0);
    state.pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    state.keys = frame.instances.map((i) => String(i.sourceAnnotationIndex));
    setDirection(frame.label?.direction ?? localStorage.getItem("archive-labeler-direction") ?? 0);
    state.targets = loadTargets({ ...frame.label?.targets, ...frame.label?.drafts });
    state.layers = clone(frame.label?.occlusionRelations || []);
    state.compareKey = null;
    $("#notes").value = frame.label?.notes || "";
    if (!$("#reviewer").value && frame.label?.reviewer) $("#reviewer").value = frame.label.reviewer;
    state.pending = null; state.undo = []; state.dirty = false; state.corner = 0;
    const draft = JSON.parse(localStorage.getItem(`archive-draft:${id}`) || "null");
    const restoredDraft = draft && draft.revision === (frame.label?.revision || 0);
    if (restoredDraft) { setDirection(draft.direction ?? direction()); state.targets = loadTargets(draft.targets); state.layers = clone(draft.occlusionRelations ?? state.layers); $("#notes").value = draft.notes || ""; state.dirty = draft.unsavedChanges !== false; }
    const firstPending = state.keys.findIndex((k) => !isLabel(state.targets[k]));
    state.active = firstPending >= 0 ? firstPending : 0;
    const rememberedCard = localStorage.getItem(`archive-labeler-last-card:${id}`);
    const rememberedIndex = rememberedCard == null ? -1 : state.keys.indexOf(rememberedCard);
    if (rememberedIndex >= 0) state.active = rememberedIndex;
    localStorage.setItem("archive-labeler-last-frame", id);
    // Previous can enter a completed frame omitted by Incomplete only.
    state.filtered = filteredFrames(id);
    renderFrameOptions();
    draw();
    status(restoredDraft ? (state.dirty ? "Restored unsaved draft" : "Restored browser draft · confirm cards when ready") : frame.label ? `Saved by ${frame.label.reviewer} · revision ${frame.label.revision}${frame.label.complete ? " · complete" : " · incomplete"}` : approveOnNext() ? "Ready · adjust if needed; Next approves and saves the page" : "Ready · adjust corners, check the preview, then press C to confirm");
    $("#editor").focus();
  } catch (e) { status(e.message, true); }
  finally { state.busy = false; }
}
function canLeave() { return !state.dirty || confirm("This frame has unsaved changes. Leave it as a draft and continue?"); }
function progress(p) {
  $("#progress").textContent = `${p.framesComplete}/${p.frames} photos · ${p.targetsLabeled + p.targetsSkipped}/${p.targets} cards`;
  $("#progress").title = `${p.targetsLabeled} labeled · ${p.targetsSkipped} skipped · ${p.framesComplete} photos complete`;
}
function matchesReviewBatch(frame) { return !state.reviewNumbers || state.reviewNumbers.has(queueNumber(frame.id)); }
function renderReviewBatch() {
  $("#review-batch").hidden = !state.reviewNumbers;
  if (!state.reviewNumbers) return;
  const frames = state.frames.filter(matchesReviewBatch);
  const position = frames.findIndex((f) => f.id === state.frame?.recordId);
  $("#review-position").textContent = `Review batch · ${position < 0 ? `${frames.length} photos` : `Photo ${position + 1} of ${frames.length}`}`;
}
function configureReviewBatch() {
  for (const selector of ["#filter-scene", "#filter-color", "#filter-multiple", "#incomplete"]) $(selector).disabled = !!state.reviewNumbers;
  if (state.reviewNumbers) {
    $("#filter-scene").value = "all";
    $("#filter-color").value = "color";
    $("#filter-multiple").checked = false;
    $("#incomplete").checked = false;
  } else {
    $("#filter-multiple").checked = localStorage.getItem("archive-labeler-multiple-filter") === "true";
  }
  renderReviewBatch();
}
function renderFrameOptions() {
  $("#frame").replaceChildren(...state.filtered.map((f) => new Option(`${f.complete ? "✓ " : f.saved ? "… " : ""}F${queueNumber(f.id)} · ${f.scene.replace("multi_card_", "").replace("_archive", "")} · ${f.archive.replace("coco:", "").slice(0, 22)} · ${f.targets} cards${f.colorMode === "grayscale" ? " · B&W" : ""}`, f.id)));
  if (state.frame && state.filtered.some((f) => f.id === state.frame.recordId)) $("#frame").value = state.frame.recordId;
  renderReviewBatch();
}
function filter() {
  const currentId = state.frame?.recordId || localStorage.getItem("archive-labeler-last-frame");
  state.filtered = filteredFrames(currentId);
  renderFrameOptions();
  $("main").hidden = !state.filtered.length;
  $("#save").disabled = !state.filtered.length; $("#save-next").disabled = !state.filtered.length;
  if (state.filtered.length) {
    const preferred = state.frame?.recordId || localStorage.getItem("archive-labeler-last-frame");
    load(state.filtered.some((f) => f.id === preferred) ? preferred : state.filtered[0].id);
  }
  else { state.frame = null; state.image = null; state.dirty = false; $("#done").textContent = ""; status(state.reviewNumbers ? "No photos match this review batch." : "All frames in this selection are complete."); }
}
function filteredFrames(currentId = state.frame?.recordId || localStorage.getItem("archive-labeler-last-frame")) {
  return state.frames.filter((f) => matchesReviewBatch(f) && matchesPhotoFilter(f) && ($("#filter-scene").value === "all" || f.scene === $("#filter-scene").value) && (!$("#incomplete").checked || !f.complete || f.id === currentId));
}
function matchesPhotoFilter(frame) {
  if ($("#filter-multiple").checked && !(frame.targets > 1)) return false;
  const mode = $("#filter-color").value;
  // Keep unknown images available if the optional Pillow dependency is absent.
  return mode === "all" || (mode === "grayscale" ? frame.colorMode === "grayscale" : frame.colorMode !== "grayscale");
}
function navigate(delta, afterSave = false) {
  if (state.busy) return;
  if (delta > 0 && !afterSave && approveOnNext()) return save(true);
  if (!canLeave()) return;
  const next = orderedNeighbor(delta);
  if (next) load(next.id); else status(delta > 0 ? (state.reviewNumbers ? "End of review batch · use Previous to revisit photos." : "End of this selection") : "Start of this selection");
}
function orderedNeighbor(delta) {
  const current = state.frames.findIndex((f) => f.id === state.frame?.recordId);
  for (let i = current + delta; i >= 0 && i < state.frames.length; i += delta) {
    const f = state.frames[i], sceneOK = $("#filter-scene").value === "all" || f.scene === $("#filter-scene").value;
    const incompleteOK = delta < 0 || !$("#incomplete").checked || !f.complete;
    if (sceneOK && incompleteOK && matchesPhotoFilter(f) && matchesReviewBatch(f)) return f;
  }
  return null;
}
function payloadTargets(approveKeys = []) {
  // Only confirmed cards, skips, and explicitly approved cards are labels.
  // Unconfirmed geometry is sent separately as drafts.
  const out = {};
  for (const [key, t] of Object.entries(state.targets)) {
    if (t.skip) out[key] = { skip: t.skip };
    else if (t.status === "confirmed" || approveKeys.includes(key)) {
      const error = G.labelQuadError(t.corners);
      if (error) throw Error(`Card ${cardNumber(state.keys.indexOf(key))}: ${error}`);
      out[key] = { corners: t.corners, cornerVisibility: t.cornerVisibility, orientationKnown: t.orientationKnown, cornerSource: approveKeys.includes(key) ? "human" : (t.cornerSource || "human"), status: "confirmed" };
    }
  }
  return out;
}
function payloadDrafts(approveKeys = []) {
  return Object.fromEntries(Object.entries(state.targets).filter(([key, t]) =>
    !t.skip && ["seeded", "edited"].includes(t.status) && !approveKeys.includes(key)
  ).map(([key, t]) => [key, clone(t)]));
}
function hasDrafts() { return Object.values(state.targets).some((t) => t.status === "seeded" || t.status === "edited"); }
async function save(next, approveKeys = approveOnNext() ? state.keys : []) {
  if (!state.frame || state.busy) return false;
  if (state.pending) { status("Finish the four corners or press Escape before saving.", true); return false; }
  state.busy = true;
  try {
    // Stage approval in the request. Failed saves leave the local drafts pending.
    const submitted = clone(state.targets), targets = payloadTargets(approveKeys), drafts = payloadDrafts(approveKeys);
    const layerError = L.error(state.layers, layerKeys()); if (layerError) throw Error(layerError);
    const r = await api(`/api/label/${state.frame.recordId}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer: $("#reviewer").value, notes: $("#notes").value, targets, drafts, occlusionRelations: state.layers, revision: state.frame.label?.revision || 0, direction: direction() }) });
    for (const key of approveKeys) {
      if (targets[key]?.corners && JSON.stringify(state.targets[key]) === JSON.stringify(submitted[key])) { state.targets[key].status = "confirmed"; state.targets[key].cornerSource = "human"; }
    }
    localStorage.setItem("archive-labeler-direction", String(direction()));
    state.frame.label = r;
    state.dirty = false;
    if (hasDrafts()) {
      persistDraft();
    } else localStorage.removeItem(`archive-draft:${r.recordId}`);
    if ($("#reviewer").value.trim()) localStorage.setItem("archive-labeler-reviewer", r.reviewer);
    showReviewer();
    const row = state.frames.find((f) => f.id === r.recordId); row.saved = true; row.complete = r.complete;
    const summary = await api("/api/frames"); progress(summary.progress);
    state.frames = summary.frames;
    const selectedId = state.frame.recordId;
    state.filtered = filteredFrames(selectedId);
    renderFrameOptions();
    $("#frame").value = selectedId;
    const pending = state.keys.filter((k) => !isLabel(state.targets[k])).length;
    status(r.complete ? "Frame saved · complete" : `Frame and drafts saved · ${pending} card${pending === 1 ? "" : "s"} pending confirmation`);
    state.busy = false;
    if (next) navigate(1, true);
    return true;
  } catch (e) { status(e.message, true); return false; }
  finally { state.busy = false; }
}
for (const selector of ["#filter-scene", "#incomplete"]) $(selector).onchange = () => { if (canLeave()) filter(); };
$("#filter-color").onchange = () => {
  if (!canLeave()) { $("#filter-color").value = localStorage.getItem("archive-labeler-color-filter") || "color"; return; }
  localStorage.setItem("archive-labeler-color-filter", $("#filter-color").value);
  filter();
};
$("#filter-multiple").onchange = () => {
  if (!canLeave()) { $("#filter-multiple").checked = localStorage.getItem("archive-labeler-multiple-filter") === "true"; return; }
  localStorage.setItem("archive-labeler-multiple-filter", String($("#filter-multiple").checked));
  filter();
};
$("#frame").onchange = () => { if (canLeave()) load($("#frame").value); else $("#frame").value = state.frame.recordId; };
$("#previous").onclick = () => navigate(-1);
$("#next").onclick = () => navigate(1);
$("#save").onclick = () => save(false);
$("#save-next").onclick = () => save(true);
$("#layer-set").onclick = () => setLayer();
$("#layer-forward").onclick = () => setLayer("above");
$("#layer-backward").onclick = () => setLayer("below");
$("#next-overlap").onclick = nextUnknownOverlap;
for (const selector of ["#layer-other", "#preview-other"]) $(selector).onchange = () => { state.compareKey = $(selector).value; draw(); };
$("#mark-covered").onclick = markCovered;
$("#preview-mode").onchange = () => { localStorage.setItem("archive-labeler-preview-mode", previewMode()); draw(); };
$("#approve-next").onchange = () => {
  localStorage.setItem("archive-labeler-approve-next", String(approveOnNext()));
  if (state.frame) hint();
};
$("#copy-reference").onclick = async () => {
  const ref = frameReference();
  try { await navigator.clipboard.writeText(ref); status(`Copied ${ref}`); }
  catch { status(ref); }
};
$("#review-all").onclick = () => {
  if (!canLeave()) return;
  const url = new URL(window.location.href); url.searchParams.delete("review");
  window.history.replaceState(null, "", url);
  state.reviewNumbers = null;
  configureReviewBatch(); filter();
};
window.addEventListener("resize", draw);
window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });
api("/api/frames").then((r) => {
  defaultReviewer = r.defaultReviewer || ""; showReviewer(); state.frames = r.frames;
  const presentation = r.presentation;
  if (presentation?.kind === "reference-corners") {
    document.title = presentation.title;
    $("#studio-title").textContent = presentation.title;
    $("#studio-subtitle").textContent = presentation.subtitle;
    $("#reference-intro").hidden = false;
    $("#reference-description").textContent = presentation.description;
    $("#reference-overlay-control").hidden = false;
    $("#model-review-link").href = presentation.modelReviewUrl;
    $("#model-review-link").textContent = "Model comparison →";
    if (!savedColorFilter) $("#filter-color").value = presentation.defaultColorFilter;
  }
  progress(r.progress); configureReviewBatch(); filter();
}).catch((e) => status(e.message, true));

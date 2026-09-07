"use strict";
const $ = (s) => document.querySelector(s);
const G = window.CardEditorGeometry;
const clone = (x) => JSON.parse(JSON.stringify(x));
const CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"];
// Every queued card starts as a movable outline seeded from its box ("seeded").
// It becomes a label only once a handle moves ("edited") or you accept it
// ("confirmed"); seeded outlines are never saved as human corners.
const state = {
  frames: [], filtered: [], frame: null, image: null, pixels: null,
  targets: {}, keys: [], active: 0, corner: 0, pending: null, undo: [], dirty: false,
  drag: null, busy: false, view: { scale: 1, tx: 0, ty: 0 },
};
$("#reviewer").value = localStorage.getItem("archive-labeler-reviewer") || "";

function status(message, error = false) { $("#status").textContent = message; $("#status").className = error ? "error" : ""; }
async function api(url, options) {
  const r = await fetch(url, options), j = await r.json();
  if (!r.ok) throw Error(j.error || r.statusText);
  return j;
}
function activeKey() { return state.keys[state.active]; }
function activeLabel() { return state.targets[activeKey()]; }
function seedBox(key) {
  const b = state.frame.instances.find((i) => String(i.sourceAnnotationIndex) === key).seedBox;
  return [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];
}
function seeded(key) {
  return { corners: seedBox(key), cornerVisibility: ["visible", "visible", "visible", "visible"], orientationKnown: true, status: "seeded" };
}
function isLabel(t) { return t && (t.skip || t.status === "edited" || t.status === "confirmed"); }
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
function preview(canvas, q) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!q || q.length !== 4) return;
  try { const p = G.rectify(state.pixels, q, canvas.width, canvas.height); ctx.putImageData(new ImageData(p.data, p.width, p.height), 0, 0); }
  catch { /* invalid quads stay blank */ }
}
function autoVisibility(label) {
  label.cornerVisibility = label.corners.map(([x, y], i) => {
    const outside = x < 0 || x > 1 || y < 0 || y > 1, current = label.cornerVisibility?.[i] || "visible";
    return outside ? "outsideFrame" : current === "outsideFrame" ? "visible" : current;
  });
}
const COLORS = { seeded: "#ffc465", edited: "#58e0a2", confirmed: "#58e0a2", skip: "#6b7687", active: "#ff91d4" };
function draw() {
  if (!state.image) return;
  const canvas = $("#editor"), f = frameGeom(canvas), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#080c13"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, f.x, f.y, f.w, f.h);
  state.keys.forEach((key, i) => {
    const t = state.targets[key], selected = i === state.active;
    if (t.skip) { outline(ctx, seedBox(key), f, selected ? COLORS.active : COLORS.skip, selected ? 3 : 1.5, `${i + 1} skipped`, [6, 4]); return; }
    const color = selected ? COLORS.active : COLORS[t.status];
    outline(ctx, t.corners, f, color, selected ? 3 : t.status === "seeded" ? 1.5 : 2, `${i + 1}${t.status === "seeded" ? "" : " ✓"}`, t.status === "seeded" ? [5, 4] : []);
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
  preview($("#crop"), t?.corners);
  const z = $("#zoom"), zc = z.getContext("2d"), p = state.pending?.at(-1) || t?.corners?.[state.corner];
  zc.clearRect(0, 0, z.width, z.height);
  if (p) {
    zc.drawImage(state.image, p[0] * state.image.width - 32, p[1] * state.image.height - 32, 64, 64, 0, 0, z.width, z.height);
    zc.strokeStyle = "#ffc465"; zc.beginPath(); zc.moveTo(100, 110); zc.lineTo(120, 110); zc.moveTo(110, 100); zc.lineTo(110, 120); zc.stroke();
  }
  hint(); targetList();
}
function hint() {
  const t = activeLabel(), n = state.active + 1;
  $("#hint").textContent = state.pending
    ? `Card ${n}: click the ${CORNER_NAMES[state.pending.length]} corner (${state.pending.length + 1}/4). Escape cancels.`
    : t?.skip ? `Card ${n} is skipped (${t.skip}). Press B or D to label it after all.`
    : t?.status === "seeded" ? `Card ${n}: drag its handles onto the real corners, or press C if the box already fits. D redraws from scratch.`
    : `Card ${n}: labeled. Drag handles to refine, O marks the selected corner hidden, N goes to the next card.`;
  $("#draw").textContent = state.pending ? "Cancel drawing" : "Draw corners (D)";
  $("#orientation").checked = t?.corners ? t.orientationKnown : true;
  $("#undo").disabled = !state.undo.length;
  $("#clear").disabled = !t || t.status === "seeded";
  $("#accept").disabled = !t || !!t.skip || t.status !== "seeded";
}
function targetList() {
  const list = $("#targets");
  list.replaceChildren(...state.keys.map((key, i) => {
    const div = document.createElement("div"), t = state.targets[key];
    div.className = i === state.active ? "active" : "";
    const text = t.skip ? `skipped · ${t.skip}` : t.status === "seeded" ? "not yet labeled" : t.status === "confirmed" ? "accepted" : "adjusted";
    div.innerHTML = `<span>Card ${i + 1}</span><span class="${t.skip ? "skipped" : t.status === "seeded" ? "" : "done"}">${text}</span>`;
    div.onclick = () => selectTarget(i);
    return div;
  }));
  $("#target").replaceChildren(...state.keys.map((key, i) => new Option(`Card ${i + 1}`, i)));
  $("#target").value = String(state.active);
  const done = state.keys.filter((k) => isLabel(state.targets[k])).length;
  $("#record").textContent = `${state.frame.sceneSlice} · ${state.frame.sourceArchiveId} · ${state.frame.recordId.slice(-16)} · ${done}/${state.keys.length} cards done`;
}
function snapshot() { state.undo.push(clone(state.targets)); if (state.undo.length > 60) state.undo.shift(); }
function dirty() {
  state.dirty = true;
  status("Unsaved changes · Save frame when ready");
  localStorage.setItem(`archive-draft:${state.frame.recordId}`, JSON.stringify({ targets: state.targets, revision: state.frame.label?.revision || 0, notes: $("#notes").value }));
}
function changed() { dirty(); draw(); }
function selectTarget(i) { state.active = Math.max(0, Math.min(state.keys.length - 1, i)); state.corner = 0; state.pending = null; draw(); }
function nextPending() {
  for (let step = 1; step <= state.keys.length; step++) {
    const i = (state.active + step) % state.keys.length;
    if (!isLabel(state.targets[state.keys[i]])) { selectTarget(i); return; }
  }
  selectTarget((state.active + 1) % state.keys.length);
}
function startDraw() { state.pending = state.pending ? null : []; state.corner = 0; draw(); $("#editor").focus(); }
function accept() {
  const t = activeLabel();
  if (!t || t.skip || t.status !== "seeded") return;
  snapshot(); t.status = "confirmed"; changed(); nextPending();
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
      const error = G.validQuad(state.pending);
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
  if (t.status === "seeded") t.status = "edited";
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
  if (key === "n") { e.preventDefault(); nextPending(); return; }
  if (key === "s") { e.preventDefault(); $("#skip").focus(); return; }
  if (key === "o") {
    const t = activeLabel();
    if (t?.corners && !t.skip) {
      snapshot(); const v = t.cornerVisibility[state.corner];
      t.cornerVisibility[state.corner] = v === "occluded" ? "visible" : v === "visible" ? "occluded" : v;
      if (t.status === "seeded") t.status = "edited";
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
    if (t.status === "seeded") t.status = "edited";
    autoVisibility(t); changed();
  }
};
$("#draw").onclick = startDraw;
$("#seed").onclick = () => { snapshot(); state.targets[activeKey()] = seeded(activeKey()); state.pending = null; changed(); $("#editor").focus(); };
$("#accept").onclick = accept;
$("#clear").onclick = () => { const t = activeLabel(); if (!t || t.status === "seeded") return; snapshot(); state.targets[activeKey()] = seeded(activeKey()); state.pending = null; changed(); };
$("#skip").onchange = () => {
  const reason = $("#skip").value; $("#skip").value = "";
  if (!reason) return;
  snapshot(); state.targets[activeKey()] = { skip: reason }; state.pending = null; changed(); nextPending();
};
$("#undo").onclick = () => { if (!state.undo.length) return; state.targets = state.undo.pop(); state.pending = null; changed(); };
$("#orientation").onchange = () => { const t = activeLabel(); if (t?.corners && !t.skip) { snapshot(); t.orientationKnown = $("#orientation").checked; if (t.status === "seeded") t.status = "edited"; changed(); } };
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
    image.src = `/image/${id}`;
    await image.decode();
    state.frame = frame; state.image = image; state.view = { scale: 1, tx: 0, ty: 0 };
    const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
    c.getContext("2d").drawImage(image, 0, 0);
    state.pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    state.keys = frame.instances.map((i) => String(i.sourceAnnotationIndex));
    state.targets = loadTargets(frame.label?.targets);
    $("#notes").value = frame.label?.notes || "";
    if (frame.label?.reviewer) $("#reviewer").value = frame.label.reviewer;
    state.pending = null; state.undo = []; state.dirty = false; state.corner = 0;
    const draft = JSON.parse(localStorage.getItem(`archive-draft:${id}`) || "null");
    if (draft && draft.revision === (frame.label?.revision || 0)) { state.targets = loadTargets(draft.targets); $("#notes").value = draft.notes || ""; state.dirty = true; }
    const firstPending = state.keys.findIndex((k) => !isLabel(state.targets[k]));
    state.active = firstPending >= 0 ? firstPending : 0;
    $("#frame").value = id;
    draw();
    status(state.dirty ? "Restored unsaved draft" : frame.label ? `Saved by ${frame.label.reviewer} · revision ${frame.label.revision}${frame.label.complete ? " · complete" : " · incomplete"}` : "Ready · drag any handle, or press C to accept a box that already fits");
    $("#editor").focus();
  } catch (e) { status(e.message, true); }
  finally { state.busy = false; }
}
function canLeave() { return !state.dirty || confirm("This frame has unsaved changes. Leave it as a draft and continue?"); }
function progress(p) { $("#progress").textContent = `${p.framesComplete}/${p.frames} frames complete · ${p.targetsLabeled} labeled · ${p.targetsSkipped} skipped of ${p.targets} cards`; }
function filter() {
  state.filtered = state.frames.filter((f) => ($("#filter-scene").value === "all" || f.scene === $("#filter-scene").value) && (!$("#incomplete").checked || !f.complete));
  $("#frame").replaceChildren(...state.filtered.map((f, i) => new Option(`${f.complete ? "✓ " : f.saved ? "… " : ""}${i + 1} · ${f.scene.replace("multi_card_", "").replace("_archive", "")} · ${f.archive.replace("coco:", "").slice(0, 22)} · ${f.targets} cards`, f.id)));
  $("main").hidden = !state.filtered.length;
  $("#save").disabled = !state.filtered.length; $("#save-next").disabled = !state.filtered.length;
  if (state.filtered.length) load(state.filtered.some((f) => f.id === state.frame?.recordId) ? state.frame.recordId : state.filtered[0].id);
  else { state.frame = null; state.image = null; state.dirty = false; $("#record").textContent = "Nothing left in this selection"; status("All frames in this selection are complete."); }
}
function navigate(delta) {
  if (state.busy || !canLeave()) return;
  const i = state.filtered.findIndex((f) => f.id === state.frame?.recordId), next = state.filtered[i + delta];
  if (next) load(next.id); else status(delta > 0 ? "End of this selection" : "Start of this selection");
}
function payloadTargets() {
  // Only adjusted, accepted or skipped cards leave the browser; seeded boxes stay pending.
  const out = {};
  for (const [key, t] of Object.entries(state.targets)) {
    if (t.skip) out[key] = { skip: t.skip };
    else if (t.status !== "seeded") out[key] = { corners: t.corners, cornerVisibility: t.cornerVisibility, orientationKnown: t.orientationKnown, status: t.status };
  }
  return out;
}
async function save(next) {
  if (!state.frame || state.busy) return;
  if (state.pending) { status("Finish the four corners or press Escape before saving.", true); return; }
  state.busy = true;
  try {
    const r = await api(`/api/label/${state.frame.recordId}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer: $("#reviewer").value, notes: $("#notes").value, targets: payloadTargets(), revision: state.frame.label?.revision || 0 }) });
    state.frame.label = r; state.dirty = false;
    localStorage.removeItem(`archive-draft:${r.recordId}`);
    localStorage.setItem("archive-labeler-reviewer", r.reviewer);
    const row = state.frames.find((f) => f.id === r.recordId); row.saved = true; row.complete = r.complete;
    const summary = await api("/api/frames"); progress(summary.progress);
    const pending = state.keys.filter((k) => !isLabel(state.targets[k])).length;
    status(r.complete ? "Frame saved · complete" : `Frame saved · ${pending} card${pending === 1 ? "" : "s"} still untouched (drag or press C to accept)`);
    state.busy = false;
    if (next) { if (r.complete && $("#incomplete").checked) filter(); else navigate(1); }
  } catch (e) { status(e.message, true); }
  finally { state.busy = false; }
}
for (const selector of ["#filter-scene", "#incomplete"]) $(selector).onchange = () => { if (canLeave()) filter(); };
$("#frame").onchange = () => { if (canLeave()) load($("#frame").value); else $("#frame").value = state.frame.recordId; };
$("#previous").onclick = () => navigate(-1);
$("#next").onclick = () => navigate(1);
$("#save").onclick = () => save(false);
$("#save-next").onclick = () => save(true);
window.addEventListener("resize", draw);
window.addEventListener("beforeunload", (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ""; } });
api("/api/frames").then((r) => { state.frames = r.frames; progress(r.progress); filter(); }).catch((e) => status(e.message, true));

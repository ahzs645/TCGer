"use strict";
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const G = window.CardEditorGeometry;
const clone = (x) => JSON.parse(JSON.stringify(x));
const CORNER_NAMES = ["top-left", "top-right", "bottom-right", "bottom-left"];
const state = {
  frames: [], filtered: [], frame: null, image: null, pixels: null,
  targets: {}, // key -> {corners, cornerVisibility, orientationKnown} | {skip}
  keys: [], active: 0, corner: 0, pending: null, undo: [], dirty: false, dragging: false, busy: false,
};
$("#reviewer").value = localStorage.getItem("archive-labeler-reviewer") || "";

function status(message, error = false) {
  $("#status").textContent = message;
  $("#status").className = error ? "error" : "";
}
async function api(url, options) {
  const r = await fetch(url, options), j = await r.json();
  if (!r.ok) throw Error(j.error || r.statusText);
  return j;
}
function activeKey() { return state.keys[state.active]; }
function activeLabel() { return state.targets[activeKey()]; }
function seedBox(key) {
  const t = state.frame.instances.find((i) => String(i.sourceAnnotationIndex) === key);
  const b = t.seedBox;
  return [[b.left, b.top], [b.right, b.top], [b.right, b.bottom], [b.left, b.bottom]];
}
function frameGeom(canvas, margin = 0.08) {
  const r = canvas.getBoundingClientRect(), d = devicePixelRatio || 1;
  canvas.width = Math.round(r.width * d);
  canvas.height = Math.round(r.height * d);
  const s = Math.min(canvas.width / (state.image.width * (1 + 2 * margin)), canvas.height / (state.image.height * (1 + 2 * margin)));
  return { x: (canvas.width - state.image.width * s) / 2, y: (canvas.height - state.image.height * s) / 2, w: state.image.width * s, h: state.image.height * s, d };
}
function outline(ctx, q, f, color, width = 2, label = "", dash = []) {
  if (!q || !q.length) return;
  ctx.setLineDash(dash.map((v) => v * f.d));
  ctx.beginPath();
  q.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](f.x + x * f.w, f.y + y * f.h));
  ctx.closePath();
  ctx.strokeStyle = color; ctx.lineWidth = width * f.d; ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.font = `${13 * f.d}px system-ui`; ctx.fillStyle = color;
    ctx.fillText(label, f.x + q[0][0] * f.w + 5 * f.d, f.y + q[0][1] * f.h - 6 * f.d);
  }
}
function preview(canvas, q) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!q || q.length !== 4) return;
  try {
    const p = G.rectify(state.pixels, q, canvas.width, canvas.height);
    ctx.putImageData(new ImageData(p.data, p.width, p.height), 0, 0);
  } catch { /* invalid quads stay blank */ }
}
function autoVisibility(label) {
  label.cornerVisibility = label.corners.map(([x, y], i) => {
    const outside = x < 0 || x > 1 || y < 0 || y > 1;
    const current = label.cornerVisibility?.[i] || "visible";
    if (outside) return "outsideFrame";
    return current === "outsideFrame" ? "visible" : current;
  });
}
function draw() {
  if (!state.image) return;
  const canvas = $("#editor"), f = frameGeom(canvas), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#080c13"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, f.x, f.y, f.w, f.h);
  state.keys.forEach((key, i) => {
    const label = state.targets[key], selected = i === state.active;
    if (label?.corners) {
      outline(ctx, label.corners, f, selected ? "#ff91d4" : "#58e0a2", selected ? 3 : 2, `${i + 1}`);
      if (selected) label.corners.forEach(([x, y], c) => {
        ctx.beginPath(); ctx.arc(f.x + x * f.w, f.y + y * f.h, 8 * f.d, 0, 2 * Math.PI);
        ctx.fillStyle = label.cornerVisibility[c] === "visible" ? (c === state.corner ? "#ffc465" : "#58e0a2") : "#9dacbf";
        ctx.fill();
        ctx.font = `${12 * f.d}px system-ui`; ctx.fillStyle = "#fff";
        ctx.fillText(["TL", "TR", "BR", "BL"][c] + (label.cornerVisibility[c] === "visible" ? "" : ` (${label.cornerVisibility[c]})`), f.x + x * f.w + 10 * f.d, f.y + y * f.h - 10 * f.d);
      });
    } else {
      const color = label?.skip ? "#6b7687" : selected ? "#ff91d4" : "#ffc465";
      outline(ctx, seedBox(key), f, color, selected ? 3 : 1.5, `${i + 1}${label?.skip ? " skipped" : ""}`, [6, 4]);
    }
  });
  if (state.pending) {
    outline(ctx, state.pending, f, "#ffb96a", 2);
    state.pending.forEach(([x, y]) => { ctx.fillStyle = "#ffb96a"; ctx.fillRect(f.x + x * f.w - 4 * f.d, f.y + y * f.h - 4 * f.d, 8 * f.d, 8 * f.d); });
  }
  const label = activeLabel();
  preview($("#crop"), label?.corners);
  const z = $("#zoom"), zc = z.getContext("2d");
  const p = state.pending?.at(-1) || label?.corners?.[state.corner];
  zc.clearRect(0, 0, z.width, z.height);
  if (p) {
    zc.drawImage(state.image, p[0] * state.image.width - 32, p[1] * state.image.height - 32, 64, 64, 0, 0, z.width, z.height);
    zc.strokeStyle = "#ffc465"; zc.beginPath(); zc.moveTo(100, 110); zc.lineTo(120, 110); zc.moveTo(110, 100); zc.lineTo(110, 120); zc.stroke();
  }
  hint();
  targetList();
}
function hint() {
  const label = activeLabel();
  $("#hint").textContent = state.pending
    ? `Card ${state.active + 1}: click the ${CORNER_NAMES[state.pending.length]} corner (${state.pending.length + 1}/4). Escape cancels.`
    : label?.corners ? `Card ${state.active + 1}: drag a handle to refine, O marks the selected corner hidden, N goes to the next card.`
    : label?.skip ? `Card ${state.active + 1} is skipped (${label.skip}). Draw corners to un-skip.`
    : `Card ${state.active + 1}: press D to click four corners or B to seed from the box.`;
  $("#draw").textContent = state.pending ? "Cancel drawing" : "Draw corners (D)";
  $("#orientation").checked = label?.corners ? label.orientationKnown : true;
  $("#undo").disabled = !state.undo.length;
  $("#clear").disabled = !label;
}
function targetList() {
  const list = $("#targets");
  list.replaceChildren(...state.keys.map((key, i) => {
    const div = document.createElement("div"), label = state.targets[key];
    div.className = i === state.active ? "active" : "";
    const stateText = label?.corners ? "labeled" : label?.skip ? `skipped · ${label.skip}` : "pending";
    div.innerHTML = `<span>Card ${i + 1} · index ${key}</span><span class="${label?.corners ? "done" : label?.skip ? "skipped" : ""}">${stateText}</span>`;
    div.onclick = () => { selectTarget(i); };
    return div;
  }));
  $("#target").replaceChildren(...state.keys.map((key, i) => new Option(`Card ${i + 1} · index ${key}`, i)));
  $("#target").value = String(state.active);
  const done = state.keys.filter((k) => state.targets[k]).length;
  $("#record").textContent = `${state.frame.sceneSlice} · ${state.frame.sourceArchiveId} · ${state.frame.recordId.slice(-16)} · ${done}/${state.keys.length} cards done`;
}
function snapshot() { state.undo.push(clone(state.targets)); if (state.undo.length > 40) state.undo.shift(); }
function dirty() {
  state.dirty = true;
  status("Unsaved changes · Save frame when ready");
  localStorage.setItem(`archive-draft:${state.frame.recordId}`, JSON.stringify({ targets: state.targets, revision: state.frame.label?.revision || 0, notes: $("#notes").value }));
}
function changed() { dirty(); draw(); }
function selectTarget(i) {
  state.active = Math.max(0, Math.min(state.keys.length - 1, i)); state.corner = 0; state.pending = null; draw();
}
function nextPending() {
  const start = state.active;
  for (let step = 1; step <= state.keys.length; step++) {
    const i = (start + step) % state.keys.length;
    if (!state.targets[state.keys[i]]) { selectTarget(i); return; }
  }
  selectTarget((start + 1) % state.keys.length);
}
function startDraw() { state.pending = state.pending ? null : []; state.corner = 0; draw(); $("#editor").focus(); }
function seedFromBox() {
  snapshot();
  const label = { corners: seedBox(activeKey()), cornerVisibility: ["visible", "visible", "visible", "visible"], orientationKnown: true };
  autoVisibility(label);
  state.targets[activeKey()] = label; state.pending = null; state.corner = 0; changed(); $("#editor").focus();
}
function pointer(e) {
  const c = $("#editor"), r = c.getBoundingClientRect(), f = frameGeom(c);
  return [(((e.clientX - r.left) * c.width) / r.width - f.x) / f.w, (((e.clientY - r.top) * c.height) / r.height - f.y) / f.h]
    .map((v) => Math.max(-0.5, Math.min(1.5, v)));
}
function hitTarget(p) {
  // Prefer a labeled quad or seed box containing the point; nearest center otherwise.
  let best = null, bestDistance = Infinity;
  state.keys.forEach((key, i) => {
    const q = state.targets[key]?.corners || seedBox(key);
    const cx = q.reduce((a, b) => a + b[0], 0) / 4, cy = q.reduce((a, b) => a + b[1], 0) / 4;
    const dist = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
    const xs = q.map((v) => v[0]), ys = q.map((v) => v[1]);
    const inside = p[0] >= Math.min(...xs) && p[0] <= Math.max(...xs) && p[1] >= Math.min(...ys) && p[1] <= Math.max(...ys);
    const score = inside ? dist : dist + 10;
    if (score < bestDistance) { bestDistance = score; best = i; }
  });
  return best;
}
$("#editor").onpointerdown = (e) => {
  if (!state.image || state.busy) return;
  const c = $("#editor"), p = pointer(e);
  c.focus();
  if (state.pending) {
    state.pending.push(p);
    if (state.pending.length === 4) {
      const error = G.validQuad(state.pending);
      if (error) { status(`${error}. Start the four points again.`, true); state.pending = []; }
      else {
        snapshot();
        const label = { corners: state.pending, cornerVisibility: ["visible", "visible", "visible", "visible"], orientationKnown: $("#orientation").checked };
        autoVisibility(label);
        state.targets[activeKey()] = label; state.pending = null; state.corner = 0; dirty();
      }
    }
    draw();
    return;
  }
  const label = activeLabel(), f = frameGeom(c);
  if (label?.corners) {
    const hit = G.nearestActiveHandle([label.corners.map(([x, y]) => [x * f.w, y * f.h])], 0, [p[0] * f.w, p[1] * f.h], 22 * f.d);
    if (hit) { snapshot(); state.corner = hit[1]; state.dragging = true; c.setPointerCapture(e.pointerId); draw(); return; }
  }
  const target = hitTarget(p);
  if (target !== null && target !== state.active) selectTarget(target);
  else draw();
};
$("#editor").onpointermove = (e) => {
  if (!state.dragging) return;
  const label = activeLabel();
  label.corners[state.corner] = pointer(e);
  autoVisibility(label);
  draw();
};
function endDrag() { if (state.dragging) { state.dragging = false; changed(); } }
$("#editor").onpointerup = endDrag;
$("#editor").onpointercancel = endDrag;
$("#editor").onkeydown = (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
  const key = e.key.toLowerCase();
  if (e.key === "Escape") { state.pending = null; draw(); return; }
  if (key === "d") { e.preventDefault(); startDraw(); return; }
  if (key === "b") { e.preventDefault(); seedFromBox(); return; }
  if (key === "n") { e.preventDefault(); nextPending(); return; }
  if (key === "s") { e.preventDefault(); $("#skip").focus(); return; }
  if (key === "o") {
    const label = activeLabel();
    if (label?.corners) {
      snapshot();
      const v = label.cornerVisibility[state.corner];
      label.cornerVisibility[state.corner] = v === "occluded" ? "visible" : v === "visible" ? "occluded" : v;
      changed();
    }
    return;
  }
  if (e.key === "Enter") { e.preventDefault(); save(true); return; }
  if (/^[1-4]$/.test(e.key)) { state.corner = Number(e.key) - 1; draw(); return; }
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  const label = activeLabel();
  if (delta && label?.corners) {
    e.preventDefault(); snapshot();
    const q = label.corners[state.corner], step = e.shiftKey ? 5 : 1;
    q[0] = Math.max(-0.5, Math.min(1.5, q[0] + (delta[0] * step) / state.image.width));
    q[1] = Math.max(-0.5, Math.min(1.5, q[1] + (delta[1] * step) / state.image.height));
    autoVisibility(label); changed();
  }
};
$("#draw").onclick = startDraw;
$("#seed").onclick = seedFromBox;
$("#clear").onclick = () => { if (!activeLabel()) return; snapshot(); delete state.targets[activeKey()]; state.pending = null; changed(); };
$("#skip").onchange = () => {
  const reason = $("#skip").value; $("#skip").value = "";
  if (!reason) return;
  snapshot(); state.targets[activeKey()] = { skip: reason }; state.pending = null; changed(); nextPending();
};
$("#undo").onclick = () => { if (!state.undo.length) return; state.targets = state.undo.pop(); state.pending = null; changed(); };
$("#orientation").onchange = () => { const l = activeLabel(); if (l?.corners) { snapshot(); l.orientationKnown = $("#orientation").checked; changed(); } };
$("#target").onchange = () => selectTarget(Number($("#target").value));
$("#notes").addEventListener("input", dirty);

async function load(id) {
  if (state.busy) return;
  state.busy = true;
  try {
    status("Loading image…");
    const frame = await api(`/api/frame/${id}`), image = new Image();
    image.src = `/image/${id}`;
    await image.decode();
    state.frame = frame; state.image = image;
    const c = document.createElement("canvas"); c.width = image.width; c.height = image.height;
    c.getContext("2d").drawImage(image, 0, 0);
    state.pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    state.keys = frame.instances.map((i) => String(i.sourceAnnotationIndex));
    state.targets = clone(frame.label?.targets || {});
    $("#notes").value = frame.label?.notes || "";
    if (frame.label?.reviewer) $("#reviewer").value = frame.label.reviewer;
    state.pending = null; state.undo = []; state.dirty = false; state.active = 0; state.corner = 0;
    const draft = JSON.parse(localStorage.getItem(`archive-draft:${id}`) || "null");
    if (draft && draft.revision === (frame.label?.revision || 0)) { state.targets = draft.targets; $("#notes").value = draft.notes || ""; state.dirty = true; }
    const firstPending = state.keys.findIndex((k) => !state.targets[k]);
    state.active = firstPending >= 0 ? firstPending : 0;
    $("#frame").value = id;
    draw();
    status(state.dirty ? "Restored unsaved draft" : frame.label ? `Saved by ${frame.label.reviewer} · revision ${frame.label.revision}${frame.label.complete ? " · complete" : " · incomplete"}` : "Ready · select a card and press D or B");
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
async function save(next) {
  if (!state.frame || state.busy) return;
  if (state.pending) { status("Finish the four corners or press Escape before saving.", true); return; }
  state.busy = true;
  try {
    const r = await api(`/api/label/${state.frame.recordId}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewer: $("#reviewer").value, notes: $("#notes").value, targets: state.targets, revision: state.frame.label?.revision || 0 }) });
    state.frame.label = r; state.dirty = false;
    localStorage.removeItem(`archive-draft:${r.recordId}`);
    localStorage.setItem("archive-labeler-reviewer", r.reviewer);
    const row = state.frames.find((f) => f.id === r.recordId); row.saved = true; row.complete = r.complete;
    const summary = await api("/api/frames"); progress(summary.progress);
    status(r.complete ? "Frame saved · complete" : "Frame saved · some cards still pending");
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

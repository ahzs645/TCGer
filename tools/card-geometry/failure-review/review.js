"use strict";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const G = window.CardEditorGeometry,
  clone = (x) => JSON.parse(JSON.stringify(x));
const state = {
  samples: [],
  filtered: [],
  sample: null,
  image: null,
  pixels: null,
  quads: [],
  active: 0,
  corner: 0,
  pending: null,
  undo: [],
  dirty: false,
  dragging: false,
  busy: false,
};
const scenes = {
  single_card_archive: "Single card / archive",
  single_handheld: "Handheld",
  binder_page: "Binder page",
  duel_field: "Duel field",
  steep_playmat: "Steep playmat",
  other: "Other",
  uncertain: "Not sure",
};
const issues = {
  "missed-card": "Missed card",
  "extra-outline": "Extra outline",
  "bad-corners": "Bad corners",
  "wrong-crop": "Bad crop",
  "wrong-identity": "Wrong identity",
  "slab-vs-card": "Slab / card confusion",
  "partial-card-label": "Label covers only part of card",
  "missing-label": "Missing label",
  uncertain: "Uncertain",
};
for (const [value, text] of Object.entries(scenes)) {
  $("#scene").add(new Option(text, value));
  $("#filter-scene").add(new Option(text, value));
}
for (const [value, text] of Object.entries(issues)) {
  const l = document.createElement("label"),
    i = document.createElement("input");
  i.type = "checkbox";
  i.value = value;
  l.append(i, ` ${text}`);
  $("#issues").append(l);
}
$("#reviewer").value = localStorage.getItem("geometry-reviewer") || "";
function status(message, error = false) {
  $("#status").textContent = message;
  $("#status").className = error ? "error" : "";
}
async function api(url, options) {
  const r = await fetch(url, options),
    j = await r.json();
  if (!r.ok) throw Error(j.error || r.statusText);
  return j;
}
function quad(item) {
  return (item.corners || [])
    .filter((c) => c.point)
    .map((c) => [c.point.x, c.point.y]);
}
function labelShapes() {
  return state.sample.instances
    .map((i) => {
      const q = quad(i);
      if (q.length === 4 && i.corners.every((c) => c.coordinateKnown !== false))
        return { q, color: "#58e0a2", known: true };
      const mask = i.visibleMask?.points;
      if (mask) return { q: mask.map((p) => [p.x, p.y]), color: "#ffc465" };
      const b = i.box;
      if (b)
        return {
          q: [
            [b.left, b.top],
            [b.right, b.top],
            [b.right, b.bottom],
            [b.left, b.bottom],
          ],
          color: "#ffc465",
        };
      return null;
    })
    .filter(Boolean);
}
function frame(canvas, margin = 0.05) {
  const r = canvas.getBoundingClientRect(),
    d = devicePixelRatio || 1;
  canvas.width = Math.round(r.width * d);
  canvas.height = Math.round(r.height * d);
  const s = Math.min(
    canvas.width / (state.image.width * (1 + 2 * margin)),
    canvas.height / (state.image.height * (1 + 2 * margin)),
  );
  return {
    x: (canvas.width - state.image.width * s) / 2,
    y: (canvas.height - state.image.height * s) / 2,
    w: state.image.width * s,
    h: state.image.height * s,
    d,
  };
}
function outline(ctx, q, f, color, width = 2, label = "") {
  if (!q.length) return;
  ctx.beginPath();
  q.forEach(([x, y], i) =>
    ctx[i ? "lineTo" : "moveTo"](f.x + x * f.w, f.y + y * f.h),
  );
  ctx.closePath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width * f.d;
  ctx.stroke();
  if (label) {
    ctx.font = `${12 * f.d}px system-ui`;
    ctx.fillStyle = color;
    ctx.fillText(
      label,
      f.x + q[0][0] * f.w + 5 * f.d,
      f.y + q[0][1] * f.h - 5 * f.d,
    );
  }
}
function base(canvas, margin) {
  const f = frame(canvas, margin),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#080c13";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(state.image, f.x, f.y, f.w, f.h);
  return { f, ctx };
}
function preview(canvas, q) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!q || q.length !== 4) return;
  try {
    const p = G.rectify(state.pixels, q, canvas.width, canvas.height);
    ctx.putImageData(new ImageData(p.data, p.width, p.height), 0, 0);
  } catch {
    /* An invalid model quad is intentionally blank. */
  }
}
function modelItems(panel) {
  const row = state.sample.models[panel.dataset.model],
    stage = panel.querySelector(".stage").value;
  if (!row) return [];
  return stage === "native"
    ? row.native.map((x) => ({
        q: [
          [x.box[0], x.box[1]],
          [x.box[2], x.box[1]],
          [x.box[2], x.box[3]],
          [x.box[0], x.box[3]],
        ],
        score: x.score,
      }))
    : row[stage].map((x, i) => ({
        q: quad(x),
        score: x.confidence,
        rejections: stage === "raw" ? row.rejections[i] : [],
      }));
}
function modelControls(panel) {
  const select = panel.querySelector(".card"),
    items = modelItems(panel);
  select.replaceChildren(
    ...items.map(
      (x, i) => new Option(`${i + 1} · ${(100 * x.score).toFixed(1)}%`, i),
    ),
  );
  if (!items.length) select.add(new Option("No detections", ""));
  drawModel(panel);
}
function drawModel(panel) {
  const items = modelItems(panel),
    active = Number(panel.querySelector(".card").value),
    { ctx, f } = base(panel.querySelector(".image"));
  if ($("#show-labels").checked)
    labelShapes().forEach((x) => outline(ctx, x.q, f, x.color, 2));
  items.forEach((x, i) =>
    outline(
      ctx,
      x.q,
      f,
      i === active ? "#ff91d4" : "#68adff",
      i === active ? 3 : 1.2,
      `${i + 1}`,
    ),
  );
  panel.querySelector(".count").textContent =
    `${items.length} ${panel.querySelector(".stage").value === "native" ? "boxes" : "outlines"}`;
  const selected = items[active];
  const stage = panel.querySelector(".stage").value;
  preview(
    panel.querySelector(".crop"),
    stage === "native" ? null : selected?.q,
  );
  panel.querySelector(".copy").disabled = !selected || stage === "native";
  panel.querySelector(".details").textContent = !state.sample.models[
    panel.dataset.model
  ]
    ? "No model inference in this training-label sample."
    : stage === "native"
      ? "Boxes after framework filtering and NMS; before corner decoding."
      : stage === "raw"
        ? selected?.rejections?.length
          ? `Rejected: ${selected.rejections.join(", ")}`
          : "Passes shape filters; shared NMS may still remove overlapping outlines."
        : "Final output after shared shape filters and NMS.";
  const r = state.sample.models[panel.dataset.model]?.recognition;
  panel.querySelector(".recognition").textContent = r
    ? `Saved frame recognition: ${r.outcome}. ${r.accepted ? "Accepted" : "Abstained"}${r.acceptedFamily ? ` · ${r.acceptedFamily}` : ""}. ${r.expectation === "unknown" ? "Identity is unverified; this frame cannot establish recognition accuracy." : `Label type: ${r.expectation}.`} ${active > 0 ? "The replay used the highest-confidence final outline." : ""}`
    : "No identity replay for this image. Crop is a visual preview, not a new recognition run.";
}
function editorControls() {
  const select = $("#edit-card");
  select.replaceChildren(
    ...state.quads.map((_, i) => new Option(`Card ${i + 1}`, i)),
  );
  select.value = String(state.active);
  $("#delete").disabled = !state.quads.length;
  $("#undo").disabled = !state.undo.length;
  $("#add").textContent = state.pending
    ? "Cancel drawing"
    : "+ Draw four corners";
  $("#draw-hint").textContent = state.pending
    ? `Click ${["top-left", "top-right", "bottom-right", "bottom-left"][state.pending.length]} (${state.pending.length + 1}/4). Escape cancels.`
    : "Drag a corner to refine it. 1–4 selects a corner; arrow keys nudge. Green outlines are your proposed corrections.";
}
function drawEditor() {
  if (!state.image) return;
  const canvas = $("#editor"),
    { ctx, f } = base(canvas, 0.2);
  if ($("#show-labels").checked)
    labelShapes().forEach((x) => outline(ctx, x.q, f, x.color, 1));
  state.quads.forEach((q, i) => {
    outline(
      ctx,
      q,
      f,
      i === state.active ? "#58e0a2" : "#6a9fcb",
      i === state.active ? 3 : 1.5,
      `${i + 1}`,
    );
    if (i === state.active)
      q.forEach(([x, y], c) => {
        ctx.beginPath();
        ctx.arc(f.x + x * f.w, f.y + y * f.h, 8 * f.d, 0, 2 * Math.PI);
        ctx.fillStyle = c === state.corner ? "#ffc465" : "#58e0a2";
        ctx.fill();
        ctx.font = `${12 * f.d}px system-ui`;
        ctx.fillText(
          ["TL", "TR", "BR", "BL"][c],
          f.x + x * f.w + 10 * f.d,
          f.y + y * f.h - 10 * f.d,
        );
      });
  });
  if (state.pending) {
    outline(ctx, state.pending, f, "#ffb96a", 2);
    state.pending.forEach(([x, y]) => {
      ctx.fillStyle = "#ffb96a";
      ctx.fillRect(f.x + x * f.w - 4, f.y + y * f.h - 4, 8, 8);
    });
  }
  preview($("#edit-crop"), state.quads[state.active]);
  const z = $("#zoom"),
    zc = z.getContext("2d"),
    p = state.pending?.at(-1) || state.quads[state.active]?.[state.corner];
  zc.clearRect(0, 0, z.width, z.height);
  if (p) {
    zc.drawImage(
      state.image,
      p[0] * state.image.width - 32,
      p[1] * state.image.height - 32,
      64,
      64,
      0,
      0,
      z.width,
      z.height,
    );
    zc.strokeStyle = "#ffc465";
    zc.beginPath();
    zc.moveTo(100, 110);
    zc.lineTo(120, 110);
    zc.moveTo(110, 100);
    zc.lineTo(110, 120);
    zc.stroke();
  }
}
function drawAll() {
  if (!state.image) return;
  $$(".model").forEach(drawModel);
  drawEditor();
}
function form() {
  return {
    reviewer: $("#reviewer").value,
    winner: $("input[name=winner]:checked")?.value || "",
    scene: $("#scene").value,
    issues: $$("#issues input:checked").map((x) => x.value),
    notes: $("#notes").value,
    quads: clone(state.quads),
    revision: state.sample?.review?.revision || 0,
  };
}
function dirty() {
  state.dirty = true;
  status("Draft changes · Save review when ready");
  if (state.sample)
    localStorage.setItem(
      `geometry-draft:${state.sample.recordId}`,
      JSON.stringify(form()),
    );
}
function snapshot() {
  state.undo.push(clone(state.quads));
  if (state.undo.length > 30) state.undo.shift();
}
function changed() {
  editorControls();
  drawEditor();
  dirty();
}
function setForm(r) {
  state.quads = clone(r.quads || []);
  state.active = 0;
  state.corner = 0;
  $("#scene").value = scenes[r.scene] ? r.scene : "uncertain";
  if (r.reviewer) $("#reviewer").value = r.reviewer;
  $$("input[name=winner]").forEach((i) => (i.checked = i.value === r.winner));
  $$("#issues input").forEach(
    (i) => (i.checked = (r.issues || []).includes(i.value)),
  );
  $("#notes").value = r.notes || "";
}
async function load(id) {
  if (state.busy) return;
  state.busy = true;
  try {
    status("Loading image…");
    const sample = await api(`/api/sample/${id}`),
      image = new Image();
    image.src = `/image/${id}`;
    await image.decode();
    state.sample = sample;
    state.image = image;
    const c = document.createElement("canvas");
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d").drawImage(image, 0, 0);
    state.pixels = c.getContext("2d").getImageData(0, 0, c.width, c.height);
    state.pending = null;
    state.undo = [];
    state.dirty = false;
    setForm(sample.review || { scene: sample.sceneSlice });
    const draft = JSON.parse(
      localStorage.getItem(`geometry-draft:${id}`) || "null",
    );
    if (draft && draft.revision === (sample.review?.revision || 0)) {
      setForm(draft);
      state.dirty = true;
    }
    $("#record").textContent =
      `${sample.scope} · ${scenes[sample.sceneSlice] || sample.sceneSlice} · ${id}`;
    $("#sample").value = id;
    $$(".model").forEach(modelControls);
    editorControls();
    drawEditor();
    status(
      state.dirty
        ? "Restored unsaved draft"
        : sample.review
          ? `Saved by ${sample.review.reviewer} · revision ${sample.review.revision}`
          : "Ready to compare",
    );
  } catch (e) {
    status(e.message, true);
  } finally {
    state.busy = false;
  }
}
function canLeave() {
  return (
    !state.dirty ||
    confirm(
      "This review has unsaved changes. Leave it as a draft and continue?",
    )
  );
}
function filter() {
  state.filtered = state.samples.filter(
    (s) =>
      ($("#scope").value === "all" || s.scope === $("#scope").value) &&
      ($("#filter-scene").value === "all" ||
        s.scene === $("#filter-scene").value) &&
      (!$("#unreviewed").checked || !s.reviewed),
  );
  $("#sample").replaceChildren(
    ...state.filtered.map(
      (s, i) =>
        new Option(
          `${s.reviewed ? "✓ " : ""}${i + 1} · ${scenes[s.scene] || s.scene} · ${s.id.slice(-14)}`,
          s.id,
        ),
    ),
  );
  $("#progress").textContent =
    `${state.samples.filter((s) => s.reviewed).length} / ${state.samples.length} reviewed`;
  $("main").hidden = !state.filtered.length;
  $("#save").disabled = !state.filtered.length;
  $("#save-next").disabled = !state.filtered.length;
  if (state.filtered.length) {
    const id = state.filtered.some((s) => s.id === state.sample?.recordId)
      ? state.sample.recordId
      : state.filtered[0].id;
    load(id);
  } else {
    state.sample = null;
    state.image = null;
    state.dirty = false;
    $("#record").textContent = "No matching images";
    status("No images match these filters.");
    $("#sample").replaceChildren(new Option("No matching images", ""));
  }
}
function navigate(delta) {
  if (state.busy || !canLeave()) return;
  const i = state.filtered.findIndex((s) => s.id === state.sample?.recordId),
    next = state.filtered[i + delta];
  if (next) load(next.id);
  else
    status(delta > 0 ? "End of this review set" : "Start of this review set");
}
async function save(next) {
  if (!state.sample || state.busy) return;
  if (state.pending) {
    status("Finish all four corners or cancel drawing before saving.", true);
    return;
  }
  state.busy = true;
  try {
    const r = await api(`/api/review/${state.sample.recordId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form()),
    });
    state.sample.review = r;
    state.dirty = false;
    localStorage.removeItem(`geometry-draft:${r.recordId}`);
    localStorage.setItem("geometry-reviewer", r.reviewer);
    state.samples.find((s) => s.id === r.recordId).reviewed = true;
    $("#progress").textContent =
      `${state.samples.filter((s) => s.reviewed).length} / ${state.samples.length} reviewed`;
    status("Review saved to disk");
    const option = [...$("#sample").options].find(
      (o) => o.value === r.recordId,
    );
    if (option && !option.text.startsWith("✓"))
      option.text = `✓ ${option.text}`;
    state.busy = false;
    if (next) navigate(1);
  } catch (e) {
    status(e.message, true);
  } finally {
    state.busy = false;
  }
}
$$(".model").forEach((panel) => {
  panel.querySelector(".stage").onchange = () => modelControls(panel);
  panel.querySelector(".card").onchange = () => drawModel(panel);
  panel.querySelector(".copy").onclick = () => {
    const q = modelItems(panel)[Number(panel.querySelector(".card").value)]?.q;
    if (!q) return;
    snapshot();
    state.quads.push(clone(q));
    state.active = state.quads.length - 1;
    state.pending = null;
    changed();
    $("#editor").scrollIntoView({ behavior: "smooth", block: "center" });
  };
});
$("#add").onclick = () => {
  state.pending = state.pending ? null : [];
  editorControls();
  drawEditor();
  $("#editor").focus();
};
$("#discard").onclick = () => {
  if (
    !state.sample ||
    !confirm("Discard this unsaved draft and restore the last saved review?")
  )
    return;
  localStorage.removeItem(`geometry-draft:${state.sample.recordId}`);
  state.dirty = false;
  load(state.sample.recordId);
};
$("#delete").onclick = () => {
  if (!state.quads.length) return;
  snapshot();
  state.quads.splice(state.active, 1);
  state.active = Math.max(0, state.active - 1);
  changed();
};
$("#undo").onclick = () => {
  if (!state.undo.length) return;
  state.quads = state.undo.pop();
  state.active = Math.min(state.active, Math.max(0, state.quads.length - 1));
  changed();
};
$("#copy-labels").onclick = () => {
  const known = labelShapes().filter((x) => x.known);
  if (!known.length) {
    status(
      "No trusted four-corner labels to copy. Draw the visible card yourself.",
    );
    return;
  }
  snapshot();
  state.quads.push(...known.map((x) => clone(x.q)));
  state.active = state.quads.length - known.length;
  changed();
};
$("#edit-card").onchange = () => {
  state.active = Number($("#edit-card").value);
  drawEditor();
};
function pointer(e) {
  const c = $("#editor"),
    r = c.getBoundingClientRect(),
    f = frame(c, 0.2);
  return [
    (((e.clientX - r.left) * c.width) / r.width - f.x) / f.w,
    (((e.clientY - r.top) * c.height) / r.height - f.y) / f.h,
  ].map((v) => Math.max(-0.5, Math.min(1.5, v)));
}
$("#editor").onpointerdown = (e) => {
  if (!state.image || state.busy) return;
  const c = $("#editor"),
    p = pointer(e);
  c.focus();
  if (state.pending) {
    state.pending.push(p);
    if (state.pending.length === 4) {
      const error = G.validQuad(state.pending);
      if (error) {
        status(`${error}. Start the four points again.`, true);
        state.pending = [];
      } else {
        snapshot();
        state.quads.push(state.pending);
        state.pending = null;
        state.active = state.quads.length - 1;
        dirty();
      }
    }
    editorControls();
    drawEditor();
    return;
  }
  const q = state.quads[state.active];
  if (!q) {
    drawEditor();
    return;
  }
  const f = frame(c, 0.2),
    hit = G.nearestActiveHandle(
      [q.map(([x, y]) => [x * f.w, y * f.h])],
      0,
      [p[0] * f.w, p[1] * f.h],
      20 * f.d,
    );
  if (hit) {
    snapshot();
    state.corner = hit[1];
    state.dragging = true;
    c.setPointerCapture(e.pointerId);
  }
  drawEditor();
};
$("#editor").onpointermove = (e) => {
  if (!state.dragging) return;
  state.quads[state.active][state.corner] = pointer(e);
  drawEditor();
};
function endDrag() {
  if (state.dragging) {
    state.dragging = false;
    changed();
  }
}
$("#editor").onpointerup = endDrag;
$("#editor").onpointercancel = endDrag;
$("#editor").onkeydown = (e) => {
  if (e.key === "Escape") {
    state.pending = null;
    editorControls();
    drawEditor();
    return;
  }
  if (/^[1-4]$/.test(e.key)) {
    state.corner = Number(e.key) - 1;
    drawEditor();
  }
  const delta = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  }[e.key];
  if (delta && state.quads[state.active]) {
    e.preventDefault();
    snapshot();
    const q = state.quads[state.active][state.corner],
      step = e.shiftKey ? 5 : 1;
    q[0] = Math.max(
      -0.5,
      Math.min(1.5, q[0] + (delta[0] * step) / state.image.width),
    );
    q[1] = Math.max(
      -0.5,
      Math.min(1.5, q[1] + (delta[1] * step) / state.image.height),
    );
    changed();
  }
};
$("#show-labels").onchange = drawAll;
for (const selector of ["#scope", "#filter-scene", "#unreviewed"])
  $(selector).onchange = () => {
    if (canLeave()) filter();
  };
$("#sample").onchange = () => {
  if (canLeave()) load($("#sample").value);
  else $("#sample").value = state.sample.recordId;
};
$("#previous").onclick = () => navigate(-1);
$("#next").onclick = () => navigate(1);
$("#save").onclick = () => save(false);
$("#save-next").onclick = () => save(true);
$$(".decision input,.decision textarea,.decision select").forEach((x) =>
  x.addEventListener("input", dirty),
);
window.addEventListener("resize", drawAll);
window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
api("/api/samples")
  .then((samples) => {
    state.samples = samples;
    filter();
  })
  .catch((e) => status(e.message, true));

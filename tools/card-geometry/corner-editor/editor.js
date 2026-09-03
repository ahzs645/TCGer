"use strict";

const CORNERS = ["TL", "TR", "BR", "BL"];
const MARGIN = 0.2;
const geometry = window.CardEditorGeometry;
const state = {
  samples: [], index: 0, sample: null, image: null, activeCard: 0,
  activeCorner: 0, dragging: false, dragSnapshot: null, dragMetadataSnapshot: null,
  progress: {minimum: 20, finalizedInstances: 0, ready: false},
  sourcePixels: null, previewFrame: null,
};
const editor = document.querySelector("#editor");
const ctx = editor.getContext("2d");
const magnifier = document.querySelector("#magnifier");
const zoomCtx = magnifier.getContext("2d", {alpha: false});
const statusEl = document.querySelector("#status");
const rectified = document.querySelector("#rectified");
const rectifiedCtx = rectified.getContext("2d");

function status(message, kind = "") {
  statusEl.textContent = message;
  statusEl.className = kind;
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function fit() {
  const rect = editor.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(rect.width * ratio);
  const height = Math.round(rect.height * ratio);
  if (editor.width !== width || editor.height !== height) {
    editor.width = width;
    editor.height = height;
  }
  const availableW = editor.width * 0.94;
  const availableH = editor.height * 0.94;
  const imageRatio = state.sample ? state.sample.width / state.sample.height : 1;
  let imageW = availableW;
  let imageH = imageW / imageRatio;
  if (imageH > availableH) {
    imageH = availableH;
    imageW = imageH * imageRatio;
  }
  const sourceW = imageW / (1 + 2 * MARGIN);
  const sourceH = imageH / (1 + 2 * MARGIN);
  return {
    ratio,
    x: (editor.width - sourceW) / 2,
    y: (editor.height - sourceH) / 2,
    width: sourceW,
    height: sourceH,
  };
}

function toCanvas(point, frame = fit()) {
  return [frame.x + point[0] * frame.width, frame.y + point[1] * frame.height];
}
function fromPointer(event) {
  const rect = editor.getBoundingClientRect();
  const frame = fit();
  const scaleX = editor.width / rect.width;
  const scaleY = editor.height / rect.height;
  return [
    ((event.clientX - rect.left) * scaleX - frame.x) / frame.width,
    ((event.clientY - rect.top) * scaleY - frame.y) / frame.height,
  ].map((value) => Math.max(-MARGIN, Math.min(1 + MARGIN, value)));
}

function draw() {
  const frame = fit();
  ctx.clearRect(0, 0, editor.width, editor.height);
  ctx.fillStyle = "#15161a";
  ctx.fillRect(0, 0, editor.width, editor.height);
  if (!state.image || !state.sample) return;
  ctx.fillStyle = "#25262c";
  ctx.fillRect(
    frame.x - frame.width * MARGIN, frame.y - frame.height * MARGIN,
    frame.width * (1 + 2 * MARGIN), frame.height * (1 + 2 * MARGIN),
  );
  ctx.drawImage(state.image, frame.x, frame.y, frame.width, frame.height);
  ctx.strokeStyle = "#8e8e93";
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  ctx.strokeRect(frame.x, frame.y, frame.width, frame.height);
  ctx.setLineDash([]);

  const paintOrder = state.sample.quads.map((_, i) => i).filter(i => i !== state.activeCard);
  if (state.sample.quads.length) paintOrder.push(state.activeCard);
  paintOrder.forEach((cardIndex) => {
    const quad = state.sample.quads[cardIndex];
    const active = cardIndex === state.activeCard;
    ctx.strokeStyle = active ? "#34c759" : "#4da3ff";
    ctx.lineWidth = active ? 4 : 2;
    ctx.beginPath();
    quad.forEach((point, index) => {
      const [x, y] = toCanvas(point, frame);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
    if (!active) return; // outlines remain; hidden handles cannot obscure the active card
    quad.forEach((point, cornerIndex) => {
      const [x, y] = toCanvas(point, frame);
      const selected = active && cornerIndex === state.activeCorner;
      ctx.beginPath();
      ctx.arc(x, y, selected ? 13 * frame.ratio : active ? 9 * frame.ratio : 6 * frame.ratio, 0, Math.PI * 2);
      ctx.fillStyle = selected ? "#ff9f0a" : active ? "#34c759" : "#4da3ff";
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2 * frame.ratio;
        ctx.stroke();
      }
      if (active) {
        ctx.font = `${Math.round(13 * frame.ratio)}px sans-serif`;
        ctx.fillStyle = selected ? "#ffb340" : "white";
        ctx.fillText(CORNERS[cornerIndex], x + 12 * frame.ratio, y - 10 * frame.ratio);
      }
    });
  });
  drawMagnifier();
  schedulePreview();
}

function schedulePreview() {
  if (state.previewFrame !== null) return;
  state.previewFrame = requestAnimationFrame(() => {
    state.previewFrame = null;
    rectifiedCtx.clearRect(0, 0, rectified.width, rectified.height);
    const previewStatus = document.querySelector("#preview-status");
    if (!state.sourcePixels || !state.sample?.quads.length) {
      previewStatus.textContent = "Select a card to preview.";
      document.querySelector("#preview-card").textContent = "";
      return;
    }
    document.querySelector("#preview-card").textContent = `Card ${state.activeCard + 1}`;
    const profile = geometry.PROFILES[document.querySelector("#preview-profile").value];
    rectified.width = profile.width;
    rectified.height = profile.height;
    try {
      const preview = geometry.rectify(state.sourcePixels, state.sample.quads[state.activeCard], profile.width, profile.height);
      rectifiedCtx.putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0);
      previewStatus.textContent = `${(preview.outsideFraction * 100).toFixed(1)}% outside capture · TL → TR → BR → BL`;
    } catch (error) {
      previewStatus.textContent = `Adjust corners: ${error.message}`;
    }
  });
}

function selectCard(index) {
  if (!state.sample?.quads.length || state.dragging) return;
  state.activeCard = geometry.cycleCard(index, state.sample.quads.length, 0);
  state.activeCorner = 0;
  renderControls();
  draw();
}

function cycleCard(direction) {
  if (!state.sample?.quads.length) return;
  selectCard(geometry.cycleCard(state.activeCard, state.sample.quads.length, direction));
}

// Tab switches cards only in the editing surface, not in forms elsewhere.
// Escape exits this keyboard mode so ordinary focus navigation is available.
function editingKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || state.dragging) return;
  if (event.key === "Tab") {
    event.preventDefault();
    cycleCard(event.shiftKey ? -1 : 1);
    editor.focus({preventScroll: true});
  } else if (event.key === "Escape") {
    event.preventDefault();
    document.querySelector("#zoom").focus();
  } else if (/^[1-4]$/.test(event.key) && state.sample?.quads.length) {
    state.activeCorner = Number(event.key) - 1;
    draw();
  }
}
editor.addEventListener("keydown", editingKey);
document.querySelector("#cards").addEventListener("keydown", editingKey);
document.querySelector("#previous-card").onclick = () => cycleCard(-1);
document.querySelector("#next-card").onclick = () => cycleCard(1);
document.querySelector("#preview-profile").onchange = schedulePreview;

function drawMagnifier() {
  zoomCtx.fillStyle = "#050505";
  zoomCtx.fillRect(0, 0, magnifier.width, magnifier.height);
  if (!state.image || !state.sample?.quads.length) return;
  const point = state.sample.quads[state.activeCard][state.activeCorner];
  const centerX = point[0] * state.sample.width;
  const centerY = point[1] * state.sample.height;
  const radius = Number(document.querySelector("#zoom").value);
  const left = centerX - radius;
  const top = centerY - radius;
  const scale = magnifier.width / (2 * radius);
  const sourceLeft = Math.max(0, left);
  const sourceTop = Math.max(0, top);
  const sourceRight = Math.min(state.sample.width, centerX + radius);
  const sourceBottom = Math.min(state.sample.height, centerY + radius);
  if (sourceRight > sourceLeft && sourceBottom > sourceTop) {
    zoomCtx.imageSmoothingEnabled = false;
    zoomCtx.drawImage(
      state.image,
      sourceLeft, sourceTop, sourceRight - sourceLeft, sourceBottom - sourceTop,
      (sourceLeft - left) * scale, (sourceTop - top) * scale,
      (sourceRight - sourceLeft) * scale, (sourceBottom - sourceTop) * scale,
    );
  }
  const center = magnifier.width / 2;
  zoomCtx.strokeStyle = "#ff453a";
  zoomCtx.lineWidth = 2;
  zoomCtx.beginPath();
  zoomCtx.moveTo(center - 28, center);
  zoomCtx.lineTo(center + 28, center);
  zoomCtx.moveTo(center, center - 28);
  zoomCtx.lineTo(center, center + 28);
  zoomCtx.stroke();
  zoomCtx.beginPath();
  zoomCtx.arc(center, center, 8, 0, Math.PI * 2);
  zoomCtx.stroke();
  document.querySelector("#selection").textContent = `Card ${state.activeCard + 1} · ${CORNERS[state.activeCorner]}`;
  document.querySelector("#coordinates").textContent = `${centerX.toFixed(1)}, ${centerY.toFixed(1)} px`;
}

function nearestHandle(event) {
  const rect = editor.getBoundingClientRect();
  const scale = editor.width / rect.width;
  const px = (event.clientX - rect.left) * scale;
  const py = (event.clientY - rect.top) * scale;
  const frame = fit();
  const quads = state.sample.quads.map(quad => quad.map(point => toCanvas(point, frame)));
  return geometry.nearestActiveHandle(quads, state.activeCard, [px, py], 20 * frame.ratio);
}

function validQuad(quad) {
  return geometry.validQuad(quad);
}

editor.addEventListener("pointerdown", (event) => {
  if (!state.sample || event.button !== 0) return;
  editor.focus({preventScroll: true});
  const handle = nearestHandle(event);
  if (!handle) {
    status("Choose a card tab first, then drag one of its four corners.");
    return;
  }
  [state.activeCard, state.activeCorner] = handle;
  state.dragging = true;
  state.dragSnapshot = clone(state.sample.quads[state.activeCard]);
  state.dragMetadataSnapshot = clone(state.sample.metadata[state.activeCard]);
  editor.setPointerCapture(event.pointerId);
  editor.classList.add("dragging");
  // Selecting a handle must not snap it to the cursor's edge.
  renderControls();
  draw();
  status(`Dragging Card ${state.activeCard + 1} ${CORNERS[state.activeCorner]}…`);
});
editor.addEventListener("pointermove", (event) => {
  if (!state.dragging) return;
  state.sample.quads[state.activeCard][state.activeCorner] = fromPointer(event);
  updateVisibility();
  draw();
});
async function endDrag(event) {
  if (!state.dragging) return;
  state.dragging = false;
  editor.classList.remove("dragging");
  if (editor.hasPointerCapture(event.pointerId)) editor.releasePointerCapture(event.pointerId);
  const error = event.type === "pointercancel" ? "Drag cancelled" : validQuad(state.sample.quads[state.activeCard]);
  if (error) {
    state.sample.quads[state.activeCard] = state.dragSnapshot;
    state.sample.metadata[state.activeCard] = state.dragMetadataSnapshot;
    renderControls();
    status(`Move rejected: ${error}`, "error");
    draw();
    return;
  }
  if (JSON.stringify(state.sample.quads[state.activeCard]) === JSON.stringify(state.dragSnapshot)) return;
  renderControls();
  await persist(false, `Saved Card ${state.activeCard + 1} ${CORNERS[state.activeCorner]}`);
}
editor.addEventListener("pointerup", endDrag);
editor.addEventListener("pointercancel", endDrag);

function updateVisibility() {
  if (!state.sample?.metadata[state.activeCard]) return;
  const point = state.sample.quads[state.activeCard][state.activeCorner];
  const labels = state.sample.metadata[state.activeCard].cornerVisibility;
  const inside = point[0] >= 0 && point[0] <= 1 && point[1] >= 0 && point[1] <= 1;
  // Preserve a user's occluded label while moving within the capture.
  labels[state.activeCorner] = !inside ? "outsideFrame"
    : labels[state.activeCorner] === "outsideFrame" ? "visible" : labels[state.activeCorner];
}

async function persist(finalize, message) {
  try {
    await jsonRequest(`/api/sample/${state.sample.id}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({quads: state.sample.quads, metadata: state.sample.metadata, finalize}),
    });
    state.sample.finalized = finalize;
    await refreshProgress();
    status(message, "ok");
  } catch (error) {
    status(`Save failed: ${error.message}`, "error");
  }
}

function renderProgress() {
  const element = document.querySelector("#minimum-progress");
  element.textContent = `Binder minimum: ${state.progress.finalizedInstances}/${state.progress.minimum}`;
  element.className = state.progress.ready ? "ready" : "";
}

async function refreshProgress() {
  const payload = await jsonRequest("/api/samples");
  state.samples = payload.samples;
  state.progress = payload.progress;
  renderProgress();
  for (const sample of state.samples) {
    const option = Array.from(document.querySelector("#sample").options).find(o => o.value === sample.id);
    if (option) option.textContent = `${sample.key} · ${sample.cards} cards · ${sample.finalized ? "finalized" : "draft"}`;
  }
}

function renderControls() {
  const cards = document.querySelector("#cards");
  cards.replaceChildren();
  state.sample.quads.forEach((_, index) => {
    const button = document.createElement("button");
    button.textContent = `Card ${index + 1}`;
    button.className = index === state.activeCard ? "active" : "";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(index === state.activeCard));
    button.tabIndex = index === state.activeCard ? 0 : -1;
    button.onclick = () => {
      selectCard(index);
      editor.focus({preventScroll: true});
    };
    cards.append(button);
  });
  const metadata = document.querySelector("#metadata");
  metadata.replaceChildren();
  const item = state.sample.metadata[state.activeCard];
  if (!item) return;
  const sideLabel = document.createElement("label");
  sideLabel.append("Side");
  const side = document.createElement("select");
  ["faceUp", "faceDown", "unknown"].forEach((value) => side.add(new Option(value, value)));
  side.value = item.side;
  side.onchange = () => { item.side = side.value; };
  sideLabel.append(side);
  metadata.append(sideLabel);
  const orientation = document.createElement("label");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = item.orientationKnown;
  check.onchange = () => { item.orientationKnown = check.checked; };
  orientation.append(check, "Orientation known");
  metadata.append(orientation);
  CORNERS.forEach((name, cornerIndex) => {
    const label = document.createElement("label");
    label.append(name);
    const select = document.createElement("select");
    ["visible", "occluded", "outsideFrame"].forEach((value) => select.add(new Option(value, value)));
    select.value = item.cornerVisibility[cornerIndex];
    select.onchange = () => { item.cornerVisibility[cornerIndex] = select.value; };
    label.append(select);
    metadata.append(label);
  });
}

document.querySelector("#add").onclick = () => {
  if (!state.sample) return;
  const index = state.sample.quads.length;
  const inset = 0.08 + (index % 4) * 0.015;
  state.sample.quads.push([[inset, inset], [1 - inset, inset], [1 - inset, 1 - inset], [inset, 1 - inset]]);
  state.sample.metadata.push({
    physicalCardId: `${state.sample.key}:card-${index}`,
    occlusionOrder: index,
    orientationKnown: true,
    side: "faceUp",
    cornerVisibility: ["visible", "visible", "visible", "visible"],
  });
  state.activeCard = index;
  state.activeCorner = 0;
  renderControls();
  draw();
  status("New card added. Drag its four corners into place.");
};
document.querySelector("#delete").onclick = async () => {
  if (!state.sample?.quads.length) return;
  state.sample.quads.splice(state.activeCard, 1);
  state.sample.metadata.splice(state.activeCard, 1);
  state.sample.metadata.forEach((item, index) => { item.occlusionOrder = index; });
  state.activeCard = Math.max(0, Math.min(state.activeCard, state.sample.quads.length - 1));
  renderControls();
  draw();
  if (state.sample.quads.length) await persist(false, "Card deleted and saved");
  else status("A page must keep at least one card", "error");
};
document.querySelector("#save").onclick = () => persist(true, `Page saved (${state.sample.quads.length} cards)`);
document.querySelector("#zoom").oninput = drawMagnifier;
window.addEventListener("resize", draw);

async function loadSample(index) {
  state.index = (index + state.samples.length) % state.samples.length;
  const summary = state.samples[state.index];
  status("Loading page…");
  state.sample = await jsonRequest(`/api/sample/${summary.id}`);
  state.sourcePixels = null;
  state.activeCard = 0;
  state.activeCorner = 0;
  state.image = new Image();
  state.image.decoding = "sync";
  state.image.onload = () => {
    const source = document.createElement("canvas");
    source.width = state.image.naturalWidth;
    source.height = state.image.naturalHeight;
    const sourceCtx = source.getContext("2d", {willReadFrequently: true});
    sourceCtx.drawImage(state.image, 0, 0);
    state.sourcePixels = sourceCtx.getImageData(0, 0, source.width, source.height);
    document.querySelector("#preview-profile").value = geometry.defaultProfile(state.sample.game);
    renderControls();
    draw();
    status("Ready — choose a card; Tab / Shift+Tab switches cards while editing.", "ok");
  };
  state.image.onerror = () => status("Could not load source image", "error");
  state.image.src = `${state.sample.imageUrl}?v=${Date.now()}`;
  document.querySelector("#sample").value = summary.id;
  document.querySelector("#page-count").textContent = `Page ${state.index + 1} of ${state.samples.length}`;
}
document.querySelector("#previous").onclick = () => loadSample(state.index - 1);
document.querySelector("#next").onclick = () => loadSample(state.index + 1);
document.querySelector("#sample").onchange = (event) => loadSample(
  state.samples.findIndex((sample) => sample.id === event.target.value),
);
async function start() {
  try {
    const payload = await jsonRequest("/api/samples");
    state.samples = payload.samples;
    state.progress = payload.progress;
    renderProgress();
    const select = document.querySelector("#sample");
    state.samples.forEach((sample) => select.add(new Option(
      `${sample.key} · ${sample.cards} cards · ${sample.finalized ? "finalized" : "draft"}`,
      sample.id,
    )));
    await loadSample(0);
  } catch (error) {
    status(`Startup failed: ${error.message}`, "error");
  }
}
start();

"use strict";

const CORNERS = ["TL", "TR", "BR", "BL"];
// Show enough exterior canvas for amodal corners under strong perspective.
// Validation permits a slightly larger 50% safety bound.
const MARGIN = 0.4;
const geometry = window.CardEditorGeometry;
const layers = window.CardLabelLayers;
const state = {
  samples: [], index: 0, sample: null, image: null, activeCard: 0,
  activeCorner: 0, dragging: false, dragSnapshot: null, dragMetadataSnapshot: null, dragPointerStart: null, dragPointerId: null,
  progress: {minimum: 20, finalizedInstances: 0, ready: false},
  sourcePixels: null, previewFrame: null, dirty: false, drawingPoints: null,
  view: {scale:1, tx:0, ty:0}, panning: null, panMode: false, compareCard: "overlapping",
  spacePan: false, pointerOverEditor: false,
  saving: false, loading: false,
  resumeKey: null, lastPosition: null,
  suggestions: null, suggestionGeneration: 0, pendingSuggestedDrafts: false,
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
function savedPosition() {
  let saved = null;
  try { saved=JSON.parse(localStorage.getItem(state.resumeKey) || "null"); } catch { /* URL still works if storage is unavailable. */ }
  const params=new URL(location.href).searchParams;
  const photo=params.get("photo");
  const match=state.samples.some(sample=>sample.key===photo || sample.id===photo);
  if (photo && match) {
    const raw=params.get("card") || "C1";
    const card=/^C?[1-9]\d*$/i.test(raw) ? Number(raw.replace(/^C/i,"")) : 1;
    return {photo,card,physicalCardId:saved?.photo===photo && saved?.card===card ? saved.physicalCardId : null};
  }
  return saved || {};
}
function rememberPosition() {
  if (!state.sample || state.loading || !state.resumeKey) return;
  const position={photo:state.sample.key || state.sample.id,id:state.sample.id,
    card:state.activeCard+1,physicalCardId:state.sample.metadata[state.activeCard]?.physicalCardId || null};
  const serialized=JSON.stringify(position);
  if (serialized===state.lastPosition) return;
  state.lastPosition=serialized;
  try { localStorage.setItem(state.resumeKey,serialized); } catch { /* Position remains in the URL. */ }
  const url=new URL(location.href);
  url.searchParams.set("photo",position.photo);
  if (state.sample.quads.length) url.searchParams.set("card",`C${position.card}`);
  else url.searchParams.delete("card");
  history.replaceState(null,"",url);
}
function sampleLabel(sample) {
  const cards = sample.noLabelableCard ? "no labelable card" : `${sample.cards} cards`;
  return `${sample.key} · ${cards} · ${sample.finalized ? "finalized" : "draft"}`;
}
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
  const sourceW = imageW / (1 + 2 * MARGIN) * state.view.scale;
  const sourceH = imageH / (1 + 2 * MARGIN) * state.view.scale;
  return {
    ratio,
    x: (editor.width - sourceW) / 2 + state.view.tx * ratio,
    y: (editor.height - sourceH) / 2 + state.view.ty * ratio,
    width: sourceW,
    height: sourceH,
  };
}

function toCanvas(point, frame = fit()) {
  return [frame.x + point[0] * frame.width, frame.y + point[1] * frame.height];
}
function fromPointer(event, clampToMargin = true) {
  const rect = editor.getBoundingClientRect();
  const frame = fit();
  const scaleX = editor.width / rect.width;
  const scaleY = editor.height / rect.height;
  const point = [
    ((event.clientX - rect.left) * scaleX - frame.x) / frame.width,
    ((event.clientY - rect.top) * scaleY - frame.y) / frame.height,
  ];
  return clampToMargin ? point.map((value) => Math.max(-MARGIN, Math.min(1 + MARGIN, value))) : point;
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

  const highlighted = state.suggestions?.candidates?.[state.suggestions.highlight];
  if (highlighted) {
    ctx.strokeStyle="#ffb340"; ctx.lineWidth=3*frame.ratio; ctx.setLineDash([7*frame.ratio,5*frame.ratio]);
    ctx.beginPath();
    highlighted.quad.forEach((p,i)=>{const [x,y]=toCanvas(p,frame); if (i) ctx.lineTo(x,y); else ctx.moveTo(x,y);});
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
  }

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
      const reviewed = state.sample.draftSource !== "detector";
      ctx.beginPath();
      ctx.arc(x, y, selected ? 13 * frame.ratio : active ? 9 * frame.ratio : 6 * frame.ratio, 0, Math.PI * 2);
      ctx.fillStyle = selected ? "#ff9f0a" : reviewed ? "#34c759" : "#ff453a";
      ctx.fill();
      if (selected) {
        ctx.strokeStyle = "white";
        ctx.lineWidth = 2 * frame.ratio;
        ctx.stroke();
      }
      if (active) {
        ctx.font = `${Math.round(13 * frame.ratio)}px sans-serif`;
        ctx.fillStyle = selected ? "#ffb340" : reviewed ? "white" : "#ff827a";
        const reviewMark = reviewed ? "✓" : "•";
        ctx.fillText(`${CORNERS[cornerIndex]} ${reviewMark}`, x + 12 * frame.ratio, y - 10 * frame.ratio);
      }
    });
  });
  if (state.drawingPoints !== null) {
    ctx.strokeStyle = "#ff9f0a";
    ctx.fillStyle = "#ff9f0a";
    ctx.lineWidth = 2 * frame.ratio;
    ctx.setLineDash([6 * frame.ratio, 4 * frame.ratio]);
    ctx.beginPath();
    state.drawingPoints.forEach((point, index) => {
      const [x, y] = toCanvas(point, frame);
      if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    state.drawingPoints.forEach((point, index) => {
      const [x, y] = toCanvas(point, frame);
      ctx.beginPath();
      ctx.arc(x, y, 6 * frame.ratio, 0, 2 * Math.PI);
      ctx.fill();
      ctx.font = `${13 * frame.ratio}px sans-serif`;
      ctx.fillText(`${index + 1} · ${CORNERS[index]}`, x + 10 * frame.ratio, y - 10 * frame.ratio);
    });
  }
  drawMagnifier();
  schedulePreview();
}

function schedulePreview() {
  if (state.previewFrame !== null) return;
  state.previewFrame = requestAnimationFrame(() => {
    state.previewFrame = null;
    rectifiedCtx.clearRect(0, 0, rectified.width, rectified.height);
    const previewStatus = document.querySelector("#preview-status");
    const angleStatus = document.querySelector("#card-angles");
    angleStatus.textContent = "";
    renderThumbnails();
    renderLayers();
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
      const preview = cardPreview(state.activeCard, profile.width, profile.height);
      rectifiedCtx.putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0);
      previewStatus.textContent = `${(preview.outsideFraction * 100).toFixed(1)}% outside capture · ${(preview.coveredFraction * 100).toFixed(1)}% covered by assigned layers · TL → TR → BR → BL`;
      const angles=geometry.measureQuad(state.sample.quads[state.activeCard],state.sourcePixels.width,state.sourcePixels.height,state.sample.metadata[state.activeCard].orientationKnown);
      const rotation=angles.printedRotationDegrees===null ? "Printed rotation unknown" : `Rotation ${angles.printedRotationDegrees.toFixed(1)}° (${angles.printedRotationDegrees>=0 ? "clockwise" : "counterclockwise"})`;
      angleStatus.textContent=`${rotation} · Perspective skew ${angles.skewDegrees.toFixed(1)}° · Image-plane angles`;
    } catch (error) {
      previewStatus.textContent = `Adjust corners: ${error.message}`;
    }
  });
}

function renderThumbnails() {
  const strip = document.querySelector("#card-thumbnails");
  const quads = state.sample?.quads || [];
  const profileName = document.querySelector("#preview-profile").value;
  const profile = geometry.PROFILES[profileName];
  const frameId = state.sample?.id || "";
  document.querySelector("#thumbnail-count").textContent = `Rectified cards · ${quads.length}`;
  if (strip.dataset.frame !== frameId || strip.children.length !== quads.length) {
    strip.replaceChildren();
    strip.dataset.frame = frameId;
    quads.forEach((_, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card-thumbnail";
      button.setAttribute("aria-label", `Select Card ${index + 1} preview`);
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = `Card ${index + 1}`;
      button.append(canvas, label);
      button.onclick = () => selectCard(index);
      strip.append(button);
    });
  }
  Array.from(strip.children).forEach((button, index) => {
    button.setAttribute("aria-pressed", String(index === state.activeCard));
    if (!state.sourcePixels) return;
    const mode = document.querySelector("#preview-mode").value;
    const signature = JSON.stringify([profileName, mode, quads[index], ...layerQuads(index)]);
    if (button.dataset.signature === signature) return;
    const canvas = button.querySelector("canvas");
    canvas.width = 84;
    canvas.height = Math.round(84 * profile.height / profile.width);
    try {
      const preview = cardPreview(index, canvas.width, canvas.height);
      canvas.getContext("2d").putImageData(new ImageData(preview.data, preview.width, preview.height), 0, 0);
      button.dataset.error = "false";
      button.title = `Card ${index + 1} · ${(preview.outsideFraction * 100).toFixed(1)}% outside capture`;
    } catch (error) {
      button.dataset.error = "true";
      button.title = `Card ${index + 1}: ${error.message}`;
    }
    // Redraw only changed corners/profile; selecting a card never rewarps all cards.
    button.dataset.signature = signature;
  });
}

function selectCard(index) {
  if (!state.sample?.quads.length || state.dragging || state.panning || state.drawingPoints !== null) return;
  state.activeCard = geometry.cycleCard(index, state.sample.quads.length, 0);
  state.compareCard = "overlapping";
  state.activeCorner = 0;
  renderControls();
  draw();
}

function matchingSuggestedCard(candidate) {
  return state.sample.quads.findIndex(quad=>geometry.quadIoU(quad,candidate.quad)>=0.8);
}

function renderSuggestions() {
  const suggestions=state.suggestions;
  const button=document.querySelector("#suggest-outlines");
  button.disabled=!state.sample || state.loading || state.drawingPoints!==null || suggestions?.status==="running";
  button.textContent=suggestions?.status==="running" ? "Finding outlines…" : "Suggest card outlines";
  document.querySelector("#suggestion-panel").hidden=!suggestions;
  if (!suggestions) return;
  document.querySelector("#close-suggestions").disabled=suggestions.status==="running";
  const candidates=suggestions.candidates || [];
  const missing=candidates.filter(c=>matchingSuggestedCard(c)<0);
  document.querySelector("#suggestion-status").textContent=suggestions.status==="complete"
    ? candidates.length
      ? `${candidates.length} suggested outlines · ${missing.length} missing from this frame · ${suggestions.seconds}s. Added drafts need Save all cards.`
      : "No complete card outlines passed the checks. You can draw missing or covered cards with Add card."
    : suggestions.message;
  const all=document.querySelector("#add-suggestions");
  all.hidden=suggestions.status!=="complete" || !missing.length;
  all.disabled=state.drawingPoints!==null;
  const tray=document.querySelector("#suggestion-cards");
  tray.replaceChildren();
  candidates.forEach((candidate,index)=>{
    const item=document.createElement("div"); item.className="suggestion-card";
    const preview=document.createElement("button");
    preview.className=index===suggestions.highlight ? "active" : "";
    preview.setAttribute("aria-pressed",String(index===suggestions.highlight));
    const canvas=document.createElement("canvas"); canvas.width=84; canvas.height=117;
    if (state.sourcePixels) {
      const pixels=geometry.rectify(state.sourcePixels,candidate.quad,canvas.width,canvas.height);
      canvas.getContext("2d").putImageData(new ImageData(pixels.data,pixels.width,pixels.height),0,0);
    }
    preview.append(canvas,`Suggestion ${index+1}`);
    preview.onclick=()=>{
      suggestions.highlight=index; renderSuggestions(); draw();
      editor.scrollIntoView({block:"nearest"});
    };
    const add=document.createElement("button");
    const match=matchingSuggestedCard(candidate);
    add.textContent=match>=0 ? `Already Card ${match+1}` : "Add draft";
    add.disabled=match>=0 || state.drawingPoints!==null;
    add.onclick=()=>addSuggestedOutlines([candidate]);
    item.append(preview,add); tray.append(item);
  });
}

function addSuggestedOutlines(candidates) {
  if (state.loading || state.saving || state.dragging || state.drawingPoints!==null) return;
  let added=0;
  for (const candidate of candidates) {
    if (geometry.labelQuadError(candidate.quad) || matchingSuggestedCard(candidate)>=0) continue;
    const index=state.sample.quads.length, quad=clone(candidate.quad);
    const ids=new Set(state.sample.metadata.map(item=>item.physicalCardId));
    let id=index;
    while (ids.has(`${state.sample.key}:card-${id}`)) id++;
    const order=Math.max(-1,...state.sample.metadata.map(item=>item.occlusionOrder))+1;
    state.sample.quads.push(quad);
    state.sample.metadata.push({physicalCardId:`${state.sample.key}:card-${id}`,occlusionOrder:order,
      orientationKnown:false,side:"unknown",
      cornerVisibility:quad.map(([x,y])=>x<0 || x>1 || y<0 || y>1 ? "outsideFrame" : "visible")});
    if (!added) state.activeCard=index;
    added++;
  }
  if (added) {
    state.dirty=true; state.pendingSuggestedDrafts=true;
    state.sample.draftSource="detector"; state.sample.finalized=false; state.sample.noLabelableCard=false;
    state.activeCorner=0; state.compareCard="overlapping";
    state.suggestions.highlight=null;
    renderControls(); draw();
    status(`${added} draft${added===1 ? "" : "s"} added. Check the corners, side and printed top; rotate if needed, then Save all cards.`);
  }
}

async function suggestOutlines() {
  if (!state.sample || state.loading || state.saving || state.drawingPoints!==null || state.suggestions?.status==="running") return;
  const generation=++state.suggestionGeneration, sampleId=state.sample.id, started=Date.now();
  state.suggestions={status:"running",message:"Starting SAM 2.1 Large locally…",candidates:[],highlight:null};
  renderSuggestions(); draw();
  const current=()=>generation===state.suggestionGeneration && sampleId===state.sample?.id;
  try {
    let job=await jsonRequest(`/api/outline-suggestions/${encodeURIComponent(sampleId)}`,{method:"POST"});
    while (current()) {
      if (job.sampleId!==sampleId) throw Error("Suggestions belong to a different photo. Try again.");
      if (job.status==="error") throw Error(job.message);
      if (job.status==="complete") {
        // A newly expanded tray must not move the image under a held corner.
        while (current() && (state.dragging || state.panning)) await new Promise(resolve=>setTimeout(resolve,100));
        if (!current()) return;
        state.suggestions={...job.result,status:"complete",highlight:null,
          candidates:job.result.candidates.filter(c=>!geometry.labelQuadError(c.quad))};
        renderSuggestions(); draw(); return;
      }
      state.suggestions.message=`${job.message} ${Math.round((Date.now()-started)/1000)}s elapsed. You can keep editing.`;
      renderSuggestions();
      await new Promise(resolve=>setTimeout(resolve,1000));
      if (!current()) return;
      job=await jsonRequest(`/api/outline-suggestions/jobs/${encodeURIComponent(job.id)}`);
    }
  } catch (error) {
    if (!current()) return;
    state.suggestions={status:"error",message:`${error.message} Your outlines have not been changed.`,candidates:[]};
    renderSuggestions();
  }
}
document.querySelector("#suggest-outlines").onclick=suggestOutlines;
document.querySelector("#add-suggestions").onclick=()=>addSuggestedOutlines(state.suggestions?.candidates || []);
document.querySelector("#close-suggestions").onclick=()=>{
  state.suggestionGeneration++; state.suggestions=null; renderSuggestions(); draw();
};

function cycleCard(direction) {
  if (!state.sample?.quads.length) return;
  selectCard(geometry.cycleCard(state.activeCard, state.sample.quads.length, direction));
}

// Tab switches cards only in the editing surface, not in forms elsewhere.
// Escape exits this keyboard mode so ordinary focus navigation is available.
function editingKey(event) {
  if (event.altKey || event.ctrlKey || event.metaKey || state.dragging) return;
  if (state.drawingPoints !== null) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelDrawing();
    }
    return;
  }
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
  } else if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    rotateCard(event.shiftKey ? -1 : 1);
  }
}
editor.addEventListener("keydown", editingKey);
document.querySelector("#cards").addEventListener("keydown", editingKey);
document.querySelector("#previous-card").onclick = () => cycleCard(-1);
document.querySelector("#next-card").onclick = () => cycleCard(1);
document.querySelector("#preview-profile").onchange = schedulePreview;
document.querySelector("#preview-mode").onchange = schedulePreview;

function layerQuads(index) {
  const relations = state.sample?.occlusionRelations || [];
  const quads = state.sample?.quads || [];
  const upper = layers.above(relations,index);
  const lower = quads.map((_,i)=>i).filter(i=>layers.above(relations,i).includes(index));
  return [upper.map(i=>quads[i]),lower.map(i=>quads[i])];
}
function cardPreview(index,width,height) {
  return geometry.layerPreview(state.sourcePixels,state.sample.quads[index],width,height,
    ...layerQuads(index),document.querySelector("#preview-mode").value);
}
function relativeLayer(first,second) {
  const relations = state.sample?.occlusionRelations || [];
  return layers.above(relations,second).includes(first) ? "above"
    : layers.above(relations,first).includes(second) ? "below" : "unknown";
}
function overlappingCards(index=state.activeCard) {
  const quads=state.sample?.quads || [];
  return quads.map((_,i)=>i).filter(i=>i!==index && geometry.quadsOverlap(quads[index],quads[i]));
}
function setOverlappingLayers(direction) {
  if (state.dragging || state.panning || state.drawingPoints !== null) return;
  const targets=overlappingCards();
  if (!targets.length) return;
  try {
    state.sample.occlusionRelations=layers.moveRelativeTo(state.sample.occlusionRelations || [],state.activeCard,targets,direction,state.sample.quads.map((_,i)=>i));
    state.dirty=true;
    draw();
    status(`Card ${state.activeCard+1} is ${direction} all ${targets.length} overlapping cards. Their previews updated too. Save all cards to keep the order.`);
  } catch (error) { status(error.message,"error"); }
}
function setLayer(direction,other=state.compareCard) {
  if (other==="overlapping") return setOverlappingLayers(direction);
  if (state.dragging || state.drawingPoints !== null || !state.sample?.quads[other]) return;
  try {
    const pair = direction === "above" ? [state.activeCard,other] : [other,state.activeCard];
    state.sample.occlusionRelations = layers.setRelation(state.sample.occlusionRelations || [],...pair,state.sample.quads.map((_,i)=>i));
    state.compareCard = other;
    state.dirty = true;
    draw();
    status(`Card ${state.activeCard+1} is ${direction} Card ${other+1}. Save all cards in frame to keep this order.`);
  } catch (error) { status(error.message,"error"); }
}
function renderLayers() {
  const quads = state.sample?.quads || [], active = state.activeCard;
  const pairs = [];
  for (let i=0;i<quads.length;i++) for (let j=i+1;j<quads.length;j++) {
    if (geometry.quadsOverlap(quads[i],quads[j])) pairs.push([i,j]);
  }
  const unknown = pairs.filter(([a,b])=>relativeLayer(a,b)==="unknown").length;
  document.querySelector("#frame-overlaps").textContent = `Whole photo: ${pairs.length} overlapping pairs · ${unknown} orders unknown`;
  const others = quads.map((_,i)=>i).filter(i=>i!==active);
  if (state.compareCard!=="overlapping" && !others.includes(state.compareCard)) state.compareCard="overlapping";
  const select = document.querySelector("#layer-other");
  select.replaceChildren(new Option("All overlapping cards","overlapping"),...others.map(i=>new Option(`Card ${i+1}`,i)));
  select.value = state.compareCard;
  const disabled = !others.length || state.drawingPoints !== null;
  select.disabled=disabled;
  const overlaps=overlappingCards(), all=state.compareCard==="overlapping";
  const targets=all ? overlaps : [state.compareCard];
  const aboveCount=targets.filter(i=>relativeLayer(active,i)==="above").length;
  const belowCount=targets.filter(i=>relativeLayer(active,i)==="below").length;
  const relationship=(first,second)=>relativeLayer(first,second)==="unknown"
    ? `Card ${first+1} / Card ${second+1}: order unknown`
    : `Card ${first+1} is ${relativeLayer(first,second).toUpperCase()} Card ${second+1}`;
  document.querySelector("#layer-relationship").textContent = all
    ? !overlaps.length ? "No other card overlaps this card."
      : `Card ${active+1} overlaps ${overlaps.length} cards · above ${aboveCount} · below ${belowCount} · ${overlaps.length-aboveCount-belowCount} unknown`
    : relationship(active,state.compareCard);
  for (const [id,direction,count] of [["layer-forward","above",aboveCount],["layer-backward","below",belowCount]]) {
    const button=document.querySelector(`#${id}`);
    button.textContent=all ? direction==="above" ? "Bring to front ↑" : "Send to back ↓"
      : `${direction==="above" ? "Above" : "Below"} Card ${state.compareCard+1} ${direction==="above" ? "↑" : "↓"}`;
    button.disabled=disabled || !targets.length || count===targets.length;
    button.setAttribute("aria-pressed",String(targets.length>0 && count===targets.length));
  }
  const list = document.querySelector("#overlap-list");
  list.replaceChildren();
  for (const other of overlaps) {
    const row=document.createElement("div"), title=document.createElement("span"), buttons=document.createElement("div");
    row.className="overlap-row"; buttons.className="button-row";
    title.textContent=relationship(active,other);
    for (const direction of ["above","below"]) {
      const button=document.createElement("button");
      button.textContent=direction==="above" ? "Above ↑" : "Below ↓";
      button.setAttribute("aria-label",`Place Card ${active+1} ${direction} Card ${other+1}`);
      button.setAttribute("aria-pressed",String(relativeLayer(active,other)===direction));
      button.disabled=disabled || relativeLayer(active,other)===direction;
      button.onclick=()=>setLayer(direction,other);
      buttons.append(button);
    }
    row.append(title,buttons); list.append(row);
  }
  const assigned=document.querySelector("#layer-list");
  assigned.replaceChildren();
  (state.sample?.occlusionRelations || []).forEach((relation,index)=>{
    const button=document.createElement("button");
    const label=`Card ${relation.above+1} above Card ${relation.below+1}`;
    button.textContent=`${label} ×`; button.setAttribute("aria-label",`Remove ${label}`); button.disabled=disabled;
    button.onclick=()=>{ state.sample.occlusionRelations.splice(index,1); state.dirty=true; draw(); status("Layer removed. Save all cards in frame to keep this change."); };
    assigned.append(button);
  });
  document.querySelector("#preview-legend").textContent = document.querySelector("#preview-mode").value === "layers"
    ? "Pink: covered by a card above · Green: above another card."
    : document.querySelector("#preview-mode").value === "masked" ? "Checkerboard: covered or outside the photo. Unknown order stays unmasked." : "Original photo pixels; masking is off.";
}
document.querySelector("#layer-other").onchange=event=>{state.compareCard=event.target.value==="overlapping" ? "overlapping" : Number(event.target.value);renderLayers();};
document.querySelector("#layer-forward").onclick=()=>setLayer("above");
document.querySelector("#layer-backward").onclick=()=>setLayer("below");

function rotateCard(turns) {
  if (!state.sample?.quads.length || state.dragging || state.panning || state.drawingPoints !== null) return;
  const index=state.activeCard, k=(turns%4+4)%4;
  const rotate=values=>values.slice(k).concat(values.slice(0,k));
  state.sample.quads[index]=rotate(state.sample.quads[index]);
  state.sample.metadata[index].cornerVisibility=rotate(state.sample.metadata[index].cornerVisibility);
  state.activeCorner=0; state.dirty=true;
  renderControls(); draw();
  status(`Card ${index+1} rotated. Check its printed top and save all cards in frame.`);
}
document.querySelector("#rotate-left").onclick=()=>rotateCard(1);
document.querySelector("#rotate-right").onclick=()=>rotateCard(-1);

function zoomPhoto(scale,anchor) {
  if (!state.image || state.dragging || state.panning) return;
  const rect=editor.getBoundingClientRect();
  const client=anchor || {clientX:rect.left+rect.width/2,clientY:rect.top+rect.height/2};
  const before=fromPointer(client,false);
  state.view.scale=Math.max(1,Math.min(8,scale));
  const frame=fit(), [x,y]=toCanvas(before,frame);
  state.view.tx+=((client.clientX-rect.left)*editor.width/rect.width-x)/frame.ratio;
  state.view.ty+=((client.clientY-rect.top)*editor.height/rect.height-y)/frame.ratio;
  if (state.view.scale===1) state.view.tx=state.view.ty=0;
  updateViewControls(); draw();
}
function updateViewControls() {
  document.querySelector("#photo-zoom").value=state.view.scale*100;
  document.querySelector("#photo-zoom-value").textContent=`${Math.round(state.view.scale*100)}%`;
  document.querySelector("#pan-photo").setAttribute("aria-pressed",String(state.panMode));
  editor.classList.toggle("pan-ready",state.panMode || state.spacePan);
}
document.querySelector("#photo-zoom").oninput=event=>zoomPhoto(Number(event.target.value)/100);
document.querySelector("#zoom-in").onclick=()=>zoomPhoto(state.view.scale*1.25);
document.querySelector("#zoom-out").onclick=()=>zoomPhoto(state.view.scale/1.25);
document.querySelector("#fit-photo").onclick=()=>zoomPhoto(1);
document.querySelector("#pan-photo").onclick=()=>{state.panMode=!state.panMode;updateViewControls();};
editor.addEventListener("wheel",event=>{
  event.preventDefault(); zoomPhoto(state.view.scale*Math.exp(-event.deltaY*.002),event);
},{passive:false});
editor.addEventListener("pointerenter",()=>{state.pointerOverEditor=true;});
editor.addEventListener("pointerleave",()=>{state.pointerOverEditor=false;});
document.addEventListener("keydown",event=>{
  if (event.code!=="Space" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (state.loading || state.saving || !state.sourcePixels) return;
  // Space over the photo temporarily pans. Keep normal Space behavior in
  // fields and controls when the user is working elsewhere in the interface.
  if (event.target.closest?.("input:not([type='range']),select,textarea,[contenteditable]:not([contenteditable='false'])")) return;
  if (document.activeElement!==editor && !state.pointerOverEditor) return;
  event.preventDefault();
  state.spacePan=true;
  editor.focus({preventScroll:true});
  updateViewControls();
});
document.addEventListener("keyup",event=>{
  if (event.code!=="Space" || !state.spacePan) return;
  event.preventDefault(); state.spacePan=false; updateViewControls();
});
function clearPanShortcut() {
  state.spacePan=false;
  if (state.panning) endDrag({type:"pointerup",pointerId:state.panning.pointerId});
  if (state.dragging) endDrag({type:"pointercancel",pointerId:state.dragPointerId});
  updateViewControls();
}
window.addEventListener("blur",clearPanShortcut);
document.addEventListener("visibilitychange",()=>{if (document.hidden) clearPanShortcut();});

function drawMagnifier() {
  const overlay = document.querySelector("#floating-magnifier");
  overlay.hidden = !state.dragging || !state.image || !state.sample?.quads.length;
  document.body.classList.toggle("corner-magnifying",!overlay.hidden);
  if (overlay.hidden) return;
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
  // Keep the zoom canvas crosshair exactly over the source corner. Account for
  // the title and border above it; centering the whole panel would offset it.
  const rect = editor.getBoundingClientRect();
  const frame = fit();
  const [cx, cy] = toCanvas(point, frame);
  const x = rect.left + cx * rect.width / editor.width;
  const y = rect.top + cy * rect.height / editor.height;
  const panel = overlay.getBoundingClientRect();
  const lens = magnifier.getBoundingClientRect();
  overlay.style.left = `${x - (lens.left - panel.left + lens.width / 2)}px`;
  overlay.style.top = `${y - (lens.top - panel.top + lens.height / 2)}px`;
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
  if (!state.sample || state.dragging || state.panning || ![0,1].includes(event.button)) return;
  editor.focus({preventScroll: true});
  if (event.button===1 || state.panMode || state.spacePan) {
    event.preventDefault();
    state.panning={x:event.clientX,y:event.clientY,tx:state.view.tx,ty:state.view.ty,pointerId:event.pointerId};
    editor.setPointerCapture(event.pointerId); editor.classList.add("panning");
    return;
  }
  if (state.drawingPoints !== null) {
    placeCardCorner(fromPointer(event));
    return;
  }
  const handle = nearestHandle(event);
  if (!handle) {
    const rect = editor.getBoundingClientRect();
    const point = [event.clientX - rect.left, event.clientY - rect.top];
    const frame = fit();
    const quads = state.sample.quads.map(quad => quad.map(p => {
      const [x, y] = toCanvas(p, frame);
      return [x * rect.width / editor.width, y * rect.height / editor.height];
    }));
    const card = geometry.cardAtPoint(quads, point, state.activeCard);
    if (card !== null) {
      selectCard(card);
      status(`Card ${card + 1} selected. Drag a corner to adjust it.`);
    } else {
      status("Click an outlined card or its preview to select it. Use Add card for a missing outline.");
    }
    return;
  }
  [state.activeCard, state.activeCorner] = handle;
  state.dragging = true;
  state.dragSnapshot = clone(state.sample.quads[state.activeCard]);
  state.dragMetadataSnapshot = clone(state.sample.metadata[state.activeCard]);
  state.dragPointerStart = fromPointer(event, false);
  state.dragPointerId = event.pointerId;
  editor.setPointerCapture(event.pointerId);
  editor.classList.add("dragging");
  // Selecting a handle must not snap it to the cursor's edge.
  renderControls();
  draw();
  status(`Dragging Card ${state.activeCard + 1} ${CORNERS[state.activeCorner]}…`);
});
editor.addEventListener("pointermove", (event) => {
  if (state.panning) {
    state.view.tx=state.panning.tx+event.clientX-state.panning.x;
    state.view.ty=state.panning.ty+event.clientY-state.panning.y;
    draw(); return;
  }
  if (!state.dragging) return;
  // Preserve the grab offset: clicking near a handle must not make its corner
  // snap to the cursor on the first move. Clamp the resulting corner, not the
  // pointer, so off-center grabs also work at the exterior canvas boundary.
  const pointer = fromPointer(event, false);
  const start = state.dragSnapshot[state.activeCorner];
  state.sample.quads[state.activeCard][state.activeCorner] = start.map((value, axis) =>
    Math.max(-MARGIN, Math.min(1 + MARGIN, value + (pointer[axis] - state.dragPointerStart[axis]))));
  updateVisibility();
  draw();
});
async function endDrag(event) {
  if (state.panning) {
    if (event.type==="pointercancel") {state.view.tx=state.panning.tx;state.view.ty=state.panning.ty;}
    state.panning=null; editor.classList.remove("panning");
    if (editor.hasPointerCapture(event.pointerId)) editor.releasePointerCapture(event.pointerId);
    draw(); return;
  }
  if (!state.dragging) return;
  state.dragging = false;
  state.dragPointerStart = null;
  state.dragPointerId = null;
  document.querySelector("#floating-magnifier").hidden = true;
  document.body.classList.remove("corner-magnifying");
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
  const unchanged = JSON.stringify(state.sample.quads[state.activeCard]) === JSON.stringify(state.dragSnapshot);
  if (unchanged) return;
  state.dirty = true;
  if (!unchanged) renderControls();
  if (state.sample.draftSource === "detector") {
    status("Corner adjusted. Save all cards in frame to approve the outlines; unchanged corners need no clicks.");
    return;
  }
  await persist(false, `Saved Card ${state.activeCard + 1} ${CORNERS[state.activeCorner]}`);
}
editor.addEventListener("pointerup", endDrag);
editor.addEventListener("pointercancel", endDrag);
editor.addEventListener("lostpointercapture", event=>endDrag({type:"pointercancel",pointerId:event.pointerId}));

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
  if (state.saving) return false;
  state.saving=true; updateSaveControls();
  try {
    await jsonRequest(`/api/sample/${state.sample.id}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        quads: state.sample.quads,
        metadata: state.sample.metadata,
        occlusionRelations: state.sample.occlusionRelations || [],
        sceneSlice: state.sample.sceneSlice,
        finalize,
        noLabelableCard: false,
      }),
    });
    state.dirty = false;
    state.pendingSuggestedDrafts = false;
    state.sample.finalized = finalize;
    if (finalize) state.sample.draftSource = null;
    renderControls();
    draw();
    await refreshProgress();
    status(message, "ok");
    return true;
  } catch (error) {
    status(`Save failed: ${error.message}`, "error");
    return false;
  } finally {
    state.saving=false; updateSaveControls();
  }
}

function updateSaveControls() {
  const busy=state.saving || state.loading;
  document.querySelector("main").inert=busy;
  document.querySelector("header").inert=busy;
  for (const id of ["save","save-visible","save-next"]) {
    document.querySelector(`#${id}`).disabled=busy || state.drawingPoints !== null;
  }
}

function renderProgress() {
  const element = document.querySelector("#minimum-progress");
  const label = (state.progress.sceneSlice || "binder_page").replaceAll("_", " ");
  element.textContent = `${label}: ${state.progress.finalizedInstances}/${state.progress.minimum}`;
  element.className = state.progress.ready ? "ready" : "";
}

async function refreshProgress() {
  const payload = await jsonRequest("/api/samples");
  state.samples = payload.samples;
  state.progress = payload.progress;
  renderProgress();
  for (const sample of state.samples) {
    const option = Array.from(document.querySelector("#sample").options).find(o => o.value === sample.id);
    if (option) option.textContent = sampleLabel(sample);
  }
}

function renderControls() {
  rememberPosition();
  renderSuggestions();
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
  side.onchange = () => { item.side = side.value; state.dirty = true; };
  sideLabel.append(side);
  metadata.append(sideLabel);
  const orientation = document.createElement("label");
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = item.orientationKnown;
  check.onchange = () => { item.orientationKnown = check.checked; state.dirty = true; schedulePreview(); };
  orientation.append(check, "Orientation known");
  metadata.append(orientation);
  CORNERS.forEach((name, cornerIndex) => {
    const label = document.createElement("label");
    label.append(name);
    const select = document.createElement("select");
    ["visible", "occluded", "outsideFrame"].forEach((value) => select.add(new Option(value, value)));
    select.value = item.cornerVisibility[cornerIndex];
    select.onchange = () => {
      item.cornerVisibility[cornerIndex] = select.value;
      state.dirty = true;
    };
    label.append(select);
    metadata.append(label);
  });
}

function addCard() {
  if (!state.sourcePixels || !state.sample || state.dragging || state.drawingPoints !== null) return;
  state.drawingPoints = [];
  state.panMode = false; updateViewControls();
  updateDrawingControls();
  editor.focus({preventScroll: true});
  status("New card: click printed top-left first, then the other three corners in any order. Esc cancels.");
  draw();
}

function updateDrawingControls() {
  const drawing = state.drawingPoints !== null;
  document.querySelector("#cancel-drawing").hidden = !drawing;
  for (const id of ["add", "add-card-top", "save", "delete", "no-card", "rotate-left", "rotate-right", "pan-photo"]) {
    document.querySelector(`#${id}`).disabled = drawing;
  }
  document.querySelector("#drag-hint").textContent = drawing
    ? "Printed top-left first, then the other three corners in any order · Esc cancels"
    : "Click a card or thumbnail to select · Click overlapping cards again to cycle · Drag a selected corner to adjust";
  updateSaveControls();
  renderSuggestions();
}

function cancelDrawing() {
  if (state.drawingPoints === null) return;
  state.drawingPoints = null;
  updateDrawingControls();
  draw();
  status("Drawing cancelled. Existing outlines are unchanged.");
}

function placeCardCorner(point) {
  state.drawingPoints.push(point);
  if (state.drawingPoints.length < 4) {
    status(`New card: click another corner (${state.drawingPoints.length + 1}/4). Either direction works. Esc cancels.`);
    draw();
    return;
  }
  const quad = geometry.orderClickedCorners(state.drawingPoints);
  const error = geometry.labelQuadError(quad);
  if (error) {
    state.drawingPoints.pop();
    status(`Outline not added: ${error}. Place the fourth point again, or Esc to restart.`, "error");
    draw();
    return;
  }
  const index = state.sample.quads.length;
  state.drawingPoints = null;
  const existingIds = new Set(state.sample.metadata.map(item => item.physicalCardId));
  let cardId = index;
  while (existingIds.has(`${state.sample.key}:card-${cardId}`)) cardId++;
  state.sample.quads.push(quad);
  state.sample.metadata.push({
    physicalCardId: `${state.sample.key}:card-${cardId}`,
    occlusionOrder: index,
    orientationKnown: true,
    side: "faceUp",
    cornerVisibility: quad.map(([x, y]) => x < 0 || x > 1 || y < 0 || y > 1 ? "outsideFrame" : "visible"),
  });
  state.activeCard = index;
  state.activeCorner = 0;
  state.sample.noLabelableCard = false;
  state.dirty = true;
  updateDrawingControls();
  renderControls();
  draw();
  status(`Card ${index + 1} added. Adjust if needed, then Save all cards in frame.`);
}
document.querySelector("#add").onclick = addCard;
document.querySelector("#add-card-top").onclick = addCard;
document.querySelector("#cancel-drawing").onclick = cancelDrawing;
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.drawingPoints !== null) cancelDrawing();
});
document.querySelector("#scene-slice").onchange = (event) => {
  if (!state.sample) return;
  state.sample.sceneSlice = event.target.value;
  state.dirty = true;
  status(`This frame will save as ${event.target.selectedOptions[0].text}.`);
};
document.querySelector("#delete").onclick = async () => {
  if (!state.sample?.quads.length) return;
  if (state.sample.quads.length === 1) {
    status("A frame must keep at least one card. Adjust this outline instead.", "error");
    return;
  }
  const removed=state.activeCard;
  state.sample.occlusionRelations=(state.sample.occlusionRelations || [])
    .filter(r=>r.above!==removed && r.below!==removed)
    .map(r=>({above:r.above-(r.above>removed ? 1 : 0),below:r.below-(r.below>removed ? 1 : 0)}));
  state.sample.quads.splice(state.activeCard, 1);
  state.sample.metadata.splice(state.activeCard, 1);
  state.sample.metadata.forEach((item, index) => { item.occlusionOrder = index; });
  state.activeCard = Math.max(0, Math.min(state.activeCard, state.sample.quads.length - 1));
  state.dirty = true;
  renderControls();
  draw();
  if (state.pendingSuggestedDrafts) status("Draft removed. Save all cards when the remaining outlines are ready.");
  else await persist(false, "Card deleted and remaining draft saved");
};
document.querySelector("#no-card").onclick = async () => {
  if (!state.sample) return;
  const confirmed = window.confirm(
    "Mark this frame as having no labelable card?\n\n" +
    "Use this only when no physical card outline can be placed reliably. " +
    "If a card is visible but its identity is unknown, cancel and label its corners instead. " +
    "Any unsaved corners on this frame will be discarded.",
  );
  if (!confirmed) return;
  try {
    await jsonRequest(`/api/sample/${state.sample.id}`, {
      method: "PUT",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({
        quads: [],
        metadata: [],
        occlusionRelations: [],
        sceneSlice: state.sample.sceneSlice,
        finalize: true,
        noLabelableCard: true,
      }),
    });
    state.sample.quads = [];
    state.sample.metadata = [];
    state.sample.occlusionRelations = [];
    state.sample.noLabelableCard = true;
    state.sample.draftSource = null;
    state.sample.finalized = true;
    state.activeCard = 0;
    state.activeCorner = 0;
    state.dirty = false;
    renderControls();
    draw();
    await refreshProgress();
    status("Frame finalized with no labelable card.", "ok");
  } catch (error) {
    status(`Save failed: ${error.message}`, "error");
  }
};
async function saveFrame(next=false) {
  if (state.loading || state.saving) return;
  if (state.sample?.noLabelableCard && state.sample.finalized) {
    if (next && state.index+1<state.samples.length) await loadSample(state.index+1);
    else status("Frame already saved with no labelable card.","ok");
    return;
  }
  if (!state.sample?.quads.length) {
    status("Add a card, or use No labelable card to finalize this frame.", "error");
    return;
  }
  const saved=await persist(true, `Frame saved (${state.sample.quads.length} cards)`);
  if (saved && next) {
    if (state.index+1<state.samples.length) await loadSample(state.index+1);
    else status("Last photo saved. You have reached the end of this session.","ok");
  }
}
document.querySelector("#save").onclick=()=>saveFrame();
document.querySelector("#save-visible").onclick=()=>saveFrame();
document.querySelector("#save-next").onclick=()=>saveFrame(true);
document.querySelector("#zoom").oninput = drawMagnifier;
window.addEventListener("resize", draw);

async function loadSample(index,position={}) {
  state.loading=true;
  state.suggestionGeneration++;
  state.suggestions=null;
  state.pendingSuggestedDrafts=false;
  state.drawingPoints = null;
  updateDrawingControls();
  const nextIndex = (index + state.samples.length) % state.samples.length;
  const summary = state.samples[nextIndex];
  status("Loading page…");
  try {
    state.sample = await jsonRequest(`/api/sample/${summary.id}`);
  } catch (error) {
    state.loading=false; updateSaveControls();
    status(`Could not load photo: ${error.message}`,"error");
    return;
  }
  state.index=nextIndex;
  state.sample.occlusionRelations ||= [];
  state.compareCard="overlapping";
  state.view={scale:1,tx:0,ty:0}; state.panMode=false; state.spacePan=false; updateViewControls();
  state.dirty = false;
  document.querySelector("#scene-slice").value = state.sample.sceneSlice;
  state.sourcePixels = null;
  const savedCard=state.sample.metadata.findIndex(item=>position.physicalCardId && item.physicalCardId===position.physicalCardId);
  const requested=Number.isSafeInteger(position.card) ? position.card-1 : 0;
  state.activeCard = savedCard>=0 ? savedCard : Math.max(0,Math.min(requested,state.sample.quads.length-1));
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
    state.loading=false; updateSaveControls();
    document.querySelector("#preview-profile").value = geometry.defaultProfile(state.sample.game);
    renderControls();
    draw();
    const draft = state.sample.draftSource === "detector"
      ? " Detector outlines are drafts. Adjust only what needs fixing; Save all cards in frame approves the rest."
      : "";
    const negative = state.sample.noLabelableCard
      ? " This frame is finalized with no labelable card; use Add card to revise it."
      : "";
    status(`Ready — click a card or thumbnail to select it; Tab / Shift+Tab also switches cards.${draft}${negative}`, "ok");
  };
  state.image.onerror = () => {
    state.loading=false; updateSaveControls();
    status("Could not load source image", "error");
  };
  state.image.src = `${state.sample.imageUrl}?v=${Date.now()}`;
  document.querySelector("#sample").value = summary.id;
  document.querySelector("#page-count").textContent = `Page ${state.index + 1} of ${state.samples.length}`;
}
function confirmDiscard() {
  return (!state.dirty && !state.drawingPoints?.length) || window.confirm("Unsaved corner work will be discarded. Leave this frame?");
}
function requestSample(index) {
  if (confirmDiscard()) loadSample(index);
}
document.querySelector("#previous").onclick = () => requestSample(state.index - 1);
document.querySelector("#next").onclick = () => requestSample(state.index + 1);
document.querySelector("#sample").onchange = (event) => {
  const index = state.samples.findIndex((sample) => sample.id === event.target.value);
  if (confirmDiscard()) loadSample(index);
  else event.target.value = state.sample.id;
};
window.addEventListener("beforeunload", (event) => {
  if (!state.dirty && !state.drawingPoints?.length) return;
  event.preventDefault();
  event.returnValue = "";
});
async function start() {
  try {
    const payload = await jsonRequest("/api/samples");
    state.samples = payload.samples;
    state.resumeKey=`tcger-corner-editor-position:${payload.view || "default"}`;
    state.progress = payload.progress;
    renderProgress();
    const select = document.querySelector("#sample");
    state.samples.forEach((sample) => select.add(new Option(
      sampleLabel(sample),
      sample.id,
    )));
    const position=savedPosition();
    const index=state.samples.findIndex(sample=>sample.key===position.photo || sample.id===position.photo || sample.id===position.id);
    await loadSample(Math.max(0,index),index>=0 ? position : {});
  } catch (error) {
    status(`Startup failed: ${error.message}`, "error");
  }
}
start();

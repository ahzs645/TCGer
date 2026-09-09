/* Review copies of predictions. Benchmark source labels remain immutable. */
"use strict";
const $ = id => document.getElementById(id), G = window.CardEditorGeometry;
const clone = value => JSON.parse(JSON.stringify(value));
const canvas = $("photo"), ctx = canvas.getContext("2d");
let library, frame, cards = [], active = 0, source, pixels, filtered = [], history = [];
let dirty = false, busy = false, drawing = null, drag = null, view = {zoom:1,x:0,y:0};
const photoPositions = new Map();
const positionKey = "tcger-model-review-position-v1";
const sceneName = value => value.replaceAll("_", " ");
function status(text = "") { $("status").textContent = text; }
async function api(path, body) {
  const response = await fetch("/api/model-review/" + path, body === undefined ? {} : {
    method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed");
  return value;
}
function option(value, text) { const node=document.createElement("option"); node.value=value; node.textContent=text; return node; }
function snapshot() { history.push(clone(cards)); if(history.length>50)history.shift(); }
function edited() { dirty=true; $("verdict").value="draft"; $("saved").textContent="Unsaved edits · changing photos saves a draft"; }
function selection() { return cards[active]; }
function position() {
  if(!frame)return;
  const params=new URLSearchParams({set:$("batch").value,photo:frame.id,card:selection()?.id || ""});
  window.history.replaceState(null,"","/model-review.html?"+params);
  localStorage.setItem(positionKey,params.toString());
}
function rebuildList() {
  const batch=$("batch").value;
  const ids=batch==="examples" ? (library.comparison?.exampleIds||library.starter) : batch==="flagged" ? (library.comparison?.flaggedIds||[]) : batch==="starter" ? library.starter : null;
  filtered=ids ? ids.map(id=>library.frames.find(f=>f.id===id)).filter(Boolean)
    : library.frames.filter(f=>batch==="human" ? f.comparisonBasis==="human-corners" : batch==="imported" ? f.comparisonBasis==="imported-geometry" : batch==="imported-flagged" ? f.comparisonBasis==="imported-geometry"&&f.comparisonStatus==="flagged" : batch==="uploads" ? f.kind==="upload" : f.kind==="benchmark");
  $("frame").replaceChildren(...filtered.map(f=>option(f.id,`${f.reference} · ${sceneName(f.scene)} · ${f.cards} cards${f.status!=="unreviewed"?" · "+f.status:""}`)));
  $("progress").textContent=batch!=="uploads"&&library.comparison ? `${filtered.length} photos · comparison complete` : `${filtered.filter(f=>["approved","needs-work","unsure"].includes(f.status)).length} / ${filtered.length} reviewed`;
  if(frame)$("frame").value=frame.id;
  navigation();
}
function navigation() {
  const index=filtered.findIndex(f=>f.id===frame?.id);
  $("previous").disabled=busy||index<=0; $("next").disabled=busy||index<0||index>=filtered.length-1;
  for(const id of ["save","approve","add","copy"])$(id).disabled=busy||!frame;
  for(const id of ["batch","frame","upload"])$(id).disabled=busy;
  for(const id of ["notes","verdict","card"])$(id).disabled=busy||!frame;
  for(const id of ["rotate","exclude","upright","occluded","expected","reset"])$(id).disabled=busy||!selection();
  $("undo").disabled=busy||!history.length;
}
async function exclusive(fn) {
  if(busy)return;
  busy=true;navigation();
  try { await fn(); } catch(error) {status(error.message); if(frame)$("frame").value=frame.id;}
  finally {busy=false;navigation();}
}
async function save(verdict=$("verdict").value) {
  if(!frame)return;
  const review=await api("save/"+frame.id,{revision:frame.review?.revision||0,imageSha256:frame.imageSha256,
    modelSha256:frame.modelSha256,cards,notes:$("notes").value,verdict});
  frame.review=review;dirty=false;$("verdict").value=verdict;
  library.frames.find(f=>f.id===frame.id).status=verdict;
  rebuildList();$("saved").textContent=`Saved ${verdict} · revision ${review.revision}`;status();
}
async function load(id, cardId) {
  if(frame)photoPositions.set(frame.id,{card:selection()?.id,view:{...view}});
  if(!id){frame=null;cards=[];source=null;pixels=null;$("title").textContent="No photos in this set";$("context").textContent="Use Add photos to try the trained model on a new capture.";$("kind").textContent="Local collection";$("comparison").replaceChildren();$("automatic-comparison").hidden=true;$("notes").value="";renderCards();draw();return;}
  const nextFrame=await api("frame/"+id), image=new Image();
  image.src="/api/model-review/image/"+id;
  await image.decode();
  frame=nextFrame;source=image;
  const off=document.createElement("canvas");off.width=image.naturalWidth;off.height=image.naturalHeight;
  const offctx=off.getContext("2d",{willReadFrequently:true});offctx.drawImage(image,0,0);pixels=offctx.getImageData(0,0,off.width,off.height);
  const remembered=photoPositions.get(id);
  cards=clone(frame.review?.cards||frame.proposals);active=Math.max(0,cards.findIndex(c=>c.id===(cardId||remembered?.card)));history=[];dirty=false;drawing=null;view=remembered?.view||{zoom:1,x:0,y:0};
  $("notes").value=frame.review?.notes||"";$("verdict").value=frame.review?.verdict||"draft";
  $("title").textContent=`${frame.reference} · ${sceneName(frame.scene)}`;
  $("context").textContent=frame.kind==="upload" ? `${frame.name} · session ${frame.session}` : frame.id;
  $("kind").textContent=frame.kind==="benchmark" ? "Benchmark · evaluation only" : "Your new photo";
  $("approve").hidden=frame.kind==="benchmark";
  $("save").textContent=frame.kind==="benchmark" ? "Save optional feedback" : "Save review";
  $("review-hint").textContent=frame.kind==="benchmark" ? "Comparison is complete. Optional corrections or notes stay separate from your saved reference labels." : "Approve after checking every card. Photos with no cards are useful too.";
  $("saved").textContent=frame.review ? `Saved ${frame.review.verdict} · revision ${frame.review.revision}` : "Edits are saved as a draft when you change photos.";
  $("show-previous").disabled=!frame.previous.length;$("show-reference").disabled=!frame.referencePolygons.length;
  $("drawing-hint").textContent="";$("add").textContent="＋ Draw missed card";
  status(frame.kind==="upload" ? frame.warning : "");
  $("comparison").replaceChildren();
  if(frame.metrics)for(const [key,label] of [["previous","Previous model"],["current","New model"]]) {
    const m=frame.metrics[key], item=document.createElement("div"), heading=document.createElement("strong");heading.textContent=label;item.append(heading,`${m.found} detections · ${m.misses} misses · ${m.extras} extras · ${m.loose} loose matches`);$("comparison").append(item);
  }
  if(frame.metrics){const note=document.createElement("p");note.textContent="Frozen benchmark scores, before review edits. Reference polygons may describe visible regions.";$("comparison").append(note);}
  renderComparison();
  rebuildList();renderCards();resize();position();
}
function renderComparison() {
  const report=frame?.comparison, panel=$("automatic-comparison");panel.replaceChildren();panel.hidden=!report;
  if(!report)return;
  const title=document.createElement("strong"), note=document.createElement("p"), reasons=document.createElement("p");
  title.textContent=report.inspection ? (report.inspection.outcome==="close-agreement"?"Checked: model agrees with your saved borders":"Checked: model issue") : `Automatic comparison: ${sceneName(report.current.status.replaceAll("-","_"))}`;
  note.textContent=report.inspection?.note || (report.current.basis==="human-corners"?"Compared with your saved human corner labels.":"Compared with imported reference geometry; precise human corner labels are unavailable.");
  reasons.textContent=report.current.reasons.join(" · ") || "All cards match closely. No repeat labeling is needed.";
  panel.className=report.current.status==="close-agreement"?"agreement":"difference";panel.append(title,note,reasons);
  if(frame.review){const notice=document.createElement("p");notice.textContent="Comparison describes the frozen model output before your optional feedback edits.";panel.append(notice);}
}
async function move(delta) {
  const index=filtered.findIndex(f=>f.id===frame?.id), next=filtered[index+delta];
  if(!next)return;
  if(dirty)await save();
  await load(next.id);
}
function transform() {
  const width=canvas.width,height=canvas.height;
  const scale=source ? Math.min(width/source.naturalWidth,height/source.naturalHeight)*.82*view.zoom : 1;
  return {scale,left:(width-(source?.naturalWidth||0)*scale)/2+view.x,top:(height-(source?.naturalHeight||0)*scale)/2+view.y};
}
function screen(point) {const t=transform();return [t.left+point[0]*source.naturalWidth*t.scale,t.top+point[1]*source.naturalHeight*t.scale];}
function eventPoint(event) {const rect=canvas.getBoundingClientRect();return [(event.clientX-rect.left)*canvas.width/rect.width,(event.clientY-rect.top)*canvas.height/rect.height];}
function world(point) {const t=transform();return [(point[0]-t.left)/(source.naturalWidth*t.scale),(point[1]-t.top)/(source.naturalHeight*t.scale)];}
function polygon(points,color,width=2,dashed=false) {
  ctx.beginPath();points.forEach((p,i)=>{const q=screen(p);i?ctx.lineTo(...q):ctx.moveTo(...q);});ctx.closePath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dashed?[7,5]:[]);ctx.stroke();ctx.setLineDash([]);
}
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);if(!source)return;
  const t=transform();ctx.drawImage(source,t.left,t.top,source.naturalWidth*t.scale,source.naturalHeight*t.scale);
  if($("show-reference").checked)frame.referencePolygons.forEach((p,i)=>{polygon(p,"#ffce71",2,true);const label=screen(p[0]);ctx.font="12px system-ui";ctx.fillStyle="#ffce71";ctx.fillText(`T${i+1}`,label[0]+4,label[1]+16);});
  if($("show-previous").checked)frame.previous.forEach(c=>polygon(c.corners,"#fa92da",2,true));
  if($("show-current").checked)cards.forEach((card,i)=>{
    polygon(card.corners,card.excluded?"#9b8d8d":i===active?"#ffffff":"#96f9b7",i===active?3:2,card.excluded);
    const first=screen(card.corners[0]);ctx.fillStyle="#0b221be6";ctx.fillRect(first[0]-3,first[1]-24,38,20);ctx.fillStyle="#fff";ctx.font="12px system-ui";ctx.fillText(card.id,first[0]+1,first[1]-10);
    if(i===active&&!card.excluded)card.corners.forEach((p,n)=>{const q=screen(p);ctx.beginPath();ctx.arc(...q,9,0,Math.PI*2);ctx.fillStyle=n===0?"#ffce71":"#96f9b7";ctx.fill();ctx.strokeStyle="#0b2014";ctx.lineWidth=2;ctx.stroke();ctx.fillStyle="#102316";ctx.textAlign="center";ctx.fillText(String(n+1),q[0],q[1]+4);ctx.textAlign="start";});
  });
  if(drawing)for(const p of drawing){const q=screen(p);ctx.beginPath();ctx.arc(...q,6,0,Math.PI*2);ctx.fillStyle="#ffce71";ctx.fill();}
}
function resize() {const box=$("stage").getBoundingClientRect();canvas.width=Math.round(box.width);canvas.height=Math.round(box.height);draw();}
function crop(card,target) {
  const context=target.getContext("2d");context.clearRect(0,0,target.width,target.height);
  if(!pixels||!card||card.excluded||G.validQuad(card.corners))return;
  const result=G.rectify(pixels,card.corners,target.width,target.height);
  context.putImageData(new ImageData(result.data,target.width,target.height),0,0);
}
function renderSelected() {
  const card=selection();crop(card,$("crop"));
  const report=frame?.comparison?.current, match=report?.matches.find(m=>m.cardId===card?.id);
  const truth=match&&report.referenceInstances.find(t=>t.id===match.truthId);
  $("reference-crop-panel").hidden=!truth?.human;
  crop(truth?.human?truth:null,$("reference-crop"));
  $("corner-comparison").textContent=match ? `${match.cardId} ↔ ${match.truthId} · ${(match.iou*100).toFixed(1)}% overlap${match.human?` · mean corner offset ${match.meanCornerPixels.toFixed(1)} px`:""}${match.topMismatch?" · printed top differs":""}${frame.review?" (frozen prediction)":""}` : report&&card?"Unmatched prediction. It may be an extra region or a real card missing from the reference labels.":"";
  $("crop-caption").textContent=card?`${frame.reference} / ${card.id}${card.excluded?" · excluded":""}`:"No detections · draw a missed card, or approve an empty photo";
  for(const id of ["rotate","exclude","upright","occluded","expected","reset"])$(id).disabled=!card;
  $("upright").checked=card?.orientationKnown||false;$("occluded").checked=card?.occluded||false;$("expected").value=card?.expectedCard||"";
  $("exclude").textContent=card?.excluded?"Restore card":"Not a card";$("undo").disabled=!history.length;
}
function renderCards() {
  $("card").replaceChildren(...cards.map(c=>option(c.id,`${c.id}${c.excluded?" · excluded":""}`)));
  if(selection())$("card").value=selection().id;
  $("thumbnails").replaceChildren();
  cards.forEach((card,i)=>{
    const button=document.createElement("button"), thumb=document.createElement("canvas"), label=document.createElement("span");thumb.width=75;thumb.height=105;crop(card,thumb);label.textContent=card.id+(card.excluded?" ×":"");button.append(thumb,label);button.className=(i===active?"selected ":"")+(card.excluded?"excluded":"");button.setAttribute("aria-label",`Select ${card.id}${card.excluded?", excluded":""}`);button.onclick=()=>selectCard(i);$("thumbnails").append(button);
  });renderSelected();draw();
}
function selectCard(index) {if(busy)return;active=index;renderCards();position();}
function change(fn) {if(busy||!frame)return;snapshot();fn();edited();renderCards();position();}
canvas.addEventListener("pointerdown",event=>{
  if(!source||busy)return;
  const p=eventPoint(event), q=world(p);
  if(drawing){drawing.push(q);if(drawing.length===4){if(G.labelQuadError(drawing)){status("Click four corners clockwise: printed top-left, top-right, bottom-right, bottom-left.");drawing=[];}else{const points=drawing;drawing=null;change(()=>{const number=1+Math.max(0,...cards.map(c=>Number(c.id.slice(1))));cards.push({id:`C${number}`,corners:points,excluded:false,orientationKnown:true,occluded:false,expectedCard:""});active=cards.length-1;});$("drawing-hint").textContent="";$("add").textContent="＋ Draw missed card";}}else $("drawing-hint").textContent=`Click corner ${drawing.length+1} of 4`;draw();return;}
  if($("show-current").checked){const card=selection();if(card&&!card.excluded){const handle=card.corners.findIndex(v=>Math.hypot(...screen(v).map((n,i)=>n-p[i]))<16);if(handle>=0){snapshot();drag={handle};canvas.setPointerCapture(event.pointerId);return;}}
    const hit=cards.findIndex(c=>!c.excluded&&G.pointInQuad(q,c.corners));if(hit>=0){selectCard(hit);return;}}
  drag={pan:p,x:view.x,y:view.y};canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove",event=>{
  if(!drag)return;const p=eventPoint(event);
  if(drag.pan){view.x=drag.x+p[0]-drag.pan[0];view.y=drag.y+p[1]-drag.pan[1];}
  else {selection().corners[drag.handle]=world(p).map(v=>Math.max(-.5,Math.min(1.5,v)));edited();crop(selection(),$("crop"));}
  draw();
});
function endDrag(){if(!drag)return;drag=null;renderCards();}
canvas.addEventListener("pointerup",endDrag);canvas.addEventListener("pointercancel",endDrag);
canvas.addEventListener("wheel",event=>{if(!source)return;event.preventDefault();const p=eventPoint(event),q=world(p);view.zoom=Math.max(.6,Math.min(10,view.zoom*Math.exp(-event.deltaY*.001)));const after=screen(q);view.x+=p[0]-after[0];view.y+=p[1]-after[1];draw();},{passive:false});
$("fit").onclick=()=>{view={zoom:1,x:0,y:0};draw();};new ResizeObserver(resize).observe($("stage"));
for(const id of ["show-current","show-previous","show-reference"])$(id).onchange=draw;
$("card").onchange=()=>selectCard(cards.findIndex(c=>c.id===$("card").value));
$("rotate").onclick=()=>change(()=>{const c=selection();c.corners.push(c.corners.shift());c.orientationKnown=true;});
$("exclude").onclick=()=>change(()=>{selection().excluded=!selection().excluded;});
$("upright").onchange=()=>change(()=>{selection().orientationKnown=$("upright").checked;});
$("occluded").onchange=()=>change(()=>{selection().occluded=$("occluded").checked;});
$("expected").oninput=()=>{if(selection()){selection().expectedCard=$("expected").value;edited();}};
$("notes").oninput=edited;$("verdict").onchange=()=>{dirty=true;};
$("undo").onclick=()=>{if(!history.length||busy)return;cards=history.pop();active=Math.min(active,cards.length-1);edited();renderCards();};
$("reset").onclick=()=>change(()=>{const original=frame.proposals.find(c=>c.id===selection().id);if(original)cards[active]=clone(original);else cards[active].excluded=true;});
$("add").onclick=()=>{drawing=drawing?null:[];$("show-current").checked=true;$("drawing-hint").textContent=drawing?"Click printed TL → TR → BR → BL. Click this button again to cancel.":"";$("add").textContent=drawing?"Cancel drawing":"＋ Draw missed card";draw();};
$("save").onclick=()=>exclusive(()=>save());
$("approve").onclick=()=>exclusive(async()=>{await save("approved");const last=filtered.at(-1)?.id===frame.id;if(last)status("Review saved. You have reached the end of this set.");else await move(1);});
$("previous").onclick=()=>exclusive(()=>move(-1));$("next").onclick=()=>exclusive(()=>move(1));
$("frame").onchange=()=>{const id=$("frame").value;exclusive(async()=>{if(dirty)await save();await load(id);});};
$("batch").onchange=()=>exclusive(async()=>{if(dirty)await save();rebuildList();await load(filtered[0]?.id);});
$("copy").onclick=()=>exclusive(async()=>{const text=`${frame.reference} / ${selection()?.id||"photo"} · ${frame.id}\n${location.href}`;await navigator.clipboard.writeText(text);status("Photo/card reference and link copied.");});
$("upload-open").onclick=()=>{$("upload-panel").hidden=!$("upload-panel").hidden;};
$("session").value="photos-"+new Date().toISOString().slice(0,10);
function dataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Could not read photo"));reader.onload=()=>resolve(reader.result.split(",")[1]);reader.readAsDataURL(file);});}
$("upload").onclick=()=>exclusive(async()=>{
  const files=Array.from($("files").files);if(!files.length)throw new Error("Choose one or more photos first.");
  if(dirty)await save();let latest,failures=[],duplicates=0;
  for(const [i,file] of files.entries()){
    $("upload-status").textContent=`Running model ${i+1} / ${files.length}: ${file.name}. The first photo also loads the model.`;
    try {if(file.size>18_000_000)throw new Error("Maximum size is 18 MB");const result=await api("upload",{name:file.name,session:$("session").value,data:await dataURL(file)});latest=result.id;if(result.duplicate)duplicates++;}
    catch(error){failures.push(`${file.name}: ${error.message}`);}
  }
  library=await api("frames");if(latest){$("batch").value=library.frames.find(f=>f.id===latest).kind==="upload"?"uploads":"all";rebuildList();await load(latest);}
  $("upload-status").textContent=`Finished ${files.length-failures.length} / ${files.length} photos${duplicates?` (${duplicates} already in library)`:""}. ${failures.join("; ")}`;
});
window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
exclusive(async()=>{
  library=await api("frames");$("model").textContent=library.model+" · local review";
  const params=new URLSearchParams(location.search||localStorage.getItem(positionKey)||"");
  const mode=params.get("set");if(["examples","flagged","imported","imported-flagged","human","starter","all","uploads"].includes(mode))$("batch").value=mode;
  if(library.comparison)$("comparison-intro").textContent=`All ${library.frames.filter(f=>f.kind==="benchmark").length} benchmark photos compared. ${library.comparison.visualInspection?.photos||0} visually inspected. Browse the failure examples or add new photos; your earlier labels are preserved.`;
  rebuildList();const id=filtered.some(f=>f.id===params.get("photo"))?params.get("photo"):filtered[0]?.id;
  await load(id,params.get("card"));
});

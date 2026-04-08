/**
 * Test: quantize HSV histograms to uint8, measure size savings + accuracy impact.
 * Compares float32 HSV vs uint8 HSV matching on the video benchmark.
 */
import * as tf from '@tensorflow/tfjs';
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';

const MODEL_INPUT_SIZE = 640;
const CONF_THRESH = 0.25;
const NMS_IOU = 0.45;
const EQ = 64;
const GRID = 8;
const ART = { top: 0.08, bottom: 0.55, left: 0.05, right: 0.95 };
const ART_W = 0.85, HSV_W = 0.15;

await tf.setBackend('cpu'); await tf.ready();
const model = await tf.loadGraphModel('http://localhost:3003/models/yolo-card-detector/model.json');

// Load artwork DB
const artJson = JSON.parse(readFileSync('/tmp/artwork-fingerprints.json', 'utf-8'));
function b64f32(b) { const s=atob(b); const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i); return new Float32Array(u.buffer); }

// Build two DBs: float32 HSV and uint8 HSV
const dbFloat = [];
const dbUint8 = [];

for (const e of artJson.entries) {
  const fp = b64f32(e.fingerprint);
  let fpNorm = 0; for(let i=0;i<fp.length;i++) fpNorm+=fp[i]*fp[i]; fpNorm=Math.sqrt(fpNorm);

  const hsvF32 = e.hsvHist ? b64f32(e.hsvHist) : null;
  let hsvF32Norm = 0;
  if (hsvF32) { for(let i=0;i<hsvF32.length;i++) hsvF32Norm+=hsvF32[i]*hsvF32[i]; hsvF32Norm=Math.sqrt(hsvF32Norm); }

  // Quantize: float32 [0,1] → uint8 [0,255]
  let hsvU8 = null, hsvU8Norm = 0;
  if (hsvF32) {
    // Find max value for better quantization range
    let maxVal = 0;
    for (let i=0;i<hsvF32.length;i++) if(hsvF32[i]>maxVal) maxVal=hsvF32[i];
    const scale = maxVal > 0 ? 255 / maxVal : 1;

    hsvU8 = new Float32Array(hsvF32.length); // store as float for matching but from uint8
    for (let i=0;i<hsvF32.length;i++) {
      const quantized = Math.round(hsvF32[i] * scale);
      hsvU8[i] = quantized / scale; // round-trip: float→uint8→float
    }
    for(let i=0;i<hsvU8.length;i++) hsvU8Norm+=hsvU8[i]*hsvU8[i]; hsvU8Norm=Math.sqrt(hsvU8Norm);
  }

  const base = { name: e.name, id: e.externalId, fp, fpNorm };
  dbFloat.push({ ...base, hsv: hsvF32, hsvNorm: hsvF32Norm });
  dbUint8.push({ ...base, hsv: hsvU8, hsvNorm: hsvU8Norm });
}

console.log(`Loaded: ${dbFloat.length} entries\n`);

// Measure quantized DB size
let origHsvBytes = 0, quantHsvBytes = 0;
for (const e of artJson.entries) {
  if (e.hsvHist) {
    origHsvBytes += e.hsvHist.length; // base64 chars ≈ bytes
    quantHsvBytes += Math.ceil(b64f32(e.hsvHist).length); // uint8 = 1 byte per value (vs 4)
  }
}
console.log(`HSV storage: float32=${(origHsvBytes/1024/1024).toFixed(1)}MB b64 → uint8=${(quantHsvBytes/1024/1024).toFixed(1)}MB raw`);

// Also create a stripped JSON to measure actual file size
const strippedNoHsv = { ...artJson, entries: artJson.entries.map(e => ({ externalId: e.externalId, name: e.name, setCode: e.setCode, fingerprint: e.fingerprint })) };
const strippedUint8 = { ...artJson, entries: artJson.entries.map(e => {
  const hsv = e.hsvHist ? b64f32(e.hsvHist) : null;
  let maxVal = 0;
  if (hsv) for(let i=0;i<hsv.length;i++) if(hsv[i]>maxVal) maxVal=hsv[i];
  const scale = maxVal > 0 ? 255/maxVal : 1;
  const u8 = hsv ? new Uint8Array(hsv.length) : null;
  if (hsv && u8) for(let i=0;i<hsv.length;i++) u8[i]=Math.min(255,Math.round(hsv[i]*scale));
  // Encode uint8 as base64
  const u8b64 = u8 ? btoa(String.fromCharCode(...u8)) : null;
  return { externalId: e.externalId, name: e.name, setCode: e.setCode, fingerprint: e.fingerprint, hsvHist: u8b64, hsvScale: maxVal > 0 ? maxVal : null };
})};

const sizeNoHsv = JSON.stringify(strippedNoHsv).length;
const sizeUint8 = JSON.stringify(strippedUint8).length;
const sizeFloat32 = JSON.stringify(artJson).length;
console.log(`File sizes: no HSV=${(sizeNoHsv/1024/1024).toFixed(1)}MB | uint8 HSV=${(sizeUint8/1024/1024).toFixed(1)}MB | float32 HSV=${(sizeFloat32/1024/1024).toFixed(1)}MB\n`);

// ---- Matching functions ----
function matchWithHSV(qfp, qfpNorm, qhsv, qhsvNorm, db, topN=10) {
  if (qfpNorm < 1e-8) return [];
  const r = [];
  for (const e of db) {
    if (e.fpNorm < 1e-8) continue;
    let artDot=0; for(let i=0;i<qfp.length;i++) artDot+=qfp[i]*e.fp[i];
    const artSim = artDot / (qfpNorm * e.fpNorm);
    let sim = artSim;
    if (qhsv && qhsvNorm > 1e-8 && e.hsv && e.hsvNorm > 1e-8) {
      let hsvDot=0; for(let i=0;i<qhsv.length;i++) hsvDot+=qhsv[i]*e.hsv[i];
      const hsvSim = hsvDot / (qhsvNorm * e.hsvNorm);
      sim = ART_W * artSim + HSV_W * hsvSim;
    }
    r.push({ name: e.name, id: e.id, sim });
  }
  r.sort((a,b) => b.sim - a.sim);
  return r.slice(0, topN);
}

// ---- Artwork FP + HSV from crop ----
async function computeArtFp(buf,w,h) {
  const cL=Math.round(w*ART.left),cT=Math.round(h*ART.top),cW=Math.round(w*(ART.right-ART.left)),cH=Math.round(h*(ART.bottom-ART.top));
  const art=new Uint8Array(cW*cH*3);
  for(let y=0;y<cH;y++)for(let x=0;x<cW;x++){const s=((cT+y)*w+(cL+x))*3,d=(y*cW+x)*3;art[d]=buf[s];art[d+1]=buf[s+1];art[d+2]=buf[s+2];}
  let eq=await sharp(Buffer.from(art),{raw:{width:cW,height:cH,channels:3}}).resize(EQ,EQ,{fit:'fill'}).raw().toBuffer();
  eq=Buffer.from(eq);const px=EQ*EQ;
  for(let ch=0;ch<3;ch++){const h=new Uint32Array(256);for(let i=0;i<px;i++)h[eq[i*3+ch]]++;const c=new Uint32Array(256);c[0]=h[0];for(let i=1;i<256;i++)c[i]=c[i-1]+h[i];let cm=0;for(let i=0;i<256;i++){if(c[i]>0){cm=c[i];break;}}const dn=px-cm;if(dn>0)for(let i=0;i<px;i++){const x=i*3+ch;eq[x]=Math.round(((c[eq[x]]-cm)*255)/dn);}}
  const g=await sharp(eq,{raw:{width:EQ,height:EQ,channels:3}}).resize(GRID,GRID,{fit:'fill',kernel:'cubic'}).raw().toBuffer();
  const fp=new Float32Array(GRID*GRID*3);const cells=GRID*GRID;
  for(let i=0;i<cells;i++){fp[i]=g[i*3]/255;fp[cells+i]=g[i*3+1]/255;fp[2*cells+i]=g[i*3+2]/255;}
  return fp;
}

function computeScanHSV(buf,w,h) {
  const cL=Math.round(w*ART.left),cT=Math.round(h*ART.top),cW=Math.round(w*(ART.right-ART.left)),cH=Math.round(h*(ART.bottom-ART.top));
  const hist=new Float32Array(30*32);const px=cW*cH;
  for(let y=0;y<cH;y++)for(let x=0;x<cW;x++){
    const idx=((cT+y)*w+(cL+x))*3;
    const r=buf[idx]/255,g=buf[idx+1]/255,b=buf[idx+2]/255;
    const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
    let hue=0;if(d>0){if(mx===r)hue=60*(((g-b)/d)%6);else if(mx===g)hue=60*((b-r)/d+2);else hue=60*((r-g)/d+4);}if(hue<0)hue+=360;
    const sat=mx>0?d/mx:0;
    hist[Math.min(29,Math.floor(hue/360*30))*32+Math.min(31,Math.floor(sat*32))]++;
  }
  let sum=0;for(let i=0;i<hist.length;i++)sum+=hist[i];if(sum>0)for(let i=0;i<hist.length;i++)hist[i]/=sum;
  return hist;
}

// ---- YOLO ----
async function detectFrame(path){const meta=await sharp(path).metadata();const srcW=meta.width,srcH=meta.height,maxDim=Math.max(srcW,srcH),scale=MODEL_INPUT_SIZE/maxDim;const nW=Math.round(srcW*scale),nH=Math.round(srcH*scale);const rgb=await sharp(path).resize(nW,nH).removeAlpha().extend({top:0,bottom:MODEL_INPUT_SIZE-nH,left:0,right:MODEL_INPUT_SIZE-nW,background:{r:114,g:114,b:114}}).raw().toBuffer();const fl=new Float32Array(MODEL_INPUT_SIZE*MODEL_INPUT_SIZE*3);for(let i=0;i<MODEL_INPUT_SIZE*MODEL_INPUT_SIZE;i++){fl[i*3]=rgb[i*3]/255;fl[i*3+1]=rgb[i*3+1]/255;fl[i*3+2]=rgb[i*3+2]/255;}const input=tf.tensor4d(fl,[1,MODEL_INPUT_SIZE,MODEL_INPUT_SIZE,3]);const output=model.predict(input);const tn=Array.isArray(output)?output[0]:output;const data=tn.dataSync();const N=tn.shape[2];const raw=[];for(let i=0;i<N;i++){const c=data[4*N+i];if(c>=CONF_THRESH)raw.push({cx:data[i]/scale,cy:data[N+i]/scale,w:data[2*N+i]/scale,h:data[3*N+i]/scale,conf:c});}raw.sort((a,b)=>b.conf-a.conf);const dets=[];for(const d of raw){if(!dets.some(k=>{const x1=Math.max(d.cx-d.w/2,k.cx-k.w/2),y1=Math.max(d.cy-d.h/2,k.cy-k.h/2),x2=Math.min(d.cx+d.w/2,k.cx+k.w/2),y2=Math.min(d.cy+d.h/2,k.cy+k.h/2);const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1),union=d.w*d.h+k.w*k.h-inter;return union>0?inter/union>NMS_IOU:false;}))dets.push(d);}input.dispose();tn.dispose();return{dets,srcW,srcH};}

// ---- Main ----
const videoPath = '/Users/ahmadjalil/Downloads/Untitled design.mp4';
const timestamps = [];
for (let t = 30; t < 1200; t += 15) timestamps.push(t);

let total=0, agree=0, disagree=0;
const floatStats = { ambig: 0, gaps: [] };
const uint8Stats = { ambig: 0, gaps: [] };

for (const ts of timestamps) {
  const fp = `/tmp/tcger_bench_${ts}.png`;
  try{execSync(`test -f ${fp}`);}catch{execSync(`ffmpeg -y -i '${videoPath}' -ss ${ts} -frames:v 1 ${fp} 2>/dev/null`);}
  const {dets,srcW,srcH}=await detectFrame(fp);
  if(!dets.length)continue;
  const det=dets[0];const cW=Math.round(det.w),cH=Math.round(det.h);
  const left=Math.max(0,Math.round(det.cx-cW/2)),top=Math.max(0,Math.round(det.cy-cH/2));
  const w=Math.min(cW,srcW-left),h=Math.min(cH,srcH-top);
  try{
    const crop=await sharp(fp).extract({left,top,width:w,height:h}).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const cw=crop.info.width,ch=crop.info.height;
    const artFp=await computeArtFp(crop.data,cw,ch);
    let artNorm=0;for(let i=0;i<artFp.length;i++)artNorm+=artFp[i]*artFp[i];artNorm=Math.sqrt(artNorm);
    const scanHSV=computeScanHSV(crop.data,cw,ch);
    let scanHSVNorm=0;for(let i=0;i<scanHSV.length;i++)scanHSVNorm+=scanHSV[i]*scanHSV[i];scanHSVNorm=Math.sqrt(scanHSVNorm);

    const mFloat=matchWithHSV(artFp,artNorm,scanHSV,scanHSVNorm,dbFloat);
    const mUint8=matchWithHSV(artFp,artNorm,scanHSV,scanHSVNorm,dbUint8);

    const fGap=mFloat.length>=2?mFloat[0].sim-mFloat[1].sim:1;
    const uGap=mUint8.length>=2?mUint8[0].sim-mUint8[1].sim:1;
    floatStats.gaps.push(fGap);if(fGap<0.01)floatStats.ambig++;
    uint8Stats.gaps.push(uGap);if(uGap<0.01)uint8Stats.ambig++;

    total++;
    if(mFloat[0]?.id===mUint8[0]?.id) agree++; else disagree++;
  }catch(e){}
}

console.log(`\n${'='.repeat(50)}`);
console.log(`RESULTS: ${total} frames\n`);
console.log(`Float32 vs Uint8 agreement: ${agree}/${total} (${(agree/total*100).toFixed(1)}%)`);
console.log(`Disagreements: ${disagree}\n`);
const fAvg=floatStats.gaps.reduce((a,b)=>a+b,0)/floatStats.gaps.length;
const uAvg=uint8Stats.gaps.reduce((a,b)=>a+b,0)/uint8Stats.gaps.length;
console.log(`Float32 HSV: ${floatStats.ambig}/${total} ambiguous (${(floatStats.ambig/total*100).toFixed(0)}%), avg gap ${fAvg.toFixed(4)}`);
console.log(`Uint8 HSV:   ${uint8Stats.ambig}/${total} ambiguous (${(uint8Stats.ambig/total*100).toFixed(0)}%), avg gap ${uAvg.toFixed(4)}`);
console.log(`\nFile sizes: no HSV=${(sizeNoHsv/1024/1024).toFixed(1)}MB | uint8=${(sizeUint8/1024/1024).toFixed(1)}MB | float32=${(sizeFloat32/1024/1024).toFixed(1)}MB`);

process.exit(0);

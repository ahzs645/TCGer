import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { AutoImageProcessor, AutoModel, RawImage, env } from '@huggingface/transformers';
import { rectifyCardCrop } from './src/scripts/card-rectify';

const SCRATCH = '/private/tmp/claude-501/-Users-ahmadjalil-github-TCGer/4254e08e-034c-4d5e-851f-809f3a35f022/scratchpad';

type Case = { label: string; target: string; frames: number[] };
const CASES: Case[] = [
  { label: 'Yamask (hard miss)', target: 'swsh6-82', frames: [764, 765] },
  { label: 'Chinchou (0.715)', target: 'swsh1-67', frames: [391, 392] },
  { label: 'Fighting Energy', target: 'swsh6-233', frames: [396, 397] },
  { label: 'Energy Retrieval', target: 'swsh1-160', frames: [398, 399] },
  { label: 'Slowking recap', target: 'swsh6-98', frames: [809, 810, 811] },
  { label: 'CONTROL Spheal', target: 'swsh6-37', frames: [756, 757, 758, 759] },
  { label: 'CONTROL Morpeko V', target: 'swsh1-79', frames: [224, 226, 228] },
];

async function main() {
  const artifact = JSON.parse(readFileSync('/Users/ahmadjalil/github/TCGer/frontend/public/scan-index/pokemon-embeddings.json', 'utf8'));
  const bytes = Buffer.from(artifact.vectors, 'base64');
  const vectors = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dim = artifact.dimension;
  const results = JSON.parse(readFileSync(SCRATCH + '/full-1s/live-stream-results.json', 'utf8'));
  env.allowRemoteModels = true;
  const processor = await AutoImageProcessor.from_pretrained(artifact.model);
  const net = await AutoModel.from_pretrained(artifact.model, { dtype: artifact.dtype });

  async function embed(rgba: Uint8ClampedArray, w: number, h: number): Promise<Float32Array> {
    const image = new RawImage(rgba, w, h, 4);
    const out = await net(await processor(image));
    const lhs = out.last_hidden_state;
    const hidden = lhs.dims[lhs.dims.length - 1];
    const q = new Float32Array(lhs.data.slice(0, hidden));
    let sq = 0; for (const v of q) sq += v * v;
    const n = Math.sqrt(sq); for (let i = 0; i < q.length; i++) q[i] /= n;
    return q;
  }

  function match(q: Float32Array, target: string) {
    let best = -2, bestIdx = -1, rank = 0, targetSim = -2;
    const sims: number[] = new Array(artifact.entries.length);
    for (let i = 0; i < artifact.entries.length; i++) {
      let dot = 0, esq = 0;
      for (let k = 0; k < dim; k++) { const x = vectors[i * dim + k]; dot += q[k] * x; esq += x * x; }
      const sim = dot / Math.sqrt(esq);
      sims[i] = sim;
      if (sim > best) { best = sim; bestIdx = i; }
      if (artifact.entries[i].externalId === target) targetSim = sim;
    }
    for (const s of sims) if (s > targetSim) rank++;
    const e = artifact.entries[bestIdx];
    return { top1: `${e.name} ${e.externalId}`, top1Sim: best, targetSim, targetRank: rank + 1 };
  }

  async function cropsFor(t: number) {
    const frame = results.frames.find((f: any) => f.timestampSeconds === t);
    const det = frame?.yoloDetections?.[0];
    if (!det) return null;
    const file = SCRATCH + '/full-1s/frames/frame-' + String(t + 1).padStart(5, '0') + '.jpg';
    const meta = await sharp(file).metadata();
    const pad = 0.1;
    const left = Math.max(0, Math.round(det.cx - det.width / 2 - det.width * pad));
    const top = Math.max(0, Math.round(det.cy - det.height / 2 - det.height * pad));
    const w = Math.min(Math.round(det.width * (1 + 2 * pad)), (meta.width ?? 0) - left);
    const h = Math.min(Math.round(det.height * (1 + 2 * pad)), (meta.height ?? 0) - top);
    const { data, info } = await sharp(file).extract({ left, top, width: w, height: h })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const padded = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
    const rect = rectifyCardCrop(padded, {
      left: det.cx - det.width / 2 - left,
      top: det.cy - det.height / 2 - top,
      right: det.cx + det.width / 2 - left,
      bottom: det.cy + det.height / 2 - top,
    });
    return { padded, rectified: rect.method === 'quad' ? rect.image : null };
  }

  function meanNormalize(qs: Float32Array[]): Float32Array {
    const m = new Float32Array(qs[0].length);
    for (const q of qs) for (let i = 0; i < m.length; i++) m[i] += q[i];
    let sq = 0; for (const v of m) sq += v * v;
    const n = Math.sqrt(sq); for (let i = 0; i < m.length; i++) m[i] /= n;
    return m;
  }

  for (const c of CASES) {
    const plainQ: Float32Array[] = [];
    const rectQ: Float32Array[] = [];
    const perFrame: string[] = [];
    for (const t of c.frames) {
      const crops = await cropsFor(t);
      if (!crops) continue;
      const qp = await embed(crops.padded.data, crops.padded.width, crops.padded.height);
      plainQ.push(qp);
      const mp = match(qp, c.target);
      perFrame.push(`t=${t} plain: tgtSim=${mp.targetSim.toFixed(3)} rank=${mp.targetRank}`);
      if (crops.rectified) {
        const qr = await embed(crops.rectified.data, crops.rectified.width, crops.rectified.height);
        rectQ.push(qr);
      }
    }
    console.log('==', c.label, `(${plainQ.length} frames)`);
    for (const line of perFrame) console.log('   ', line);
    if (plainQ.length >= 2) {
      const ap = match(meanNormalize(plainQ), c.target);
      console.log(`    AVG plain    : tgtSim=${ap.targetSim.toFixed(3)} rank=${ap.targetRank}  top1=${ap.top1} ${ap.top1Sim.toFixed(3)}`);
    }
    if (rectQ.length >= 2) {
      const ar = match(meanNormalize(rectQ), c.target);
      console.log(`    AVG rectified: tgtSim=${ar.targetSim.toFixed(3)} rank=${ar.targetRank}  top1=${ar.top1} ${ar.top1Sim.toFixed(3)}`);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });

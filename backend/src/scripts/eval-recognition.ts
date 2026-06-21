/**
 * Recognition eval harness for the client-side scanner.
 *
 * Runs the REAL recognition pipeline that the browser runs — DINOv2 embed →
 * int8 cosine top-K → margin-gated collector-number OCR tiebreaker — over a
 * folder of real card crops (or a Roboflow/COCO export, cropping each card by
 * its bounding box). Emits a review manifest (per crop: top-5, OCR reading,
 * final pick, ground-truth slot) and, when labels are present, metrics
 * (top-1 / top-5 / OCR trigger + agreement). This is what validates the OCR
 * tiebreaker and recalibrates the quality gate on the actual distribution —
 * catalog augmentation (benchmark-embeddings.ts) is only a proxy.
 *
 * Inputs (pick one):
 *   --images <dir>                folder of card-crop images (jpg/png/webp)
 *   --coco <ann.json> --images-dir <dir>   Roboflow/COCO export → crop by bbox
 *
 * Options:
 *   --index <path>     reference index (default frontend pokemon-embeddings.json)
 *   --labels <json>    { "<filename>": "<externalId>" } ground truth (optional)
 *   --tcg pokemon      footer-OCR regex/region set
 *   --out <path>       manifest output (default ./eval-manifest.json)
 *   --ocr-margin 0.1   run OCR only when top1−top2 < this
 *   --no-ocr           disable the OCR stage
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

import sharp from "sharp";

type EncoderKind = "clip" | "dinov2";

interface LoadedIndex {
  model: string;
  dtype: string;
  encoder: EncoderKind;
  dimension: number;
  entries: Array<{ externalId: string; name: string; setCode: string | null }>;
  vectors: Int8Array;
  invNorms: Float32Array;
}

function parseArgs(argv: string[]) {
  const get = (f: string) => {
    const i = argv.indexOf(f);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const has = (f: string) => argv.includes(f);
  return {
    images: get("--images"),
    coco: get("--coco"),
    imagesDir: get("--images-dir"),
    index:
      get("--index") ??
      resolve(__dirname, "../../../frontend/public/scan-index/pokemon-embeddings.json"),
    labels: get("--labels"),
    tcg: get("--tcg") ?? "pokemon",
    out: get("--out") ?? resolve(process.cwd(), "eval-manifest.json"),
    ocrMargin: Number.parseFloat(get("--ocr-margin") ?? "0.1"),
    noOcr: has("--no-ocr"),
  };
}

function loadIndex(path: string): LoadedIndex {
  const a = JSON.parse(readFileSync(resolve(path), "utf8"));
  const bin = Buffer.from(a.vectors, "base64");
  const vectors = new Int8Array(bin.buffer, bin.byteOffset, bin.length);
  const D = a.dimension as number;
  const N = a.entries.length as number;
  const invNorms = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let sq = 0;
    const base = i * D;
    for (let k = 0; k < D; k++) {
      const x = vectors[base + k]!;
      sq += x * x;
    }
    invNorms[i] = sq > 0 ? 1 / Math.sqrt(sq) : 0;
  }
  return {
    model: a.model,
    dtype: a.dtype,
    encoder: (a.encoder ?? (/dinov2/i.test(a.model) ? "dinov2" : "clip")) as EncoderKind,
    dimension: D,
    entries: a.entries,
    vectors,
    invNorms,
  };
}

function topK(query: Float32Array, index: LoadedIndex, k: number) {
  const { dimension: D, vectors, invNorms, entries } = index;
  const best: Array<{ i: number; sim: number }> = [];
  let worst = -Infinity;
  for (let i = 0; i < entries.length; i++) {
    const inv = invNorms[i]!;
    if (inv === 0) continue;
    const base = i * D;
    let dot = 0;
    for (let kk = 0; kk < D; kk++) dot += query[kk]! * vectors[base + kk]!;
    const sim = dot * inv;
    if (best.length < k) {
      best.push({ i, sim });
      if (best.length === k) worst = Math.min(...best.map((b) => b.sim));
    } else if (sim > worst) {
      let wi = 0;
      for (let j = 1; j < best.length; j++) if (best[j]!.sim < best[wi]!.sim) wi = j;
      best[wi] = { i, sim };
      worst = Math.min(...best.map((b) => b.sim));
    }
  }
  best.sort((x, y) => y.sim - x.sim);
  return best.map((b) => ({
    externalId: entries[b.i]!.externalId,
    name: entries[b.i]!.name,
    sim: b.sim,
  }));
}

async function createEncoder(transformers: any, index: LoadedIndex) {
  if (index.encoder === "dinov2") {
    const proc = await transformers.AutoImageProcessor.from_pretrained(index.model);
    const net = await transformers.AutoModel.from_pretrained(index.model, {
      dtype: index.dtype,
    });
    return async (image: unknown) => {
      const inputs = await proc(image);
      const out = await net(inputs);
      const lhs = out.last_hidden_state;
      const hidden = lhs.dims[lhs.dims.length - 1] as number;
      return l2(new Float32Array((lhs.data as Float32Array).slice(0, hidden)));
    };
  }
  const proc = await transformers.AutoProcessor.from_pretrained(index.model);
  const net = await transformers.CLIPVisionModelWithProjection.from_pretrained(
    index.model,
    { dtype: index.dtype },
  );
  return async (image: unknown) => {
    const inputs = await proc(image);
    const { image_embeds } = await net(inputs);
    return l2(new Float32Array(image_embeds.data as Float32Array));
  };
}

function l2(v: Float32Array): Float32Array {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  s = Math.sqrt(s);
  if (s > 1e-8) for (let i = 0; i < v.length; i++) v[i]! /= s;
  return v;
}

// ---------- identity + OCR ----------

const norm = (s: string) => s.trim().toLowerCase().replace(/^0+(\d)/, "$1");
function collectorNumber(externalId: string): string | null {
  const i = externalId.indexOf("-");
  return i > 0 ? norm(externalId.slice(i + 1)) : null;
}

const FOOTER_REGIONS: Record<string, Array<[number, number, number, number]>> = {
  // [left, top, width, height] as fractions
  pokemon: [
    [0.0, 0.89, 0.5, 0.09],
    [0.5, 0.89, 0.5, 0.09],
  ],
  magic: [[0.0, 0.9, 0.45, 0.09]],
  yugioh: [[0.0, 0.9, 1.0, 0.09]],
};

async function ocrFooter(
  worker: any,
  buf: Buffer,
  tcg: string,
): Promise<{ pairs: string[]; numbers: string[]; raw: string }> {
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 100;
  const H = meta.height ?? 140;
  const pairs: string[] = [];
  const numbers: string[] = [];
  const raws: string[] = [];
  for (const [l, t, w, h] of FOOTER_REGIONS[tcg] ?? FOOTER_REGIONS.pokemon!) {
    const left = Math.max(0, Math.round(W * l));
    const top = Math.max(0, Math.round(H * t));
    const ww = Math.min(W - left, Math.round(W * w));
    const hh = Math.min(H - top, Math.round(H * h));
    if (ww < 4 || hh < 4) continue;
    const crop = await sharp(buf)
      .extract({ left, top, width: ww, height: hh })
      .resize(ww * 4)
      .grayscale()
      .normalize()
      .toBuffer();
    const { data } = await worker.recognize(crop);
    const txt = (data.text as string).replace(/\s+/g, " ").trim();
    if (txt) raws.push(txt);
    for (const m of txt.matchAll(/(\d{1,4})\s*\/\s*(\d{1,4})/g)) pairs.push(norm(m[1]!));
    for (const m of txt.matchAll(/\d{1,5}/g)) numbers.push(norm(m[0]));
  }
  return { pairs, numbers, raw: raws.join(" | ") };
}

// ---------- input collection ----------

interface EvalItem {
  name: string;
  buffer: Buffer;
}

const IMG_RE = /\.(jpe?g|png|webp)$/i;

function fromImagesDir(dir: string): EvalItem[] {
  return readdirSync(dir)
    .filter((f) => IMG_RE.test(f))
    .map((f) => ({ name: f, buffer: readFileSync(join(dir, f)) }));
}

async function fromCoco(annPath: string, imagesDir: string): Promise<EvalItem[]> {
  const coco = JSON.parse(readFileSync(resolve(annPath), "utf8"));
  const imgById = new Map<number, string>();
  for (const im of coco.images ?? []) imgById.set(im.id, im.file_name);
  const items: EvalItem[] = [];
  let n = 0;
  for (const ann of coco.annotations ?? []) {
    const file = imgById.get(ann.image_id);
    if (!file) continue;
    const path = join(imagesDir, file);
    if (!existsSync(path)) continue;
    const [x, y, w, h] = ann.bbox as [number, number, number, number];
    try {
      const buf = await sharp(readFileSync(path))
        .extract({
          left: Math.max(0, Math.round(x)),
          top: Math.max(0, Math.round(y)),
          width: Math.round(w),
          height: Math.round(h),
        })
        .toBuffer();
      items.push({ name: `${file}#${n++}`, buffer: buf });
    } catch {
      // skip bad bbox
    }
  }
  return items;
}

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("[eval] options:", opts);
  const index = loadIndex(opts.index);
  console.log(`[index] ${index.encoder} ${index.model} — ${index.entries.length} × ${index.dimension}d`);

  const labels: Record<string, string> = opts.labels
    ? JSON.parse(readFileSync(resolve(opts.labels), "utf8"))
    : {};

  let items: EvalItem[] = [];
  if (opts.coco && opts.imagesDir) items = await fromCoco(opts.coco, opts.imagesDir);
  else if (opts.images) items = fromImagesDir(opts.images);
  else throw new Error("Provide --images <dir> or --coco <ann> --images-dir <dir>");
  console.log(`[eval] ${items.length} crops to evaluate`);

  const transformers = (await import("@huggingface/transformers")) as any;
  const { RawImage } = transformers;
  const encode = await createEncoder(transformers, index);

  let worker: any = null;
  if (!opts.noOcr) {
    const tess = (await import("tesseract.js")) as any;
    worker = await tess.createWorker("eng");
    await worker.setParameters({ tessedit_char_whitelist: "0123456789/" });
  }

  const results: any[] = [];
  let done = 0;
  for (const item of items) {
    try {
      const image = await RawImage.fromBlob(new Blob([new Uint8Array(item.buffer)]));
      const q = await encode(image);
      const top = topK(q, index, 5);
      let finalId = top[0]?.externalId ?? null;
      let ocr: any = null;

      const margin = top.length >= 2 ? top[0]!.sim - top[1]!.sim : 1;
      if (worker && top.length >= 2 && margin < opts.ocrMargin) {
        const reading = await ocrFooter(worker, item.buffer, opts.tcg);
        // Pairs-only override (bare numbers cause false matches on real frames).
        const ocrNums = new Set(reading.pairs);
        const matched = ocrNums.size
          ? top.find((c) => {
              const cn = collectorNumber(c.externalId);
              return cn && ocrNums.has(cn);
            })
          : undefined;
        if (matched) finalId = matched.externalId;
        ocr = {
          triggered: true,
          raw: reading.raw,
          pairs: reading.pairs,
          numbers: reading.numbers,
          matchedExternalId: matched?.externalId ?? null,
        };
      }

      const gt = labels[item.name] ?? labels[basename(item.name)] ?? null;
      results.push({
        image: item.name,
        finalExternalId: finalId,
        finalName: top.find((t) => t.externalId === finalId)?.name ?? null,
        margin: Number(margin.toFixed(4)),
        top5: top.map((t) => ({ externalId: t.externalId, name: t.name, sim: Number(t.sim.toFixed(3)) })),
        ocr,
        groundTruth: gt,
        top1Correct: gt ? finalId === gt : null,
        top5Correct: gt ? top.some((t) => t.externalId === gt) : null,
      });
    } catch (err) {
      results.push({ image: item.name, error: (err as Error).message });
    }
    if (++done % 25 === 0 || done === items.length) {
      process.stdout.write(`\r[eval] ${done}/${items.length}`);
    }
  }
  process.stdout.write("\n");
  if (worker) await worker.terminate();

  const labeled = results.filter((r) => r.groundTruth);
  const ocrFired = results.filter((r) => r.ocr?.triggered);
  const metrics = {
    n: results.length,
    labeled: labeled.length,
    top1: labeled.length ? labeled.filter((r) => r.top1Correct).length / labeled.length : null,
    top5: labeled.length ? labeled.filter((r) => r.top5Correct).length / labeled.length : null,
    ocrTriggerRate: results.length ? ocrFired.length / results.length : 0,
    ocrMatchedRate: ocrFired.length ? ocrFired.filter((r) => r.ocr.matchedExternalId).length / ocrFired.length : 0,
  };

  writeFileSync(resolve(opts.out), JSON.stringify({ index: { model: index.model, encoder: index.encoder, total: index.entries.length }, metrics, results }, null, 2));
  console.log("[eval] metrics:", JSON.stringify(metrics, null, 2));
  console.log(`[eval] manifest → ${resolve(opts.out)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

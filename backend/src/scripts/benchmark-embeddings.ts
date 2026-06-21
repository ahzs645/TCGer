/**
 * Benchmark embedding backbones for the client-side scanner by retrieval
 * robustness under realistic image degradations.
 *
 * There are no labeled real photos yet (see docs/client-side-scanner-options.md),
 * so this is an augmentation-robustness proxy: take clean catalog images,
 * degrade them the way a handheld camera + imperfect crop would (blur, JPEG
 * recompression, rotation, lighting, crop-jitter, and a combined "handheld"
 * case), embed the degraded image, and query the *clean* reference index. A
 * better backbone keeps the correct card at top-1 under degradation and leaves
 * a larger margin to the nearest different card.
 *
 * Usage:
 *   tsx src/scripts/benchmark-embeddings.ts \
 *     --indexes ../frontend/public/scan-index/pokemon-embeddings.json,../frontend/public/scan-index/pokemon-dinov2-embeddings.json \
 *     --api-url http://127.0.0.1:4040 \
 *     --samples 120 [--topk 5]
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import sharp from "sharp";

type EncoderKind = "clip" | "dinov2";

interface IndexEntry {
  externalId: string;
  name: string;
  setCode: string | null;
}

interface LoadedIndex {
  path: string;
  model: string;
  dtype: string;
  encoder: EncoderKind;
  dimension: number;
  scale: number;
  total: number;
  entries: IndexEntry[];
  vectors: Int8Array;
  invNorms: Float32Array;
  idByExternal: Map<string, number>;
}

function parseArgs(argv: string[]) {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const indexes = (get("--indexes") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const apiUrl = (get("--api-url") ?? "http://127.0.0.1:4040").replace(/\/+$/, "");
  const samples = Number.parseInt(get("--samples") ?? "120", 10);
  const topk = Number.parseInt(get("--topk") ?? "5", 10);
  return { indexes, apiUrl, samples, topk };
}

function loadIndex(path: string): LoadedIndex {
  const a = JSON.parse(readFileSync(resolve(path), "utf8"));
  const binary = Buffer.from(a.vectors, "base64");
  const vectors = new Int8Array(
    binary.buffer,
    binary.byteOffset,
    binary.length,
  );
  const D = a.dimension as number;
  const N = a.entries.length as number;
  const invNorms = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const base = i * D;
    let sq = 0;
    for (let k = 0; k < D; k++) {
      const x = vectors[base + k]!;
      sq += x * x;
    }
    invNorms[i] = sq > 0 ? 1 / Math.sqrt(sq) : 0;
  }
  const idByExternal = new Map<string, number>();
  a.entries.forEach((e: IndexEntry, i: number) => idByExternal.set(e.externalId, i));
  return {
    path,
    model: a.model,
    dtype: a.dtype,
    encoder: (a.encoder ?? (/dinov2/i.test(a.model) ? "dinov2" : "clip")) as EncoderKind,
    dimension: D,
    scale: a.scale,
    total: N,
    entries: a.entries,
    vectors,
    invNorms,
    idByExternal,
  };
}

/** Brute-force int8 cosine top-K (query must be L2-normalised). */
function topK(
  query: Float32Array,
  index: LoadedIndex,
  k: number,
): Array<{ externalId: string; sim: number }> {
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
  return best.map((b) => ({ externalId: entries[b.i]!.externalId, sim: b.sim }));
}

async function createEncoder(
  transformers: any,
  model: string,
  dtype: string,
  encoder: EncoderKind,
): Promise<(image: unknown) => Promise<Float32Array>> {
  if (encoder === "dinov2") {
    const processor = await transformers.AutoImageProcessor.from_pretrained(model);
    const net = await transformers.AutoModel.from_pretrained(model, { dtype });
    return async (image: unknown) => {
      const inputs = await processor(image);
      const out = await net(inputs);
      const lhs = out.last_hidden_state;
      const hidden = lhs.dims[lhs.dims.length - 1] as number;
      return l2(new Float32Array((lhs.data as Float32Array).slice(0, hidden)));
    };
  }
  const processor = await transformers.AutoProcessor.from_pretrained(model);
  const net = await transformers.CLIPVisionModelWithProjection.from_pretrained(
    model,
    { dtype },
  );
  return async (image: unknown) => {
    const inputs = await processor(image);
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

// ---------- augmentations (sharp → raw RGBA → RawImage) ----------

type Augment = (buf: Buffer) => Promise<Buffer>;

const AUGMENTS: Record<string, Augment> = {
  clean: async (b) => b,
  blur: async (b) => sharp(b).blur(3).toBuffer(),
  jpeg: async (b) => sharp(b).jpeg({ quality: 30 }).toBuffer(),
  rotate: async (b) => sharp(b).rotate(6, { background: "#000" }).toBuffer(),
  dark: async (b) => sharp(b).modulate({ brightness: 0.6 }).toBuffer(),
  bright: async (b) => sharp(b).modulate({ brightness: 1.4 }).toBuffer(),
  cropzoom: async (b) => {
    const meta = await sharp(b).metadata();
    const w = meta.width ?? 100;
    const h = meta.height ?? 140;
    const dx = Math.round(w * 0.08);
    const dy = Math.round(h * 0.08);
    return sharp(b)
      .extract({ left: dx, top: dy, width: w - 2 * dx, height: h - 2 * dy })
      .resize(w, h)
      .toBuffer();
  },
  handheld: async (b) =>
    sharp(b)
      .blur(2)
      .modulate({ brightness: 0.85 })
      .rotate(3, { background: "#000" })
      .jpeg({ quality: 45 })
      .toBuffer(),
};

async function toRawImage(transformers: any, buf: Buffer): Promise<unknown> {
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new transformers.RawImage(
    new Uint8ClampedArray(data),
    info.width,
    info.height,
    4,
  );
}

async function fetchImage(apiUrl: string, externalId: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${apiUrl}/images/${externalId}/high.webp`);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.indexes.length < 1) {
    throw new Error("Provide --indexes a.json,b.json");
  }
  console.log("[benchmark] options:", opts);

  const transformers = (await import("@huggingface/transformers")) as any;
  const indexes = opts.indexes.map(loadIndex);
  for (const idx of indexes) {
    console.log(
      `[index] ${idx.encoder} ${idx.model} — ${idx.total} × ${idx.dimension}d`,
    );
  }

  // Deterministic, catalog-spread sample (shared across all indexes).
  const base = indexes[0]!;
  const stride = Math.max(1, Math.floor(base.total / opts.samples));
  const sampleIds: string[] = [];
  for (let i = 0; i < base.total && sampleIds.length < opts.samples; i += stride) {
    sampleIds.push(base.entries[i]!.externalId);
  }

  // Pre-fetch images once (shared across indexes).
  console.log(`[benchmark] fetching ${sampleIds.length} sample images...`);
  const images = new Map<string, Buffer>();
  for (const id of sampleIds) {
    const buf = await fetchImage(opts.apiUrl, id);
    if (buf) images.set(id, buf);
  }
  console.log(`[benchmark] ${images.size} images ready`);

  const augNames = Object.keys(AUGMENTS);

  for (const index of indexes) {
    const encode = await createEncoder(
      transformers,
      index.model,
      index.dtype,
      index.encoder,
    );
    // metrics[aug] = { n, top1, top5, marginSum, nearestOtherSum }
    const metrics: Record<
      string,
      { n: number; top1: number; top5: number; marginSum: number }
    > = {};
    for (const a of augNames) metrics[a] = { n: 0, top1: 0, top5: 0, marginSum: 0 };

    let processed = 0;
    for (const id of sampleIds) {
      const buf = images.get(id);
      if (!buf) continue;
      for (const aug of augNames) {
        let augBuf: Buffer;
        try {
          augBuf = await AUGMENTS[aug]!(buf);
        } catch {
          continue;
        }
        const image = await toRawImage(transformers, augBuf);
        const q = await encode(image);
        const res = topK(q, index, opts.topk);
        const m = metrics[aug]!;
        m.n += 1;
        if (res[0]?.externalId === id) m.top1 += 1;
        if (res.some((r) => r.externalId === id)) m.top5 += 1;
        if (res.length >= 2) m.marginSum += res[0]!.sim - res[1]!.sim;
      }
      processed += 1;
      if (processed % 20 === 0) {
        process.stdout.write(
          `\r[${index.encoder}] ${processed}/${sampleIds.length} cards`,
        );
      }
    }
    process.stdout.write("\n");

    console.log(`\n=== ${index.encoder.toUpperCase()} (${index.model}) ===`);
    console.log("aug        n    top1%   top5%   mean-margin");
    let totTop1 = 0;
    let totTop5 = 0;
    let totN = 0;
    for (const aug of augNames) {
      const m = metrics[aug]!;
      totTop1 += m.top1;
      totTop5 += m.top5;
      totN += m.n;
      console.log(
        `${aug.padEnd(10)} ${String(m.n).padStart(3)}  ${((100 * m.top1) / m.n).toFixed(1).padStart(6)}  ${((100 * m.top5) / m.n).toFixed(1).padStart(6)}   ${(m.marginSum / m.n).toFixed(4)}`,
      );
    }
    console.log(
      `${"OVERALL".padEnd(10)} ${String(totN).padStart(3)}  ${((100 * totTop1) / totN).toFixed(1).padStart(6)}  ${((100 * totTop5) / totN).toFixed(1).padStart(6)}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

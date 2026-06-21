/**
 * Build a client-side embedding index for the card scanner.
 *
 * Runs the SAME encoder that the browser/iOS clients run (CLIP ViT-B/32 via
 * Transformers.js by default) over the card catalog images and emits a single
 * static, versioned index artifact:
 *
 *   {
 *     version, kind: "embedding-index",
 *     model, dtype, dimension, tcg,
 *     quantization: "int8", scale: 127,
 *     total,
 *     entries: [{ externalId, name, setCode, setName, rarity, imageUrl }],
 *     vectors: <base64 Int8Array, total*dimension row-major>
 *   }
 *
 * Preprocessing parity is guaranteed because the index is built with the exact
 * Transformers.js model + processor that ONNX Runtime Web loads in the browser.
 * Vectors are L2-normalised then int8-quantised (value*scale, clamped) so the
 * client can brute-force cosine over the packed bytes; pair with a float32
 * top-N rescore when accuracy demands it (see docs/client-side-scanner-options.md).
 *
 * Usage:
 *   tsx src/scripts/build-embedding-index.ts \
 *     --tcg pokemon \
 *     --api-url http://127.0.0.1:4040 \
 *     --model Xenova/clip-vit-base-patch32 \
 *     --dtype q8 \
 *     --out ../frontend/public/scan-index/pokemon-embeddings.json \
 *     [--limit 500] [--page-size 250] [--concurrency 4]
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type CardRecord = {
  externalId: string;
  name: string;
  setCode: string | null;
  setName: string | null;
  rarity: string | null;
  imageUrl: string | null;
};

type EncoderKind = "clip" | "dinov2";

interface CliOptions {
  tcg: string;
  apiUrl: string;
  model: string;
  dtype: string;
  /** Encoder family — determines model class + how the vector is read. */
  encoder: EncoderKind;
  out: string;
  limit: number | null;
  pageSize: number;
  concurrency: number;
  /** If set, rewrite each entry's imageUrl origin to this base (stable host). */
  imageBaseUrl: string | null;
}

function inferEncoder(model: string): EncoderKind {
  return /dinov2/i.test(model) ? "dinov2" : "clip";
}

/**
 * Build a model-agnostic image encoder. Both branches emit a raw (un-normalised)
 * embedding; the caller L2-normalises + quantises. The SAME logic must run in
 * the browser (frontend/src/lib/scan/embedding-matcher.ts) for index parity.
 */
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
      // DINOv2 has no projection head: use the CLS token (position 0) of
      // last_hidden_state [1, 1+numPatches, hidden].
      const lhs = out.last_hidden_state;
      const hidden = lhs.dims[lhs.dims.length - 1] as number;
      return new Float32Array((lhs.data as Float32Array).slice(0, hidden));
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
    return new Float32Array(image_embeds.data as Float32Array);
  };
}

function parseArgs(argv: string[]): CliOptions {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  const tcg = get("--tcg") ?? "pokemon";
  const apiUrl = (
    get("--api-url") ??
    process.env.POKEMON_API_BASE_URL ??
    "http://127.0.0.1:4040"
  ).replace(/\/+$/, "");
  const model = get("--model") ?? "Xenova/clip-vit-base-patch32";
  const dtype = get("--dtype") ?? "q8";
  const out =
    get("--out") ??
    resolve(__dirname, `../../../frontend/public/scan-index/${tcg}-embeddings.json`);
  const limitRaw = get("--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;
  const pageSize = Number.parseInt(get("--page-size") ?? "250", 10);
  const concurrency = Number.parseInt(get("--concurrency") ?? "4", 10);
  const imageBaseUrl = (get("--image-base-url") ?? "").replace(/\/+$/, "") || null;
  const encoder = (get("--encoder") as EncoderKind) ?? inferEncoder(model);
  return {
    tcg,
    apiUrl,
    model,
    dtype,
    encoder,
    out,
    limit,
    pageSize,
    concurrency,
    imageBaseUrl,
  };
}

/**
 * Rewrite an image URL's origin to a stable public host for the shipped index,
 * preserving the path (e.g. /images/base1-4/high.webp). The encoder always
 * fetches from --api-url; only the stored display URL is rewritten.
 */
function rewriteImageOrigin(
  imageUrl: string | null,
  imageBaseUrl: string | null,
): string | null {
  if (!imageUrl || !imageBaseUrl) return imageUrl;
  try {
    const u = new URL(imageUrl);
    return `${imageBaseUrl}${u.pathname}`;
  } catch {
    return imageUrl;
  }
}

/** Normalise a tcgdex card image base into a fetchable high-res URL. */
function resolveImageUrl(image: unknown): string | null {
  if (typeof image !== "string" || !image) return null;
  // tcgdex serves a base URL; quality + extension are appended.
  if (/\.(png|jpe?g|webp)$/i.test(image)) return image;
  return `${image.replace(/\/+$/, "")}/high.webp`;
}

function deriveSetCode(externalId: string, fallback: string | null): string | null {
  if (fallback) return fallback;
  const idx = externalId.indexOf("-");
  return idx > 0 ? externalId.slice(0, idx) : null;
}

/** Page through the catalog API and collect card records with image URLs. */
async function fetchCatalog(opts: CliOptions): Promise<CardRecord[]> {
  const records: CardRecord[] = [];
  let page = 1;
  let total = Infinity;
  while (records.length < total) {
    const url = `${opts.apiUrl}/cards?page=${page}&pageSize=${opts.pageSize}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Catalog fetch failed (${res.status}) for ${url}`);
    }
    const json = (await res.json()) as {
      data?: unknown[];
      totalCount?: number;
    };
    const data = Array.isArray(json.data) ? json.data : [];
    if (typeof json.totalCount === "number") total = json.totalCount;
    if (data.length === 0) break;

    for (const raw of data) {
      const card = raw as Record<string, unknown>;
      const externalId = String(card.id ?? "").trim();
      if (!externalId) continue;
      const setObj = (card.set ?? null) as Record<string, unknown> | null;
      const imageUrl = resolveImageUrl(card.image);
      if (!imageUrl) continue;
      records.push({
        externalId,
        name: String(card.name ?? externalId),
        setCode: deriveSetCode(
          externalId,
          setObj && typeof setObj.id === "string" ? setObj.id : null,
        ),
        setName:
          setObj && typeof setObj.name === "string" ? setObj.name : null,
        rarity: typeof card.rarity === "string" ? card.rarity : null,
        imageUrl,
      });
      if (opts.limit && records.length >= opts.limit) return records;
    }
    process.stdout.write(
      `\r[catalog] page ${page} — ${records.length}/${Number.isFinite(total) ? total : "?"} cards`,
    );
    page += 1;
  }
  process.stdout.write("\n");
  return records;
}

function l2NormalizeInPlace(v: Float32Array): void {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
  s = Math.sqrt(s);
  if (s > 1e-8) for (let i = 0; i < v.length; i++) v[i]! /= s;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  console.log("[build-embedding-index] options:", opts);

  // Dynamic import keeps the ESM-only package out of the CJS require graph.
  const transformers = (await import("@huggingface/transformers")) as any;
  const { RawImage } = transformers;

  console.log(
    `[model] loading ${opts.model} (${opts.encoder}, dtype ${opts.dtype})...`,
  );
  const t0 = Date.now();
  const encode = await createEncoder(
    transformers,
    opts.model,
    opts.dtype,
    opts.encoder,
  );
  console.log(`[model] ready in ${Date.now() - t0}ms`);

  const catalog = await fetchCatalog(opts);
  console.log(`[catalog] ${catalog.length} cards with images`);

  const SCALE = 127;
  const entries: CardRecord[] = [];
  const vectorChunks: Int8Array[] = [];
  let dimension = 0;
  let done = 0;
  let failed = 0;
  const startedAt = Date.now();

  async function embedOne(rec: CardRecord): Promise<Int8Array | null> {
    try {
      const image = await RawImage.fromURL(rec.imageUrl!);
      const vec = await encode(image); // raw embedding (copied out of tensor)
      l2NormalizeInPlace(vec);
      const q = new Int8Array(vec.length);
      for (let i = 0; i < vec.length; i++) {
        q[i] = Math.max(-127, Math.min(127, Math.round(vec[i]! * SCALE)));
      }
      return q;
    } catch (err) {
      failed += 1;
      if (failed <= 10) {
        console.warn(
          `\n[warn] embed failed for ${rec.externalId}: ${(err as Error).message}`,
        );
      }
      return null;
    }
  }

  // Bounded-concurrency worker pool (inference is the bottleneck, not IO).
  let cursor = 0;
  async function worker() {
    while (cursor < catalog.length) {
      const idx = cursor++;
      const rec = catalog[idx]!;
      const q = await embedOne(rec);
      done += 1;
      if (q) {
        if (!dimension) dimension = q.length;
        if (q.length === dimension) {
          // Encoder fetched from rec.imageUrl (--api-url); store a display URL
          // rewritten to the stable public host when requested.
          entries.push({
            ...rec,
            imageUrl: rewriteImageOrigin(rec.imageUrl, opts.imageBaseUrl),
          });
          vectorChunks.push(q);
        }
      }
      if (done % 100 === 0 || done === catalog.length) {
        const rate = done / ((Date.now() - startedAt) / 1000);
        const eta = ((catalog.length - done) / rate).toFixed(0);
        process.stdout.write(
          `\r[embed] ${done}/${catalog.length} (ok ${entries.length}, fail ${failed}) — ${rate.toFixed(1)}/s, eta ${eta}s   `,
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.max(1, opts.concurrency) }, () => worker()),
  );
  process.stdout.write("\n");

  if (!dimension || entries.length === 0) {
    throw new Error("No embeddings produced — aborting");
  }

  // Pack vectors row-major into one Int8Array → base64.
  const packed = new Int8Array(entries.length * dimension);
  for (let i = 0; i < vectorChunks.length; i++) {
    packed.set(vectorChunks[i]!, i * dimension);
  }
  const vectorsBase64 = Buffer.from(packed.buffer).toString("base64");

  const artifact = {
    version: 1,
    kind: "embedding-index",
    model: opts.model,
    dtype: opts.dtype,
    encoder: opts.encoder,
    dimension,
    tcg: opts.tcg,
    quantization: "int8",
    scale: SCALE,
    normalized: true,
    total: entries.length,
    entries,
    vectors: vectorsBase64,
  };

  const outPath = resolve(opts.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(artifact));
  const sizeMb = (Buffer.byteLength(JSON.stringify(artifact)) / 1e6).toFixed(1);
  console.log(
    `[done] ${entries.length} vectors × ${dimension}d → ${outPath} (${sizeMb} MB, ${failed} failed)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

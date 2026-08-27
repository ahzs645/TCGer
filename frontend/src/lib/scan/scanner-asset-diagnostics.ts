import { scanIndexAssetUrl } from "./scan-index-assets";

export type ScannerAssetStatus = "pass" | "warning" | "fail";

export interface ScannerAssetCheck {
  id: string;
  label: string;
  status: ScannerAssetStatus;
  detail: string;
  url: string;
}

interface EmbeddingArtifactShape {
  kind?: unknown;
  model?: unknown;
  encoder?: unknown;
  dimension?: unknown;
  tcg?: unknown;
  total?: unknown;
  entries?: unknown;
  vectors?: unknown;
  modelUrl?: unknown;
  gateUrl?: unknown;
}

export function validateEmbeddingArtifact(
  artifact: EmbeddingArtifactShape,
  expected: { tcg: string; dimension: number; total: number },
): string[] {
  const errors: string[] = [];
  if (artifact.kind !== "embedding-index")
    errors.push("kind is not embedding-index");
  if (artifact.tcg !== expected.tcg) errors.push(`tcg is not ${expected.tcg}`);
  if (artifact.dimension !== expected.dimension) {
    errors.push(`dimension is not ${expected.dimension}`);
  }
  if (artifact.total !== expected.total)
    errors.push(`total is not ${expected.total}`);
  if (
    !Array.isArray(artifact.entries) ||
    artifact.entries.length !== expected.total
  ) {
    errors.push(`entries length is not ${expected.total}`);
  }
  if (typeof artifact.vectors !== "string") {
    errors.push("vectors payload is missing");
  } else {
    const validBase64 =
      artifact.vectors.length % 4 === 0 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        artifact.vectors,
      );
    if (!validBase64) {
      errors.push("vectors payload is not valid base64");
    } else {
      const padding = artifact.vectors.endsWith("==")
        ? 2
        : artifact.vectors.endsWith("=")
          ? 1
          : 0;
      const decodedBytes = artifact.vectors.length * 0.75 - padding;
      const expectedBytes = expected.total * expected.dimension;
      if (decodedBytes !== expectedBytes) {
        errors.push(
          `vector bytes are ${decodedBytes}, expected ${expectedBytes}`,
        );
      }
    }
  }
  if (typeof artifact.model !== "string" || !artifact.model)
    errors.push("model is missing");
  if (typeof artifact.encoder !== "string" || !artifact.encoder)
    errors.push("encoder is missing");
  return errors;
}

async function fetchBytes(fetcher: typeof fetch, url: string) {
  const response = await fetcher(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function contentAddressCheck(
  bytes: Uint8Array,
  url: string,
): Promise<string | null> {
  const expected = url.match(/\/([a-f0-9]{64})\.[^/]+$/i)?.[1]?.toLowerCase();
  if (!expected) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    Uint8Array.from(bytes).buffer,
  );
  const actual = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return actual === expected
    ? null
    : `SHA-256 is ${actual}, expected ${expected}`;
}

export async function runScannerAssetDiagnostics(
  fetcher: typeof fetch = fetch,
): Promise<ScannerAssetCheck[]> {
  const checks: ScannerAssetCheck[] = [];
  const add = (
    id: string,
    label: string,
    status: ScannerAssetStatus,
    detail: string,
    url: string,
  ) => checks.push({ id, label, status, detail, url });

  const manifestUrl = scanIndexAssetUrl("manifest.json");
  let manifest: Record<string, unknown>;
  try {
    const bytes = await fetchBytes(fetcher, manifestUrl);
    manifest = objectRecord(parseJson(bytes)) ?? {};
    const indexes = objectRecord(manifest.indexes);
    if (!indexes || Object.keys(indexes).length === 0) {
      throw new Error("manifest has no indexes");
    }
    add(
      "manifest",
      "Embedding manifest",
      "pass",
      `${bytes.byteLength.toLocaleString()} bytes; ${Object.keys(indexes).length} active index`,
      manifestUrl,
    );
  } catch (error) {
    add(
      "manifest",
      "Embedding manifest",
      "fail",
      error instanceof Error ? error.message : String(error),
      manifestUrl,
    );
    return checks;
  }

  const indexes = objectRecord(manifest.indexes) ?? {};
  const artifacts: EmbeddingArtifactShape[] = [];
  for (const [tcg, rawEntry] of Object.entries(indexes)) {
    const entry = objectRecord(rawEntry);
    const file = entry?.file;
    const dimension = entry?.dimension;
    const total = entry?.total;
    const expectedBytes = entry?.bytes;
    let url = manifestUrl;
    if (
      !entry ||
      typeof file !== "string" ||
      typeof dimension !== "number" ||
      typeof total !== "number"
    ) {
      add(
        `index-${tcg}`,
        `${tcg} embedding index`,
        "fail",
        "invalid manifest entry",
        url,
      );
      continue;
    }
    try {
      url = scanIndexAssetUrl(file);
    } catch (error) {
      add(
        `index-${tcg}`,
        `${tcg} embedding index`,
        "fail",
        error instanceof Error ? error.message : String(error),
        file,
      );
      continue;
    }
    try {
      const bytes = await fetchBytes(fetcher, url);
      const artifact = objectRecord(
        parseJson(bytes),
      ) as EmbeddingArtifactShape | null;
      const errors = artifact
        ? validateEmbeddingArtifact(artifact, { tcg, dimension, total })
        : ["artifact is not an object"];
      if (
        typeof expectedBytes === "number" &&
        bytes.byteLength !== expectedBytes
      ) {
        errors.push(
          `file is ${bytes.byteLength} bytes, expected ${expectedBytes}`,
        );
      }
      const hashError = await contentAddressCheck(bytes, url);
      if (hashError) errors.push(hashError);
      const hasDeclaredHash = /\/[a-f0-9]{64}\.[^/]+$/i.test(url);
      if (artifact && errors.length === 0) artifacts.push(artifact);
      add(
        `index-${tcg}`,
        `${tcg} embedding index`,
        errors.length ? "fail" : hasDeclaredHash ? "pass" : "warning",
        errors.length
          ? errors.join("; ")
          : `${total.toLocaleString()} vectors × ${dimension}; byte count and structure valid${hasDeclaredHash ? "; SHA-256 valid" : "; publisher did not declare a content hash"}`,
        url,
      );
    } catch (error) {
      add(
        `index-${tcg}`,
        `${tcg} embedding index`,
        "fail",
        error instanceof Error ? error.message : String(error),
        url,
      );
    }
  }

  const fetchedModels = new Set<string>();
  for (const artifact of artifacts) {
    if (
      typeof artifact.modelUrl !== "string" ||
      fetchedModels.has(artifact.modelUrl)
    )
      continue;
    fetchedModels.add(artifact.modelUrl);
    let url = artifact.modelUrl;
    try {
      url = scanIndexAssetUrl(artifact.modelUrl);
      const bytes = await fetchBytes(fetcher, url);
      const hashError = await contentAddressCheck(bytes, url);
      const hasDeclaredHash = /\/[a-f0-9]{64}\.[^/]+$/i.test(url);
      add(
        `encoder-${fetchedModels.size}`,
        `${String(artifact.encoder)} encoder model`,
        hashError || bytes.byteLength === 0
          ? "fail"
          : hasDeclaredHash
            ? "pass"
            : "warning",
        hashError ??
          `${bytes.byteLength.toLocaleString()} bytes${hasDeclaredHash ? "; SHA-256 valid" : "; publisher did not declare a content hash"}`,
        url,
      );
    } catch (error) {
      add(
        `encoder-${fetchedModels.size}`,
        `${String(artifact.encoder)} encoder model`,
        "fail",
        error instanceof Error ? error.message : String(error),
        url,
      );
    }
  }

  const gateSource =
    typeof artifacts[0]?.gateUrl === "string"
      ? artifacts[0].gateUrl
      : "card-face-gate.json";
  let gateUrl = gateSource;
  try {
    gateUrl = scanIndexAssetUrl(gateSource);
    const bytes = await fetchBytes(fetcher, gateUrl);
    const hashError = await contentAddressCheck(bytes, gateUrl);
    const hasDeclaredHash = /\/[a-f0-9]{64}\.[^/]+$/i.test(gateUrl);
    const gate = objectRecord(parseJson(bytes));
    const weights = gate?.weights;
    const valid =
      Array.isArray(weights) &&
      typeof gate?.dimension === "number" &&
      weights.length === gate.dimension &&
      typeof gate?.model === "string";
    const compatible =
      valid &&
      artifacts.some(
        (artifact) =>
          artifact.model === gate?.model &&
          artifact.dimension === gate?.dimension,
      );
    add(
      "rejection-gate",
      "Card-face rejection gate",
      !valid || hashError
        ? "fail"
        : compatible && hasDeclaredHash
          ? "pass"
          : "warning",
      !valid
        ? "gate weights or dimensions are invalid"
        : hashError
          ? hashError
          : compatible
            ? `${weights.length} weights; model and dimensions match an active index${hasDeclaredHash ? "; SHA-256 valid" : "; publisher did not declare a content hash"}`
            : "asset is valid but does not match the active encoder; runtime rejection gate is disabled",
      gateUrl,
    );
  } catch (error) {
    add(
      "rejection-gate",
      "Card-face rejection gate",
      "warning",
      error instanceof Error ? error.message : String(error),
      gateUrl,
    );
  }

  const yoloUrl = "/models/yolo-card-detector/model.json";
  try {
    const bytes = await fetchBytes(fetcher, yoloUrl);
    const model = objectRecord(parseJson(bytes));
    const manifests = Array.isArray(model?.weightsManifest)
      ? model.weightsManifest
      : [];
    const shardPaths = manifests.flatMap((group) => {
      const record = objectRecord(group);
      return Array.isArray(record?.paths)
        ? record.paths.filter(
            (path): path is string => typeof path === "string",
          )
        : [];
    });
    if (model?.format !== "graph-model" || shardPaths.length === 0) {
      throw new Error("invalid TensorFlow.js graph-model manifest");
    }
    let shardBytes = 0;
    for (const path of shardPaths) {
      const shard = await fetchBytes(
        fetcher,
        `/models/yolo-card-detector/${path}`,
      );
      if (shard.byteLength === 0) throw new Error(`${path} is empty`);
      shardBytes += shard.byteLength;
    }
    add(
      "detector",
      "YOLO detector and shards",
      "warning",
      `${shardPaths.length} shards; ${shardBytes.toLocaleString()} non-empty weight bytes; publisher did not declare content hashes`,
      yoloUrl,
    );
  } catch (error) {
    add(
      "detector",
      "YOLO detector and shards",
      "fail",
      error instanceof Error ? error.message : String(error),
      yoloUrl,
    );
  }

  for (const reference of [
    {
      id: "reference-results",
      label: "Bundled scanner results",
      url: "/scan-review/sinnoh-full-1s.json",
      field: "frames",
    },
    {
      id: "reference-labels",
      label: "Bundled reference labels",
      url: "/scan-review/sinnoh-ground-truth.v2.json",
      field: "windows",
    },
  ]) {
    try {
      const bytes = await fetchBytes(fetcher, reference.url);
      const value = objectRecord(parseJson(bytes));
      const rows = value?.[reference.field];
      if (!Array.isArray(rows) || rows.length === 0)
        throw new Error(`${reference.field} is empty`);
      add(
        reference.id,
        reference.label,
        "pass",
        `${rows.length.toLocaleString()} ${reference.field}; valid JSON`,
        reference.url,
      );
    } catch (error) {
      add(
        reference.id,
        reference.label,
        "fail",
        error instanceof Error ? error.message : String(error),
        reference.url,
      );
    }
  }

  return checks;
}

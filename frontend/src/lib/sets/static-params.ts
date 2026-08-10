import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  DEMO_CARDS,
  splitDemoPrintingCode,
} from "@/lib/data/demo-cards";

interface StaticSetParam {
  tcg: string;
  setCode: string;
}

/**
 * Params for the /sets/[tcg]/[setCode] routes in the static demo export
 * (`output: export` requires generateStaticParams on dynamic routes).
 * Always includes the demo fixture sets; additionally includes every set from
 * the catalog packs in public/catalog when those build artifacts are present.
 * Returns [] outside DEMO_EXPORT so normal builds keep the routes dynamic.
 */
export async function getStaticSetParams(): Promise<StaticSetParam[]> {
  if (process.env.DEMO_EXPORT !== "true") return [];

  const params = new Map<string, StaticSetParam>();
  for (const card of DEMO_CARDS) {
    const setCode = splitDemoPrintingCode(card.setCode).setCode;
    if (!setCode) continue;
    params.set(`${card.tcg}:${setCode}`, { tcg: card.tcg, setCode });
  }

  try {
    const catalogDir = path.join(process.cwd(), "public", "catalog");
    const manifest = JSON.parse(
      await readFile(path.join(catalogDir, "manifest.json"), "utf8"),
    ) as { games?: Record<string, { file?: string }> };
    for (const [tcg, entry] of Object.entries(manifest.games ?? {})) {
      if (!entry?.file) continue;
      const pack = JSON.parse(
        await readFile(path.join(catalogDir, entry.file), "utf8"),
      ) as { sets?: Array<{ code?: string }> };
      for (const set of pack.sets ?? []) {
        if (!set.code) continue;
        params.set(`${tcg}:${set.code}`, { tcg, setCode: set.code });
      }
    }
  } catch {
    // Catalog packs are optional build artifacts; without them the demo
    // export only links fixture sets, so exporting only those is consistent.
  }

  return Array.from(params.values());
}

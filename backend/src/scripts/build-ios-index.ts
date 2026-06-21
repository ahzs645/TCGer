/**
 * Generate the iOS embedding index from a web index artifact:
 *   - CardsIndexMetadata.json  [{annIndex,cardId,name,game,setCode,setName,rarity,imageURL,price}]
 *   - CardsIndexVectors.bin    header[Int32 count, Int32 dim] + int8 rows (scale 127)
 * Drop both into the iOS app bundle. The packed int8 binary (~8MB) replaces the
 * impractical ~80MB [[Float]] JSON; AnnoyIndexStore dequantizes on load.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

const get = (f: string) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i+1] : undefined; };
const indexPath = get("--index") ?? resolve(__dirname, "../../../frontend/public/scan-index/pokemon-embeddings.json");
const outDir = get("--out") ?? resolve(__dirname, "../../../mobile-apps/ios/TCGer/TCGer/Resources/ScanIndex");
const game = get("--game") ?? "pokemon";

const a = JSON.parse(readFileSync(resolve(indexPath), "utf8"));
const D = a.dimension as number;
const entries = a.entries as Array<any>;
const bin = Buffer.from(a.vectors, "base64");
const vectors = new Int8Array(bin.buffer, bin.byteOffset, bin.length);

mkdirSync(outDir, { recursive: true });

// metadata
const meta = entries.map((e, i) => ({
  annIndex: i, cardId: e.externalId, name: e.name, game,
  setCode: e.setCode ?? null, setName: e.setName ?? null,
  rarity: e.rarity ?? null, imageURL: e.imageUrl ?? null, price: null,
}));
writeFileSync(resolve(outDir, "CardsIndexMetadata.json"), JSON.stringify(meta));

// vectors binary: [int32 count][int32 dim][int8...]
const count = entries.length;
const header = Buffer.alloc(8);
header.writeInt32LE(count, 0);
header.writeInt32LE(D, 4);
const body = Buffer.from(vectors.buffer, vectors.byteOffset, count * D);
writeFileSync(resolve(outDir, "CardsIndexVectors.bin"), Buffer.concat([header, body]));

console.log(`[ios-index] ${count} × ${D}d → ${outDir}`);
console.log(`  CardsIndexMetadata.json (${(Buffer.byteLength(JSON.stringify(meta))/1e6).toFixed(1)} MB)`);
console.log(`  CardsIndexVectors.bin (${((8+count*D)/1e6).toFixed(1)} MB, int8 scale 127)`);

import * as THREE from "three";
import type { Rect, SheetLayout } from "@tcg/pack-core";

/**
 * The booster pack itself, built from numbers instead of loaded from a file.
 *
 * `pack-core` ships the pack as `assets/pack/models/pack.obj` — 192 vertex
 * records, 282 triangles, hand-modelled and hand-unwrapped. It works, but it is
 * opaque: the proportions cannot be changed without opening a modeller, the UV
 * layout has to be *read back off* the mesh at runtime by `readSheetLayout`
 * because nothing records what it was meant to be, and the asset has to be
 * copied into every consumer by `sync-assets`.
 *
 * A booster is a pillow pouch, and a pillow pouch is a swept cross-section: two
 * flat faces, rounded side gussets, a fin seal down the back, and both ends
 * flattened into a crimp. That is a handful of parameters, so this builds it
 * from them — and computes the UV layout on the way out rather than leaving it
 * to be inferred.
 *
 * The defaults reproduce the shipped mesh: same bounding box, same ring
 * profile, same sheet regions, so a sheet authored for one is worn correctly by
 * the other.
 */

export interface PackMeshOptions {
  /** x extent at the crimp, where the pack is widest. */
  width: number;
  /** y extent, crimp edge to crimp edge. */
  height: number;
  /** z extent of the body, ignoring the fin seal. */
  depth: number;
  /** x extent of the body's widest ring — narrower than the crimp. */
  bodyWidth: number;
  /** x extent of the flat part of each face, inside the gussets. */
  panelWidth: number;
  /** Height of the flattened band at each end. */
  crimpHeight: number;
  /** z extent of that band. */
  crimpDepth: number;
  /** Height of the transition between the body and the crimp. */
  foldHeight: number;
  /** How far the fin seal stands proud of the reverse face. */
  lapDepth: number;
  /** x of the fin seal, which is also where the sheet's reverse blocks split. */
  lapAt: number;
  /** How wide the raised seal strip is. */
  lapWidth: number;
  /** Segments across the full width of a face. */
  panelSegments: number;
  /** Segments per quarter of a side gusset. */
  shoulderSegments: number;
  /**
   * Fullness of the gusset, as a superellipse exponent.
   *
   * 2 is a plain ellipse and is visibly too pinched: a folded film corner keeps
   * its depth further out than a circular arc does. 2.8 is what the shipped
   * mesh's corner measures, and it also keeps the first band out of each face
   * flat enough to still read as a face — which is what decides how wide the
   * sheet's display region comes back.
   */
  shoulderFullness: number;
  /** Where the wrap's regions fall on the sheet, in u. */
  sheet: PackSheetBudget;
}

/**
 * The wrap's u budget, walked from the fin seal in the direction u increases.
 *
 * These are the numbers that decide what `readSheetLayout` will report, so they
 * are stated rather than discovered. The defaults are the shipped mesh's, which
 * is what makes the two interchangeable.
 */
export interface PackSheetBudget {
  /** u at the fin seal. */
  lap: number;
  /** u where the reverse face's near half meets the gusset. */
  backNear: number;
  /** u where that gusset meets the display face. */
  frontStart: number;
  /** u where the display face meets the far gusset. */
  frontEnd: number;
  /** u where that gusset meets the reverse face's far half. */
  backFar: number;
  /** u arriving back at the fin seal from the other side. */
  lapEnd: number;
  /** v at the top of the mesh. v is linear in y. */
  vTop: number;
  /** v at the bottom. */
  vBottom: number;
  /** How much v beyond `vTop`/`vBottom` the crimp caps take. */
  capV: number;
}

export const DEFAULT_SHEET_BUDGET: PackSheetBudget = {
  lap: 0.2373,
  backNear: 0.3038,
  frontStart: 0.3329,
  frontEnd: 0.6659,
  backFar: 0.695,
  lapEnd: 0.9624,
  vTop: 0.9585,
  vBottom: 0.0442,
  capV: 0.003,
};

/** Measured off `pack.obj`, so the defaults rebuild the shipped pack. */
export const DEFAULT_PACK_MESH: PackMeshOptions = {
  width: 4.5544,
  height: 8.1447,
  depth: 0.5496,
  bodyWidth: 4.4618,
  panelWidth: 4.1888,
  crimpHeight: 0.5851,
  crimpDepth: 0.0747,
  foldHeight: 0.4703,
  lapDepth: 0.025,
  lapAt: 1.2613,
  lapWidth: 0.0226,
  panelSegments: 4,
  shoulderSegments: 2,
  shoulderFullness: 2.8,
  sheet: DEFAULT_SHEET_BUDGET,
};

/**
 * How the pack tapers from its body into its crimped ends, as fractions of the
 * half-height, the body half-width and the body half-depth.
 *
 * A crimped end is *wider* than the body it came from — flattening a tube
 * spreads it — which is why `w` grows as `d` collapses. Both rows below are the
 * shipped mesh's own rings; `crimpHeight` and `foldHeight` place them.
 */
interface Ring {
  /** Distance from the mid-plane, in world units. */
  y: number;
  /** Multiplier on the body half-width. */
  w: number;
  /** Multiplier on the body half-depth. */
  d: number;
}

function ringProfile(o: PackMeshOptions): Ring[] {
  const halfH = o.height / 2;
  const crimpRoot = halfH - o.crimpHeight;
  const bodyTop = crimpRoot - o.foldHeight;
  // The fold is two steps, not one: most of the collapse happens in the first,
  // which is what gives the pack its shoulder rather than a cone.
  const foldMid = crimpRoot - o.foldHeight * 0.6;

  const crimpW = o.width / o.bodyWidth;
  const crimpD = o.crimpDepth / o.depth;

  const half: Ring[] = [
    { y: 0, w: 1, d: 1 },
    { y: bodyTop, w: 1, d: 0.9991 },
    { y: foldMid, w: 1 + (crimpW - 1) * 0.4, d: 0.8161 },
    { y: crimpRoot, w: crimpW, d: crimpD * 0.969 },
    { y: halfH, w: crimpW, d: crimpD },
  ];

  return [
    ...half
      .slice(1)
      .reverse()
      .map((r) => ({ ...r, y: -r.y })),
    ...half,
  ].sort((a, b) => a.y - b.y);
}

/** One point of the cross-section: where it is, and where it lands on the sheet. */
interface LoopPoint {
  x: number;
  z: number;
  u: number;
}

/**
 * The cross-section, walked from the fin seal in the direction u increases:
 * reverse face → gusset → display face → gusset → reverse face → back to the
 * seal.
 *
 * The seal is emitted twice, once at each end of the u range. It is one edge in
 * space and two in texture space — which is exactly why the sheet's reverse
 * face arrives as two blocks at opposite ends rather than one.
 */
function crossSection(
  o: PackMeshOptions,
  wScale: number,
  dScale: number,
): LoopPoint[] {
  const s = o.sheet;
  const panelHalf = (o.panelWidth / 2) * wScale;
  const halfW = (o.bodyWidth / 2) * wScale;
  const halfD = (o.depth / 2) * dScale;
  const lapAt = Math.min(o.lapAt * wScale, panelHalf);
  const lapZ = halfD + o.lapDepth * dScale;

  const pts: LoopPoint[] = [];

  /** Straight run along a face, u proportional to the distance covered. */
  const run = (
    x0: number,
    x1: number,
    z: number,
    u0: number,
    u1: number,
    segments: number,
    skipFirst: boolean,
  ) => {
    for (let i = skipFirst ? 1 : 0; i <= segments; i++) {
      const t = i / segments;
      pts.push({ x: x0 + (x1 - x0) * t, z, u: u0 + (u1 - u0) * t });
    }
  };

  /**
   * A gusset: a half-ellipse from one face round to the other, bulging to the
   * pack's widest point at its midpoint.
   *
   * `dir` is +1 for the gusset at +x, which the walk crosses going from the
   * reverse face to the display face, and -1 for the one at -x, crossed the
   * other way — so one expression serves both and the walk stays in u order.
   */
  const gusset = (dir: 1 | -1, u0: number, u1: number) => {
    const n = o.shoulderSegments * 2;
    const a = halfW - panelHalf;
    const k = o.shoulderFullness;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // Sampled uniformly across the corner's x, not by angle: that keeps the
      // first band out of each face shallow, so the face reads as a face all the
      // way to where the fold really begins.
      const across = 1 - Math.abs(2 * t - 1);
      const s = 1 - across;
      const depth = Math.sign(0.5 - t) * Math.pow(1 - Math.pow(1 - s, k), 1 / k);
      pts.push({
        x: dir * (panelHalf + a * (1 - s)),
        z: halfD * depth * dir,
        u: u0 + (u1 - u0) * t,
      });
    }
  };

  // Reverse face, near half: fin seal out to the gusset.
  const backNearSegs = Math.max(
    1,
    Math.round((o.panelSegments * (panelHalf - lapAt)) / o.panelWidth),
  );
  pts.push({ x: lapAt, z: lapZ, u: s.lap });
  run(lapAt, panelHalf, halfD, s.lap, s.backNear, backNearSegs, true);

  // Near gusset: +z round to -z.
  gusset(1, s.backNear, s.frontStart);

  // Display face.
  run(
    panelHalf,
    -panelHalf,
    -halfD,
    s.frontStart,
    s.frontEnd,
    o.panelSegments,
    true,
  );

  // Far gusset: -z round to +z.
  gusset(-1, s.frontEnd, s.backFar);

  // Reverse face, far half: gusset up to the foot of the fin seal.
  const lapWidth = o.lapWidth * wScale;
  const sealFoot = lapAt - lapWidth;
  const backFarSpan = panelHalf + sealFoot;
  const backFarSegs = Math.max(
    1,
    Math.round((o.panelSegments * backFarSpan) / o.panelWidth),
  );
  // The seal is a narrow raised strip, not a ramp: give it only its own share of
  // the reverse face's u so the film either side of it stays flat.
  const uSeal =
    s.lapEnd - ((s.lapEnd - s.backFar) * lapWidth) / (backFarSpan + lapWidth);
  run(-panelHalf, sealFoot, halfD, s.backFar, uSeal, backFarSegs, true);
  // The seal itself, standing proud — closing the walk in space, but not in u.
  pts.push({ x: lapAt, z: lapZ, u: s.lapEnd });

  return pts;
}

/** v is linear in y across the whole mesh, which is what keeps the art unskewed. */
function vForY(o: PackMeshOptions, y: number): number {
  const s = o.sheet;
  const t = (y + o.height / 2) / o.height;
  return s.vBottom + (s.vTop - s.vBottom) * t;
}

export interface BuiltPack {
  geometry: THREE.BufferGeometry;
  /**
   * The sheet layout, stated rather than inferred.
   *
   * `readSheetLayout` exists because a loaded mesh cannot say what its unwrap
   * was meant to be, so it recovers the regions by classifying triangles: any
   * face within ~25° of an axis counts, and everything else is discarded. That
   * works, but the answer depends on a threshold — the display region it reports
   * grows or shrinks by however much of the gusset happens to pass, and
   * `stretch` moves with it.
   *
   * A built mesh does not have to guess. This is the budget the vertices were
   * written from, in the same units.
   */
  layout: SheetLayout;
  /** Rings × loop points, for anything that wants to reason about the sweep. */
  grid: { rings: number; loop: number };
}

/** The declared layout, in sheet pixels. */
function declaredLayout(
  o: PackMeshOptions,
  sheetW: number,
  sheetH: number,
): SheetLayout {
  const s = o.sheet;
  const y = (1 - s.vTop) * sheetH;
  const h = (s.vTop - s.vBottom) * sheetH;
  const span = (u0: number, u1: number): Rect => ({
    x: u0 * sheetW,
    y,
    w: (u1 - u0) * sheetW,
    h,
  });
  const front = span(s.frontStart, s.frontEnd);
  return {
    width: sheetW,
    height: sheetH,
    front,
    // Wrap order, not sheet order: the far half comes first going round the pack.
    back: [span(s.backFar, s.lapEnd), span(s.lap, s.backNear)],
    seams: [span(s.backNear, s.frontStart), span(s.frontEnd, s.backFar)],
    crimps: [
      { x: s.lap * sheetW, y: y - s.capV * sheetH, w: (s.lapEnd - s.lap) * sheetW, h: s.capV * sheetH },
      { x: s.lap * sheetW, y: y + h, w: (s.lapEnd - s.lap) * sheetW, h: s.capV * sheetH },
    ],
    displayFaceZ: -1,
    // The display face carries `panelWidth` of film across `front.w` of sheet and
    // the pack's full height across `front.h`; the ratio of those two aspects is
    // how much wider than tall a texture pixel lands.
    stretch: front.w / front.h / (o.panelWidth / o.height),
  };
}

/**
 * Build the pack.
 *
 * The result is non-indexed with explicit uv and normal attributes — the same
 * shape `parseObj` returns — so it drops straight into everything that consumes
 * the loaded mesh, `readSheetLayout` included.
 */
export function buildPackGeometry(
  options: Partial<PackMeshOptions> = {},
  sheetWidth = 1024,
  sheetHeight = 512,
): BuiltPack {
  const o: PackMeshOptions = {
    ...DEFAULT_PACK_MESH,
    ...options,
    sheet: { ...DEFAULT_SHEET_BUDGET, ...(options.sheet ?? {}) },
  };

  const rings = ringProfile(o);
  const loops = rings.map((r) => crossSection(o, r.w, r.d));
  const loopLen = loops[0].length;

  const pos: number[] = [];
  const uv: number[] = [];
  const nor: number[] = [];

  /**
   * Smooth normals by central difference across the sweep grid, rather than
   * per-face: the gussets are the whole reason the pack reads as round, and
   * flat-shading them turns it back into a slab.
   */
  const at = (ri: number, li: number) => loops[ri][Math.min(li, loopLen - 1)];
  const normalAt = (ri: number, li: number): THREE.Vector3 => {
    const prevL = at(ri, (li - 1 + loopLen) % loopLen);
    const nextL = at(ri, (li + 1) % loopLen);
    const dS = new THREE.Vector3(nextL.x - prevL.x, 0, nextL.z - prevL.z);
    const r0 = rings[Math.max(0, ri - 1)];
    const r1 = rings[Math.min(rings.length - 1, ri + 1)];
    const p0 = at(Math.max(0, ri - 1), li);
    const p1 = at(Math.min(rings.length - 1, ri + 1), li);
    const dT = new THREE.Vector3(p1.x - p0.x, r1.y - r0.y, p1.z - p0.z);
    // dS × dT, not the other way round: the loop is walked in the direction u
    // increases, which runs -x across the display face, so the other order puts
    // every body normal inside the pack and the wrapper lights from within.
    const n = new THREE.Vector3().crossVectors(dS, dT);
    if (n.lengthSq() < 1e-12) n.set(0, 0, at(ri, li).z >= 0 ? 1 : -1);
    return n.normalize();
  };

  const push = (ri: number, li: number) => {
    const p = at(ri, li);
    const n = normalAt(ri, li);
    pos.push(p.x, rings[ri].y, p.z);
    uv.push(p.u, vForY(o, rings[ri].y));
    nor.push(n.x, n.y, n.z);
  };

  // Body: one quad per grid cell, split into two triangles.
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let li = 0; li < loopLen - 1; li++) {
      push(ri, li);
      push(ri, li + 1);
      push(ri + 1, li + 1);
      push(ri, li);
      push(ri + 1, li + 1);
      push(ri + 1, li);
    }
  }

  /**
   * Crimp caps: the two films zipped together, not a fan to the centre.
   *
   * A fan looks the same — the crimp is only 0.075 thick — but it makes
   * triangles that span half the pack's width, and the tear cares. `splitMesh`
   * refines the whole mesh until the cut holds straight across its *widest*
   * triangle, so one wide cap triangle costs an extra global subdivision level:
   * measured, a fan cap put a gentle drag at level 2 (4,896 triangles) where
   * the shipped mesh needs level 1 (1,128). Zipping keeps every cap triangle
   * inside one panel segment.
   *
   * The two rims also take opposite edges of the sheet's crimp strip, which is
   * what gives those regions any height at all — and is what the film does,
   * folding over onto itself.
   */
  const cap = (ri: number, sign: 1 | -1) => {
    const loop = loops[ri];
    const y = rings[ri].y;
    const vNear = vForY(o, y);
    const vFar = vNear + sign * o.sheet.capV;

    // Split the ring at its extremes in x: one side of that is the display
    // face's half of the seal, the other is the reverse face's.
    let iMin = 0;
    let iMax = 0;
    for (let i = 0; i < loopLen; i++) {
      if (loop[i].x < loop[iMin].x) iMin = i;
      if (loop[i].x > loop[iMax].x) iMax = i;
    }
    const between = (from: number, to: number) => {
      const out: LoopPoint[] = [];
      for (let i = from; ; i = (i + 1) % loopLen) {
        out.push(loop[i]);
        if (i === to) break;
      }
      return out;
    };
    const halfA = between(iMax, iMin);
    const halfB = between(iMin, iMax);

    /** Where a half-ring sits at a given x, walked as a polyline. */
    const sample = (half: LoopPoint[], x: number): LoopPoint => {
      for (let i = 0; i < half.length - 1; i++) {
        const a = half[i];
        const b = half[i + 1];
        const lo = Math.min(a.x, b.x);
        const hi = Math.max(a.x, b.x);
        if (x < lo - 1e-6 || x > hi + 1e-6) continue;
        const t = Math.abs(b.x - a.x) < 1e-9 ? 0 : (x - a.x) / (b.x - a.x);
        return { x, z: a.z + (b.z - a.z) * t, u: a.u + (b.u - a.u) * t };
      }
      const nearest = half.reduce((p, q) =>
        Math.abs(q.x - x) < Math.abs(p.x - x) ? q : p,
      );
      return { ...nearest, x };
    };

    // Every x either half turns over, so no quad straddles a vertex of either.
    const xs = [...new Set(loop.map((p) => +p.x.toFixed(6)))].sort((a, b) => a - b);

    for (let i = 0; i < xs.length - 1; i++) {
      const a0 = sample(halfA, xs[i]);
      const a1 = sample(halfA, xs[i + 1]);
      const b0 = sample(halfB, xs[i]);
      const b1 = sample(halfB, xs[i + 1]);
      const quad: Array<[LoopPoint, number]> = [
        [a0, vNear], [a1, vNear], [b1, vFar],
        [a0, vNear], [b1, vFar], [b0, vFar],
      ];
      const order = sign > 0 ? quad : [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]];
      for (const [p, v] of order) {
        pos.push(p.x, y, p.z);
        uv.push(p.u, v);
        nor.push(0, sign, 0);
      }
    }
  };
  cap(rings.length - 1, 1);
  cap(0, -1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geometry.computeBoundingBox();

  return {
    geometry,
    layout: declaredLayout(o, sheetWidth, sheetHeight),
    grid: { rings: rings.length, loop: loopLen },
  };
}

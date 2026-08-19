import type { SheetLayout } from "@tcg/pack-core";

import { gamePresentation } from "@/lib/games";

/**
 * A booster wrapper, drawn from nothing but a set name and a colour.
 *
 * The pack mesh samples one 1024×512 sheet laid out `[back | FRONT | back]`, and
 * pack-core already paints a "variant" sheet into it: a vertical gradient, an
 * abstract motif, a glowing circle and three lines of type. It reads as a
 * placeholder because it is one — nothing about it says *booster*.
 *
 * This paints the same sheet with the furniture a real wrapper has, all of it
 * generated: a foil field with diagonal ribbons and a diffraction hatch, a
 * slanted brand band, a set lockup with a metallic fill and a double stroke, a
 * faceted crest, a card-count starburst, and a bottom strip carrying a barcode
 * and microtype. The back face continues the same foil in wrap order and takes
 * the small-print block, the way the back of a real wrapper does.
 *
 * Every rect comes from {@link SheetLayout}, which pack-core reads off the mesh —
 * nothing here hardcodes a band, so a re-authored UV layout keeps working.
 */

export interface BoosterSheetSpec {
  /** Game code or display name; picks the brand colour from `lib/games`. */
  game: string;
  /** Set name in the lockup, e.g. "Evolving Skies". */
  setName: string;
  /** Line under the lockup, e.g. "Booster pack". */
  variationName: string;
  /** Number in the burst. */
  cardCount: number;
  /** Publisher line on the brand band. */
  brand?: string;
  /** Fixes the ribbon angles, barcode and speckle so a set always looks the same. */
  seed?: number;
}

/* ------------------------------------------------------------------ */
/*  Colour helpers                                                     */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba([r, g, b]: [number, number, number], a: number): string {
  return `rgba(${r},${g},${b},${a})`;
}

/** Blend towards white (`t > 0`) or black (`t < 0`). */
function shade(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = t > 0 ? 255 : 0;
  const k = Math.abs(t);
  const mix = (c: number) => Math.round(c + (target - c) * k);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/**
 * Deterministic RNG.
 *
 * The wrapper has to be stable: `Math.random()` would re-roll the ribbon angles
 * and the barcode on every repaint, and the same set would not look like itself
 * twice. mulberry32 is four lines and good enough for decoration.
 */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The wrap's UVs are not area-preserving — a texture pixel lands wider than tall
 * on the display face — so anything that should read as a circle, or as upright
 * text, is pre-stretched to cancel it. `layout.stretch` is measured off the mesh.
 */
function withAspect(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  cx: number,
  cy: number,
  draw: () => void,
): void {
  const k = Math.sqrt(layout.stretch);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(k, 1 / k);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

function clip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  draw: () => void,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  draw();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/*  The foil field                                                     */
/* ------------------------------------------------------------------ */

/**
 * Diagonal ribbons plus a cross hatch — the two things that make a flat fill
 * read as foil.
 *
 * The ribbons are drawn in sheet space rather than per panel so a ribbon that
 * leaves the front panel arrives on the back block the seam puts next to it, and
 * the sweep runs unbroken around the pack.
 */
function paintFoil(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  accent: string,
  rand: () => number,
): void {
  const { width: w, height: h } = layout;
  const accentRgb = hexToRgb(accent);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const cx = w * (t * 1.25 - 0.12);
    const band = w * (0.03 + rand() * 0.05);
    const lean = 0.42 + rand() * 0.22;
    const g = ctx.createLinearGradient(cx - band, 0, cx + band, 0);
    const peak = 0.05 + rand() * 0.07;
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, rgba([255, 255, 255], peak));
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx, h / 2);
    ctx.transform(1, 0, -lean, 1, 0, 0);
    ctx.fillRect(-band - h, -h, band * 2 + h * 2, h * 2);
    ctx.restore();
  }
  // A second, tighter set in the accent hue: real foil splits light, it does not
  // just brighten it.
  for (let i = 0; i < 6; i++) {
    const cx = w * (rand() * 1.2 - 0.1);
    const band = w * 0.012;
    const g = ctx.createLinearGradient(cx - band, 0, cx + band, 0);
    g.addColorStop(0, rgba(accentRgb, 0));
    g.addColorStop(0.5, rgba(accentRgb, 0.16));
    g.addColorStop(1, rgba(accentRgb, 0));
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(cx, h / 2);
    ctx.transform(1, 0, -0.55, 1, 0, 0);
    ctx.fillRect(-band - h, -h, band * 2 + h * 2, h * 2);
    ctx.restore();
  }
  ctx.restore();

  // Diffraction hatch: two mirrored sets of hairlines. Individually invisible,
  // together they give the surface the fine shimmer foil has.
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.lineWidth = 1;
  for (const dir of [1, -1]) {
    ctx.strokeStyle = "rgba(255,255,255,0.035)";
    ctx.beginPath();
    for (let x = -h; x < w + h; x += 7) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x + dir * h, h);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** A lit hot-spot behind the lockup, so the foil looks like it is catching light. */
function paintSheen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  accent: string,
): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, "rgba(255,255,255,0.20)");
  g.addColorStop(0.4, rgba(hexToRgb(accent), 0.1));
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Darkened panel edges, so each face reads as a face rather than as flat fill. */
function paintVignette(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  g.addColorStop(0, "rgba(0,0,0,0.34)");
  g.addColorStop(0.14, "rgba(0,0,0,0)");
  g.addColorStop(0.86, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.34)");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

/* ------------------------------------------------------------------ */
/*  Front-face furniture                                               */
/* ------------------------------------------------------------------ */

/** The slanted publisher bar across the top — the most booster-ish shape there is. */
function paintBrandBand(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  f: { x: number; y: number; w: number; h: number },
  brand: string,
  accent: string,
): void {
  const bandH = f.h * 0.085;
  const y = f.y + f.h * 0.055;
  const slant = bandH * 0.55;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(f.x, y + slant);
  ctx.lineTo(f.x + f.w, y);
  ctx.lineTo(f.x + f.w, y + bandH);
  ctx.lineTo(f.x, y + bandH + slant);
  ctx.closePath();
  const g = ctx.createLinearGradient(f.x, y, f.x + f.w, y + bandH);
  g.addColorStop(0, shade(accent, -0.55));
  g.addColorStop(0.5, shade(accent, -0.15));
  g.addColorStop(1, shade(accent, -0.6));
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = rgba(hexToRgb(accent), 0.9);
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();

  const cx = f.x + f.w / 2;
  const cy = y + bandH * 0.62 + slant * 0.5;
  withAspect(ctx, layout, cx, cy, () => {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `800 ${Math.round(bandH * 0.72)}px system-ui, sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.letterSpacing = `${Math.round(bandH * 0.12)}px`;
    ctx.fillText(brand.toUpperCase(), cx, cy);
    ctx.letterSpacing = "0px";
  });
  ctx.restore();
}

/**
 * The set name, set the way a set logo is set: a heavy face with a dark outer
 * stroke, an accent inner stroke and a metallic vertical fill.
 *
 * Drawn at a fixed size then squeezed horizontally to fit, rather than shrunk —
 * a set logo is condensed when the name is long, it does not get smaller.
 */
function paintSetLockup(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  f: { x: number; y: number; w: number; h: number },
  setName: string,
  variationName: string,
  accent: string,
): void {
  const cx = f.x + f.w / 2;
  const baseY = f.y + f.h * 0.3;
  const size = Math.round(f.w * 0.165);

  withAspect(ctx, layout, cx, baseY, () => {
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `900 ${size}px system-ui, sans-serif`;

    const text = setName.toUpperCase();
    // `withAspect` has already scaled x by sqrt(stretch), so the glyphs land that
    // much wider on the sheet than `measureText` reports. Fit against the budget
    // the pre-stretch actually leaves, or a long set name runs into the seam.
    const k = Math.sqrt(layout.stretch);
    const maxW = (f.w * 0.84) / k;
    const measured = ctx.measureText(text).width;
    const squeeze = measured > maxW ? maxW / measured : 1;

    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(squeeze, 1);

    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = size * 0.28;
    ctx.shadowOffsetY = size * 0.06;
    ctx.lineJoin = "round";
    ctx.strokeStyle = shade(accent, -0.75);
    ctx.lineWidth = size * 0.22;
    ctx.strokeText(text, 0, 0);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    ctx.strokeStyle = shade(accent, 0.25);
    ctx.lineWidth = size * 0.09;
    ctx.strokeText(text, 0, 0);

    const fill = ctx.createLinearGradient(0, -size * 0.8, 0, size * 0.24);
    fill.addColorStop(0, "#ffffff");
    fill.addColorStop(0.42, shade(accent, 0.55));
    fill.addColorStop(0.52, shade(accent, -0.1));
    fill.addColorStop(1, shade(accent, 0.3));
    ctx.fillStyle = fill;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  });

  // Double rule with diamond finials, then the variation name.
  const ruleY = baseY + f.h * 0.045;
  const half = f.w * 0.3;
  ctx.save();
  ctx.strokeStyle = rgba(hexToRgb(accent), 0.75);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - half, ruleY);
  ctx.lineTo(cx + half, ruleY);
  ctx.moveTo(cx - half * 0.72, ruleY + 5);
  ctx.lineTo(cx + half * 0.72, ruleY + 5);
  ctx.stroke();
  ctx.fillStyle = rgba(hexToRgb(accent), 0.9);
  for (const sx of [cx - half, cx + half]) {
    ctx.save();
    ctx.translate(sx, ruleY);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
  ctx.restore();

  withAspect(ctx, layout, cx, ruleY + f.h * 0.042, () => {
    ctx.textAlign = "center";
    ctx.font = `700 ${Math.round(f.w * 0.052)}px system-ui, sans-serif`;
    ctx.letterSpacing = `${Math.round(f.w * 0.016)}px`;
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillText(variationName.toUpperCase(), cx, ruleY + f.h * 0.042);
    ctx.letterSpacing = "0px";
  });
}

/**
 * The crest.
 *
 * A hexagon with alternating facets and a specular arc, rather than the blurred
 * circle the variant painter draws — facets catch the light, a blur just glows.
 */
function paintCrest(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  cx: number,
  cy: number,
  r: number,
  accent: string,
): void {
  withAspect(ctx, layout, cx, cy, () => {
    const poly = (radius: number, rot: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = rot + (i / 6) * Math.PI * 2;
        const px = cx + Math.cos(a) * radius;
        const py = cy + Math.sin(a) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
    };

    // Halo
    const halo = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 1.5);
    halo.addColorStop(0, rgba(hexToRgb(accent), 0.35));
    halo.addColorStop(1, rgba(hexToRgb(accent), 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // Body
    poly(r, -Math.PI / 2);
    const body = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    body.addColorStop(0, shade(accent, 0.45));
    body.addColorStop(0.5, shade(accent, -0.2));
    body.addColorStop(1, shade(accent, -0.55));
    ctx.fillStyle = body;
    ctx.fill();

    // Facets: alternating wedges from the centre to each vertex pair.
    for (let i = 0; i < 6; i++) {
      const a0 = -Math.PI / 2 + (i / 6) * Math.PI * 2;
      const a1 = -Math.PI / 2 + ((i + 1) / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
      ctx.lineTo(cx + Math.cos(a1) * r, cy + Math.sin(a1) * r);
      ctx.closePath();
      ctx.fillStyle =
        i % 2 === 0 ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.14)";
      ctx.fill();
    }

    // Inner ring and core
    poly(r * 0.56, -Math.PI / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(2, r * 0.045);
    ctx.stroke();

    const core = ctx.createRadialGradient(
      cx,
      cy - r * 0.12,
      0,
      cx,
      cy,
      r * 0.5,
    );
    core.addColorStop(0, "rgba(255,255,255,0.95)");
    core.addColorStop(0.5, rgba(hexToRgb(accent), 0.5));
    core.addColorStop(1, rgba(hexToRgb(accent), 0));
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
    ctx.fill();

    // Rim light along the top edges
    poly(r, -Math.PI / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = Math.max(1.5, r * 0.03);
    ctx.stroke();

    // Specular arc, tucked against the inner ring — outside it reads as a stray
    // swoosh rather than as light on a facet.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.46, Math.PI * 1.12, Math.PI * 1.62);
    ctx.strokeStyle = "rgba(255,255,255,0.34)";
    ctx.lineWidth = Math.max(1.5, r * 0.04);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  });
}

/** The "11 CARDS" flash, as a starburst rather than a line of body copy. */
function paintCountBurst(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  cx: number,
  cy: number,
  r: number,
  count: number,
  accent: string,
): void {
  withAspect(ctx, layout, cx, cy, () => {
    ctx.beginPath();
    const spikes = 16;
    for (let i = 0; i < spikes * 2; i++) {
      const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
      const rad = i % 2 === 0 ? r : r * 0.78;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    g.addColorStop(0, shade(accent, 0.5));
    g.addColorStop(1, shade(accent, -0.35));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 ${Math.round(r * 0.72)}px system-ui, sans-serif`;
    ctx.fillText(String(count), cx, cy - r * 0.16);
    ctx.font = `800 ${Math.round(r * 0.3)}px system-ui, sans-serif`;
    ctx.fillText("CARDS", cx, cy + r * 0.44);
    ctx.textBaseline = "alphabetic";
  });
}

/**
 * Microtype, drawn as hairlines rather than words.
 *
 * At this scale real small print is a texture, not readable text — and drawing
 * rules instead of glyphs avoids inventing legal copy that says nothing.
 */
function paintMicrotype(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  lines: number,
  rand: () => number,
  alpha = 0.4,
): void {
  ctx.save();
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  for (let i = 0; i < lines; i++) {
    const lw = w * (0.55 + rand() * 0.45);
    ctx.fillRect(x, y + i * 5, lw, 1.5);
  }
  ctx.restore();
}

/** Barcode block: seeded bar widths, so it is stable but not a repeating pattern. */
function paintBarcode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  rand: () => number,
): void {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = "#0a0a0a";
  let px = x;
  while (px < x + w - 1) {
    const bw = 1 + Math.floor(rand() * 3);
    if (rand() > 0.38) ctx.fillRect(px, y, bw, h);
    px += bw + 1 + Math.floor(rand() * 2);
  }
  ctx.restore();
}

/** The dark band across the foot of the display face. */
function paintFootStrip(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  f: { x: number; y: number; w: number; h: number },
  setName: string,
  rand: () => number,
): void {
  // Sat just clear of the bottom edge: the crimp band eats the last few percent
  // of the panel, and a strip flush to the edge loses its second line under it.
  const h = f.h * 0.105;
  const y = f.y + f.h - h - f.h * 0.022;
  ctx.save();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, "rgba(0,0,0,0.15)");
  g.addColorStop(0.25, "rgba(0,0,0,0.62)");
  g.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = g;
  ctx.fillRect(f.x, y, f.w, h);
  ctx.restore();

  const pad = f.w * 0.055;
  const barW = f.w * 0.17;
  const barH = h * 0.42;
  paintBarcode(ctx, f.x + pad, y + h * 0.29, barW, barH, rand);
  paintMicrotype(
    ctx,
    f.x + pad + barW + pad * 0.5,
    y + h * 0.32,
    f.w * 0.22,
    4,
    rand,
    0.3,
  );

  const rx = f.x + f.w - pad;
  withAspect(ctx, layout, rx, y + h * 0.52, () => {
    ctx.textAlign = "right";
    ctx.font = `700 ${Math.round(f.w * 0.036)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.fillText(setName.toUpperCase(), rx, y + h * 0.52);
    ctx.font = `500 ${Math.round(f.w * 0.027)}px system-ui, sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillText("SIMULATED · NOT FOR RESALE", rx, y + h * 0.86);
  });
}

/* ------------------------------------------------------------------ */
/*  Seams and crimps (same treatment pack-core's painter uses)          */
/* ------------------------------------------------------------------ */

function paintSeams(ctx: CanvasRenderingContext2D, layout: SheetLayout): void {
  for (const s of layout.seams) {
    const g = ctx.createLinearGradient(s.x, 0, s.x + s.w, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.5, "rgba(0,0,0,0.4)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(s.x, 0, s.w, layout.height);
  }
}

function paintCrimps(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  accent: string,
  rand: () => number,
): void {
  // The crimp rects are only a couple of pixels tall — the physical fold is thin —
  // so the visible band is grown around them rather than drawn at their height.
  const band = layout.height * 0.05;
  for (const crimp of layout.crimps) {
    const y0 = Math.max(0, crimp.y + crimp.h / 2 - band / 2);
    for (let x = 0; x < layout.width; x += 4) {
      const lum = 150 + Math.sin(x * 1.1) * 22 + rand() * 12;
      ctx.fillStyle = `rgb(${lum},${lum},${lum + 8})`;
      ctx.fillRect(x, y0, 4, band);
    }
    ctx.fillStyle = rgba(hexToRgb(accent), 0.28);
    ctx.fillRect(0, y0, layout.width, band);
    for (let yy = y0 + 3; yy < y0 + band; yy += 6) {
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, yy, layout.width, 1);
    }
  }
}

/**
 * The reverse face, drawn once and then cut across the seam.
 *
 * The back is a single panel that the wrap splits into blocks sitting at
 * opposite ends of the sheet, so anything centred per block lands twice and
 * half-clipped. `layout.back` is ordered by position around the pack, not by
 * position on the sheet — so the furniture is drawn into one virtual panel of
 * the joined width and each slice is blitted to its own rect, which is what
 * keeps a wordmark whole across the fold.
 */
function paintBackFace(
  ctx: CanvasRenderingContext2D,
  layout: SheetLayout,
  spec: BoosterSheetSpec,
  rand: () => number,
): void {
  const blocks = layout.back;
  if (blocks.length === 0) return;

  const totalW = blocks.reduce((sum, b) => sum + b.w, 0);
  const h = Math.max(...blocks.map((b) => b.h));

  const panel = document.createElement("canvas");
  panel.width = Math.ceil(totalW);
  panel.height = Math.ceil(h);
  const pctx = panel.getContext("2d")!;

  const k = Math.sqrt(layout.stretch);
  const cx = totalW / 2;
  const brand = (spec.brand ?? "TCGer").toUpperCase();

  pctx.save();
  pctx.translate(cx, 0);
  pctx.scale(k, 1 / k);
  pctx.translate(-cx, 0);
  pctx.textAlign = "center";
  pctx.font = `800 ${Math.round(h * 0.05)}px system-ui, sans-serif`;
  pctx.letterSpacing = `${Math.round(h * 0.012)}px`;
  pctx.fillStyle = "rgba(255,255,255,0.5)";
  pctx.fillText(brand, cx, h * 0.4);
  pctx.letterSpacing = "0px";
  pctx.font = `600 ${Math.round(h * 0.031)}px system-ui, sans-serif`;
  pctx.fillStyle = "rgba(255,255,255,0.34)";
  pctx.fillText(spec.setName.toUpperCase(), cx, h * 0.44);
  pctx.restore();

  paintMicrotype(pctx, totalW * 0.22, h * 0.56, totalW * 0.56, 8, rand, 0.18);

  let cut = 0;
  for (const block of blocks) {
    ctx.drawImage(
      panel,
      cut,
      0,
      block.w,
      block.h,
      block.x,
      block.y,
      block.w,
      block.h,
    );
    cut += block.w;
  }
}

/* ------------------------------------------------------------------ */
/*  The sheet                                                          */
/* ------------------------------------------------------------------ */

/**
 * Paints a booster wrapper into `canvas`, sized to the layout.
 *
 * Returns nothing — the caller owns the canvas, so this works the same whether
 * it is going into a `THREE.CanvasTexture` for the pack mesh or straight onto
 * the page for a flat preview.
 */
export function paintBoosterSheet(
  canvas: HTMLCanvasElement,
  layout: SheetLayout,
  spec: BoosterSheetSpec,
): void {
  const { color } = gamePresentation(spec.game);
  const accent = color;
  const rand = rng(spec.seed ?? hashString(`${spec.game}:${spec.setName}`));

  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext("2d")!;

  // Ground: the gradient runs down the sheet, which is down the pack — the
  // sheet's y axis is the pack's height on every panel, front and back alike.
  const ground = ctx.createLinearGradient(0, 0, 0, layout.height);
  ground.addColorStop(0, shade(accent, -0.72));
  ground.addColorStop(0.42, shade(accent, -0.34));
  ground.addColorStop(1, shade(accent, -0.8));
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, layout.width, layout.height);

  paintFoil(ctx, layout, accent, rand);

  const f = layout.front;
  const cx = f.x + f.w / 2;

  paintSheen(ctx, cx, f.y + f.h * 0.5, f.w * 0.62, accent);

  for (const block of layout.back) {
    paintVignette(ctx, block.x, block.y, block.w, block.h);
  }
  paintVignette(ctx, f.x, f.y, f.w, f.h);

  // --- display face ---------------------------------------------------------
  clip(ctx, f.x, f.y, f.w, f.h, () => {
    paintBrandBand(ctx, layout, f, spec.brand ?? "TCGer", accent);
    paintSetLockup(ctx, layout, f, spec.setName, spec.variationName, accent);
    paintCrest(ctx, layout, cx, f.y + f.h * 0.6, f.w * 0.21, accent);
    paintCountBurst(
      ctx,
      layout,
      f.x + f.w * 0.79,
      f.y + f.h * 0.76,
      f.w * 0.115,
      spec.cardCount,
      accent,
    );
    paintFootStrip(ctx, layout, f, spec.setName, rand);
  });

  // --- reverse face ---------------------------------------------------------
  paintBackFace(ctx, layout, spec, rand);

  paintSeams(ctx, layout);
  paintCrimps(ctx, layout, accent, rand);
}

/** Stable seed from a string, so a set looks the same every time it is painted. */
function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

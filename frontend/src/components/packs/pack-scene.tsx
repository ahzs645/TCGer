"use client";

import {
  useFrame,
  useLoader,
  useThree,
  type ThreeEvent,
} from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

import {
  PACK_VARIANTS,
  tierRank,
  type PackVariant,
  type PulledCard,
} from "./pack-data";

export type PackPhase =
  | "select"
  | "tear"
  | "opening"
  | "reveal"
  | "summary"
  | "final";

export interface PackSceneControls {
  timeScale: number;
}

interface PackExperienceProps {
  cards: PulledCard[];
  variant: PackVariant;
  /** total packs being opened — bulk opens render the whole stack and one tear cuts all of them */
  packCount: number;
  phase: PackPhase;
  controls: React.MutableRefObject<PackSceneControls>;
  onTorn: () => void;
  onOpened: () => void;
  onReveal: (revealedCount: number) => void;
  onAllRevealed: () => void;
  onFlash: () => void;
}

const PACK_W = 2.3;
const PACK_H = 3.3;
const TEAR_FRAC = 0.8;
const TEAR_Y = PACK_H * (TEAR_FRAC - 0.5);
const CARD_W = 2.02;
const CARD_H = CARD_W * (88 / 63);
const GOLD = new THREE.Color("#ffd76a");

/* ---------------------------------- helpers --------------------------------- */

type CutFn = (x: number) => number;

const PACK_T = 0.13; // half-thickness of the slab

/**
 * Pocket-style slab profile: flat across the face, rounded at the left/right
 * edges (clamped so the slab keeps visible thickness), pinched at the crimps.
 */
function faceZ(x: number, packFrac: number): number {
  const crimp = Math.min(1, Math.min(packFrac, 1 - packFrac) / 0.07);
  const plateau = Math.max(
    0.5,
    1 - Math.pow(Math.abs((2 * x) / PACK_W), 7) * 0.9,
  );
  return PACK_T * plateau * crimp + 0.01;
}

/** Straight factory perforation — used until the user actually tears. */
const STRAIGHT_CUT: CutFn = () => TEAR_Y;

/** The whole front face, for pack-select thumbnails. */
const FULL_FACE_CUT: CutFn = () => PACK_H / 2;

/**
 * Wrapper face split along an arbitrary cut line. Vertex positions are baked
 * in pack-local coordinates (mesh sits at the group origin). `mirrored`
 * builds the back face's copy of an asymmetric cut (back meshes are rotated
 * 180°, so their local x is the world's -x).
 */
function makeWrapperGeometry(
  cutFn: CutFn,
  part: "body" | "strip",
  mirrored = false,
): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(PACK_W, 1, 24, 18);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const cutFrac = cutFn(mirrored ? -x : x) / PACK_H + 0.5;
    const rowFrac = pos.getY(i) + 0.5;
    const packFrac =
      part === "body" ? rowFrac * cutFrac : cutFrac + rowFrac * (1 - cutFrac);
    pos.setY(i, PACK_H * (packFrac - 0.5));
    pos.setZ(i, faceZ(x, packFrac));
    uv.setY(i, packFrac);
  }
  geo.computeVertexNormals();
  return geo;
}

// how far the cut may wander from the perforation: generous downward into the
// art, bounded above by the crimp
const CUT_MIN = TEAR_Y - 0.55;
const CUT_MAX = TEAR_Y + 0.34;

/**
 * Piecewise-linear cut line through the user's actual drag path — lightly
 * smoothed so pointer noise doesn't spike, but the drawn shape is kept.
 */
function buildCutFnFromPath(path: { x: number; y: number }[]): CutFn {
  const sorted = path
    .filter((p, i, arr) => i === 0 || Math.abs(p.x - arr[i - 1].x) > 0.015)
    .sort((a, b) => a.x - b.x);
  // 3-tap moving average preserves the drawn line while killing jitter
  const pts = sorted.map((p, i, arr) => {
    const prev = arr[Math.max(0, i - 1)];
    const next = arr[Math.min(arr.length - 1, i + 1)];
    return { x: p.x, y: (prev.y + p.y + next.y) / 3 };
  });
  return (x: number) => {
    let base = TEAR_Y;
    if (pts.length >= 2) {
      if (x <= pts[0].x) base = pts[0].y;
      else if (x >= pts[pts.length - 1].x) base = pts[pts.length - 1].y;
      else {
        for (let i = 1; i < pts.length; i++) {
          if (x <= pts[i].x) {
            const t = (x - pts[i - 1].x) / (pts[i].x - pts[i - 1].x || 1);
            base = THREE.MathUtils.lerp(pts[i - 1].y, pts[i].y, t);
            break;
          }
        }
      }
    }
    // no artificial jag: the cut is exactly the user's (smoothed) drag path
    return THREE.MathUtils.clamp(base, CUT_MIN, CUT_MAX);
  };
}

/** Jagged-but-centered cut for skip-tear / fallback opens. */
const DEFAULT_TORN_CUT: CutFn = (x) =>
  TEAR_Y + Math.sin(x * 23.7) * 0.012 + Math.sin(x * 57.3 + 2) * 0.009;

/** Thin glowing ribbon that hugs the cut edge (Pocket's cyan tear glow). */
function makeEdgeGeometry(cutFn: CutFn, side: "body" | "strip"): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(PACK_W, 1, 48, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const cy = cutFn(x);
    const isOuterRow = pos.getY(i) > 0;
    const off =
      side === "body" ? (isOuterRow ? 0 : -0.06) : isOuterRow ? 0.06 : 0;
    const packFrac = (cy + off) / PACK_H + 0.5;
    pos.setY(i, cy + off);
    pos.setZ(i, faceZ(x, packFrac) + 0.025);
  }
  return geo;
}

interface CutGeometrySet {
  bodyF: THREE.PlaneGeometry;
  bodyB: THREE.PlaneGeometry;
  stripF: THREE.PlaneGeometry;
  stripB: THREE.PlaneGeometry;
  edgeBody: THREE.PlaneGeometry;
  edgeStrip: THREE.PlaneGeometry;
}

function buildCutSet(cutFn: CutFn): CutGeometrySet {
  return {
    bodyF: makeWrapperGeometry(cutFn, "body"),
    bodyB: makeWrapperGeometry(cutFn, "body", true),
    stripF: makeWrapperGeometry(cutFn, "strip"),
    stripB: makeWrapperGeometry(cutFn, "strip", true),
    edgeBody: makeEdgeGeometry(cutFn, "body"),
    edgeStrip: makeEdgeGeometry(cutFn, "strip"),
  };
}

function drawMotif(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  variant: PackVariant,
) {
  const { motif, palette } = variant;
  ctx.save();
  if (motif === "aurora") {
    for (let i = 0; i < 5; i++) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "rgba(64,224,208,0)");
      g.addColorStop(0.5, `rgba(${80 + i * 30},${200 - i * 20},255,0.12)`);
      g.addColorStop(1, "rgba(64,224,208,0)");
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-0.5 + i * 0.22);
      ctx.fillRect(-w, -40 - i * 26, w * 2, 60);
      ctx.restore();
    }
  } else if (motif === "flame") {
    for (let i = 0; i < 7; i++) {
      const cx = (0.12 + i * 0.13) * w;
      const base = h * (0.78 + (i % 2) * 0.05);
      const fh = h * (0.22 + (i % 3) * 0.08);
      const grad = ctx.createLinearGradient(0, base, 0, base - fh);
      grad.addColorStop(0, "rgba(255,80,20,0.05)");
      grad.addColorStop(0.6, "rgba(255,140,40,0.22)");
      grad.addColorStop(1, "rgba(255,220,120,0.05)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(cx - 26, base);
      ctx.bezierCurveTo(
        cx - 30,
        base - fh * 0.45,
        cx + 18,
        base - fh * 0.5,
        cx,
        base - fh,
      );
      ctx.bezierCurveTo(cx + 34, base - fh * 0.45, cx + 26, base, cx + 26, base);
      ctx.closePath();
      ctx.fill();
    }
  } else if (motif === "wave") {
    for (let i = 0; i < 4; i++) {
      const yBase = h * (0.55 + i * 0.11);
      ctx.strokeStyle = `rgba(140,220,255,${0.22 - i * 0.04})`;
      ctx.lineWidth = 14 - i * 2;
      ctx.beginPath();
      for (let x = -20; x <= w + 20; x += 8) {
        const y = yBase + Math.sin((x / w) * Math.PI * 3 + i * 1.4) * 16;
        if (x === -20) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (motif === "leaf") {
    for (let i = 0; i < 14; i++) {
      const cx = Math.random() * w;
      const cy = h * 0.3 + Math.random() * h * 0.6;
      const rot = Math.random() * Math.PI * 2;
      const len = 26 + Math.random() * 30;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.fillStyle = `rgba(150,255,160,${0.06 + Math.random() * 0.12})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, len, len * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(200,255,200,0.15)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.restore();
    }
  }
  // shared accent shimmer
  const shimmer = ctx.createLinearGradient(0, 0, w, h * 0.6);
  shimmer.addColorStop(0, "rgba(255,255,255,0)");
  shimmer.addColorStop(0.5, `${palette.accent}22`);
  shimmer.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = shimmer;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function paintWrapper(variant: PackVariant, front: boolean): THREE.CanvasTexture {
  const w = 512;
  const h = 768;
  const { palette } = variant;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, palette.top);
  sky.addColorStop(0.45, palette.mid);
  sky.addColorStop(1, palette.bottom);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  drawMotif(ctx, w, h, variant);

  // sparkles
  for (let i = 0; i < 55; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = Math.random() * 1.4 + 0.3;
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.35 + 0.08})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (front) {
    // emblem
    const cy = h * 0.46;
    const emblem = ctx.createRadialGradient(w / 2, cy, 10, w / 2, cy, 150);
    emblem.addColorStop(0, "rgba(255,255,255,0.85)");
    emblem.addColorStop(0.35, `${palette.accent}66`);
    emblem.addColorStop(1, `${palette.accent}00`);
    ctx.fillStyle = emblem;
    ctx.beginPath();
    ctx.arc(w / 2, cy, 150, 0, Math.PI * 2);
    ctx.fill();
    // foil ring
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(w / 2, cy, 96, 0, Math.PI * 2);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 92px system-ui, sans-serif";
    ctx.shadowColor = palette.glow;
    ctx.shadowBlur = 24;
    ctx.fillText("TCGer", w / 2, h * 0.26);
    ctx.shadowBlur = 0;
    ctx.font = "700 34px system-ui, sans-serif";
    ctx.fillStyle = palette.accent;
    ctx.fillText(variant.name.toUpperCase(), w / 2, h * 0.325);
    ctx.font = "600 28px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("DEMO BOOSTER", w / 2, h * 0.64);
    ctx.font = "500 21px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("5 CARDS · EVOLVING SKIES POOL", w / 2, h * 0.895);
  } else {
    ctx.textAlign = "center";
    ctx.font = "600 26px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(`TCGer · ${variant.name.toUpperCase()}`, w / 2, h * 0.5);
  }

  // crimp bands top + bottom — subtle fine ridges, tinted toward the palette
  for (const [y0, y1] of [
    [0, h * 0.06],
    [h * 0.94, h],
  ] as const) {
    for (let x = 0; x < w; x += 4) {
      const lum = 150 + Math.sin(x * 1.1) * 22 + Math.random() * 12;
      ctx.fillStyle = `rgb(${lum},${lum},${lum + 8})`;
      ctx.fillRect(x, y0, 4, y1 - y0);
    }
    ctx.fillStyle = `${palette.mid}44`;
    ctx.fillRect(0, y0, w, y1 - y0);
    for (let yy = y0 + 3; yy < y1; yy += 6) {
      ctx.fillStyle = "rgba(0,0,0,0.08)";
      ctx.fillRect(0, yy, w, 1);
    }
  }

  // perforated tear line
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h * (1 - TEAR_FRAC));
  ctx.lineTo(w, h * (1 - TEAR_FRAC));
  ctx.stroke();
  ctx.setLineDash([]);

  // rounded face corners, like the reference pack
  ctx.globalCompositeOperation = "destination-out";
  const cr = 26;
  for (const [cx2, cy2, sx, sy] of [
    [0, 0, 1, 1],
    [w, 0, -1, 1],
    [0, h, 1, -1],
    [w, h, -1, -1],
  ] as const) {
    const ccx = cx2 + sx * cr;
    const ccy = cy2 + sy * cr;
    const a1 = Math.atan2(-sy * cr, 0); // angle of the horizontal-edge point
    const a2 = Math.atan2(0, -sx * cr); // angle of the vertical-edge point
    ctx.beginPath();
    ctx.moveTo(cx2, cy2);
    ctx.lineTo(ccx, cy2);
    ctx.arc(ccx, ccy, cr, a1, a2, sx * sy > 0);
    ctx.closePath();
    ctx.fill();
  }

  // serrated crimp edges: notch triangles out of the very top/bottom
  const tooth = 12;
  const toothDepth = 5;
  ctx.beginPath();
  for (let x = 0; x < w; x += tooth) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x + tooth / 2, toothDepth);
    ctx.lineTo(x + tooth, 0);
  }
  for (let x = 0; x < w; x += tooth) {
    ctx.moveTo(x, h);
    ctx.lineTo(x + tooth / 2, h - toothDepth);
    ctx.lineTo(x + tooth, h);
  }
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Procedural crinkle normal map so the foil catches light unevenly. */
function makeWrinkleNormalTexture(): THREE.DataTexture {
  const w = 128;
  const h = 192;
  const height = new Float32Array(w * h);
  // soft random bumps
  for (let k = 0; k < 70; k++) {
    const cx = Math.random() * w;
    const cy = Math.random() * h;
    const r = 4 + Math.random() * 16;
    const amp = (Math.random() - 0.5) * 1.8;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d2 = ((x - cx) ** 2 + (y - cy) ** 2) / (r * r);
        if (d2 < 1) height[y * w + x] += amp * Math.exp(-d2 * 3);
      }
    }
  }
  // fine crinkle
  for (let i = 0; i < height.length; i++) height[i] += (Math.random() - 0.5) * 0.3;

  const data = new Uint8Array(w * h * 4);
  const strength = 1.6;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xm = height[y * w + Math.max(0, x - 1)];
      const xp = height[y * w + Math.min(w - 1, x + 1)];
      const ym = height[Math.max(0, y - 1) * w + x];
      const yp = height[Math.min(h - 1, y + 1) * w + x];
      const n = new THREE.Vector3(
        -(xp - xm) * strength,
        -(yp - ym) * strength,
        1,
      ).normalize();
      const i = (y * w + x) * 4;
      data[i] = Math.round(n.x * 127 + 128);
      data[i + 1] = Math.round(n.y * 127 + 128);
      data[i + 2] = Math.round(n.z * 127 + 128);
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

function makeGlowTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

const HOLO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDirW = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const HOLO_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDirW;
  uniform float uTime;
  uniform float uIntensity;
  uniform vec2 uTilt;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    float facing = clamp(dot(normalize(vViewDirW), normalize(vNormalW)), 0.0, 1.0);
    float fres = pow(1.0 - facing, 1.2) * 0.6 + 0.4;
    float band1 = sin((vUv.x + vUv.y) * 11.0 + uTilt.x * 5.0 + uTime * 0.7);
    float band2 = sin((vUv.x - vUv.y) * 8.0 - uTilt.y * 5.0 - uTime * 0.5);
    float mask =
      smoothstep(0.55, 0.95, band1 * 0.5 + 0.5) * 0.7 +
      smoothstep(0.6, 0.95, band2 * 0.5 + 0.5) * 0.5;
    vec3 col = hsv2rgb(vec3(
      fract(vUv.x * 0.5 + vUv.y * 0.35 + uTilt.x * 0.25 + uTime * 0.02),
      0.65,
      1.0
    ));
    gl_FragColor = vec4(col * mask * fres * uIntensity, 0.0);
  }
`;

const SHEEN_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SHEEN_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  uniform sampler2D uMap;
  uniform float uTime;
  uniform float uOpacity;
  void main() {
    float a = texture2D(uMap, vUv).a;
    float d = vUv.x * 0.75 + vUv.y * 0.5;
    float p = fract(d * 0.8 - uTime * 0.1);
    float band = smoothstep(0.40, 0.5, p) * smoothstep(0.60, 0.5, p);
    gl_FragColor = vec4(vec3(1.0) * band * 0.4 * a * uOpacity, 0.0);
  }
`;

/** Soft light band that sweeps across the wrapper, TCG Pocket style. */
function makeSheenMaterial(map: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SHEEN_VERTEX,
    fragmentShader: SHEEN_FRAGMENT,
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function makeHoloMaterial(intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: HOLO_VERTEX,
    fragmentShader: HOLO_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: intensity },
      uTilt: { value: new THREE.Vector2() },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t: number): number {
  return t * t * t;
}

function holoIntensityFor(card: PulledCard): number {
  const rank = tierRank(card.tier);
  if (rank >= 4) return 0.85; // chase
  if (rank >= 3) return 0.6; // ultra
  if (rank >= 2) return 0.35; // rare / holo
  return 0;
}

/** Procedural indoor environment so the foil has something to reflect. */
export function FoilEnvironment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
    scene.environment = env;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return null;
}

interface FoilMaterialProps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  materialRef?: (mat: THREE.MeshPhysicalMaterial | null) => void;
}

function FoilMaterial({ map, normalMap, materialRef }: FoilMaterialProps) {
  return (
    <meshPhysicalMaterial
      ref={materialRef}
      map={map}
      normalMap={normalMap}
      normalScale={new THREE.Vector2(0.06, 0.06)}
      metalness={0.45}
      roughness={0.24}
      clearcoat={0.9}
      clearcoatRoughness={0.2}
      iridescence={0.25}
      iridescenceIOR={1.3}
      envMapIntensity={0.9}
      transparent
      alphaTest={0.02}
    />
  );
}

/* ------------------------------- pack select -------------------------------- */

interface PackSelectRowProps {
  onSelect: (variantId: string) => void;
}

export function PackSelectRow({ onSelect }: PackSelectRowProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const groupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const fullGeo = useMemo(() => makeWrapperGeometry(FULL_FACE_CUT, "body"), []);
  const normalTex = useMemo(() => makeWrinkleNormalTexture(), []);
  const textures = useMemo(
    () =>
      PACK_VARIANTS.map((v) => {
        const front = paintWrapper(v, true);
        return {
          variant: v,
          front,
          back: paintWrapper(v, false),
          sheen: makeSheenMaterial(front),
        };
      }),
    [],
  );

  useEffect(() => {
    document.body.style.cursor = hovered ? "pointer" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [hovered]);

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    textures.forEach(({ variant, sheen }, i) => {
      sheen.uniforms.uTime.value = t + i * 2.3;
      const group = groupRefs.current.get(variant.id);
      if (!group) return;
      const isHover = hovered === variant.id;
      group.position.y = Math.sin(t * 1.2 + i * 1.1) * 0.05 + (isHover ? 0.12 : 0);
      // carousel: side packs angle inward toward the center, reference-style
      const carouselAngle = -(i - (PACK_VARIANTS.length - 1) / 2) * 0.24;
      group.rotation.y = THREE.MathUtils.damp(
        group.rotation.y,
        isHover
          ? state.pointer.x * 0.3
          : carouselAngle + Math.sin(t * 0.6 + i) * 0.04,
        4,
        dt,
      );
      const target = isHover ? 0.72 : 0.6;
      group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, target, 6, dt));
    });
  });

  return (
    <group>
      <FoilEnvironment />
      <ambientLight intensity={0.5} />
      <directionalLight position={[3, 5, 6]} intensity={0.9} />
      {textures.map(({ variant, front, back, sheen }, i) => (
        <group
          key={variant.id}
          ref={(g) => {
            if (g) groupRefs.current.set(variant.id, g);
          }}
          position={[
            (i - (PACK_VARIANTS.length - 1) / 2) * 1.85,
            0,
            -Math.abs(i - (PACK_VARIANTS.length - 1) / 2) * 0.35,
          ]}
          scale={0.6}
          onPointerOver={(e) => {
            e.stopPropagation();
            setHovered(variant.id);
          }}
          onPointerOut={() => setHovered(null)}
          onPointerDown={(e) => {
            e.stopPropagation();
            onSelect(variant.id);
          }}
        >
          <mesh geometry={fullGeo}>
            <FoilMaterial map={front} normalMap={normalTex} />
          </mesh>
          <mesh geometry={fullGeo} position={[0, 0, 0.004]} material={sheen} />
          <mesh geometry={fullGeo} rotation={[0, Math.PI, 0]}>
            <FoilMaterial map={back} normalMap={normalTex} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh
              key={side}
              position={[side * (PACK_W / 2 - 0.005), 0, 0.005]}
              rotation={[0, (side * Math.PI) / 2, 0]}
            >
              <planeGeometry args={[PACK_T * 1.15, PACK_H * 0.85]} />
              <meshPhysicalMaterial
                color={variant.palette.bottom}
                roughness={0.5}
                metalness={0.3}
              />
            </mesh>
          ))}
          {/* floor reflection */}
          <mesh
            geometry={fullGeo}
            scale={[1, -1, 1]}
            position={[0, -PACK_H * 1.02, 0]}
          >
            <meshBasicMaterial
              map={front}
              transparent
              opacity={0.13}
              depthWrite={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ---------------------------------- scene ----------------------------------- */

export function PackExperience({
  cards,
  variant,
  packCount,
  phase,
  controls,
  onTorn,
  onOpened,
  onReveal,
  onAllRevealed,
  onFlash,
}: PackExperienceProps) {
  const stackCount = Math.min(packCount, 10);
  // bulk stacks sit lower so the upward cascade stays in frame
  const packBaseY = stackCount > 1 ? -0.55 : 0;
  const [cutGeos, setCutGeos] = useState<CutGeometrySet | null>(null);
  const cutBuiltRef = useRef(false);
  const frontTextures = useLoader(
    THREE.TextureLoader,
    cards.map((c) => c.imageUrl),
  );
  const backTexture = useLoader(THREE.TextureLoader, "/card-backs/pokemon.png");

  useMemo(() => {
    for (const tex of [...frontTextures, backTexture]) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
    }
  }, [frontTextures, backTexture]);

  const wrapperFrontTex = useMemo(() => paintWrapper(variant, true), [variant]);
  const wrapperBackTex = useMemo(() => paintWrapper(variant, false), [variant]);
  const normalTex = useMemo(() => makeWrinkleNormalTexture(), []);
  const glowTex = useMemo(() => makeGlowTexture(), []);
  const sheenMat = useMemo(
    () => makeSheenMaterial(wrapperFrontTex),
    [wrapperFrontTex],
  );
  const accentColor = useMemo(
    () => new THREE.Color(variant.palette.accent),
    [variant],
  );
  const glowColor = useMemo(
    () => new THREE.Color(variant.palette.glow),
    [variant],
  );

  const bodyGeo = useMemo(() => makeWrapperGeometry(STRAIGHT_CUT, "body"), []);
  const stripGeo = useMemo(() => makeWrapperGeometry(STRAIGHT_CUT, "strip"), []);

  const holoMaterials = useMemo(
    () => cards.map((card) => makeHoloMaterial(holoIntensityFor(card))),
    [cards],
  );

  const packRef = useRef<THREE.Group>(null);
  const stripRefs = useRef<(THREE.Group | null)[]>([]);
  const bodyRefs = useRef<(THREE.Group | null)[]>([]);
  const stackRef = useRef<THREE.Group>(null);
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const tearHeadRef = useRef<THREE.Sprite>(null);
  // glowing polyline tracing the user's actual drag path
  const tearTrail = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(80 * 3), 3),
    );
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({
      color: new THREE.Color("#bffcff"),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 8;
    return line;
  }, []);
  // WebGL lines are 1px — glow points along the same path give it body
  const tearTrailPoints = useMemo(() => {
    const pts = new THREE.Points(
      tearTrail.geometry,
      new THREE.PointsMaterial({
        map: glowTex,
        size: 0.16,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        color: new THREE.Color("#dffcff"),
      }),
    );
    pts.frustumCulled = false;
    pts.renderOrder = 8;
    return pts;
  }, [tearTrail, glowTex]);
  const chargeGlowRef = useRef<THREE.Sprite>(null);
  const edgeBodyMatRef = useRef<THREE.MeshBasicMaterial>(null);
  const edgeStripMatRef = useRef<THREE.MeshBasicMaterial>(null);

  const wrapperMaterials = useRef<THREE.MeshPhysicalMaterial[]>([]);

  const anim = useRef({
    torn: false,
    openT: 0,
    openedNotified: false,
    topIndex: 0,
    charge: { t: 0, done: false },
    dismiss: new Map<number, { t: number; dir: number }>(),
    allNotified: false,
    tear: {
      active: false,
      startX: 0,
      dir: 1,
      progress: 0,
      path: [] as { x: number; y: number }[],
    },
  });

  // pointer-up anywhere ends the tear drag
  useEffect(() => {
    const end = () => {
      anim.current.tear.active = false;
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  const registerWrapperMaterial = (mat: THREE.MeshPhysicalMaterial | null) => {
    if (mat && !wrapperMaterials.current.includes(mat)) {
      mat.transparent = true;
      wrapperMaterials.current.push(mat);
    }
  };

  const recordTearPoint = (e: ThreeEvent<PointerEvent>) => {
    // convert to pack-local space so the recorded path is exact even while
    // the pack is tilted mid-float
    const local = packRef.current
      ? packRef.current.worldToLocal(e.point.clone())
      : e.point;
    return {
      x: local.x,
      // clamp at record time so the live trail shows exactly what the cut gets
      y: THREE.MathUtils.clamp(local.y, CUT_MIN, CUT_MAX),
    };
  };

  const handleTearDown = (e: ThreeEvent<PointerEvent>) => {
    if (phase !== "tear") return;
    e.stopPropagation();
    anim.current.tear.active = true;
    anim.current.tear.startX = e.point.x;
    anim.current.tear.path = [recordTearPoint(e)];
  };

  const handleTearMove = (e: ThreeEvent<PointerEvent>) => {
    const tear = anim.current.tear;
    if (phase !== "tear" || !tear.active || anim.current.torn) return;
    const dx = e.point.x - tear.startX;
    if (Math.abs(dx) > 0.01) tear.dir = Math.sign(dx);
    if (tear.path.length < 80) tear.path.push(recordTearPoint(e));
    tear.progress = THREE.MathUtils.clamp(Math.abs(dx) / (PACK_W * 0.72), 0, 1);
    if (tear.progress >= 1) {
      anim.current.torn = true;
      tear.active = false;
      // the cut follows the drag path, so every tear is a little different
      cutBuiltRef.current = true;
      setCutGeos(buildCutSet(buildCutFnFromPath(tear.path)));
      onTorn();
    }
  };

  const handleStackClick = (e: ThreeEvent<PointerEvent>) => {
    if (phase !== "reveal") return;
    e.stopPropagation();
    const a = anim.current;
    const idx = a.topIndex;
    if (idx >= cards.length) return;
    const isBig = tierRank(cards[idx].tier) >= 3;
    if (isBig && !a.charge.done) {
      a.charge.done = true; // skip the buildup
      onFlash();
      return;
    }
    a.dismiss.set(idx, { t: 0, dir: idx % 2 === 0 ? 1 : -1 });
    a.topIndex = idx + 1;
    a.charge = { t: 0, done: false };
    if (a.topIndex < cards.length) onReveal(a.topIndex + 1);
  };

  useFrame((state, rawDelta) => {
    const ts = controls.current.timeScale;
    const dt = Math.min(rawDelta, 0.05) * ts;
    const t = state.clock.elapsedTime;
    const a = anim.current;
    const pointer = state.pointer;

    // cards stay hidden inside the sealed pack — transparent-object depth
    // sorting otherwise draws them over the wrapper as the pack tilts
    if (stackRef.current) {
      stackRef.current.visible =
        phase === "reveal" || (phase === "opening" && a.openT > 0.3);
    }

    // skip-tear / fallback opens still get a (jagged, centered) cut edge
    if (phase === "opening" && !cutGeos && !cutBuiltRef.current) {
      cutBuiltRef.current = true;
      setCutGeos(buildCutSet(DEFAULT_TORN_CUT));
    }

    // glowing cut edge, pulsing like the reference
    const glowPulse = 0.55 + Math.sin(t * 9) * 0.25;
    if (edgeBodyMatRef.current) {
      edgeBodyMatRef.current.opacity = cutGeos
        ? glowPulse * (wrapperMaterials.current[0]?.opacity ?? 1)
        : 0;
    }
    if (edgeStripMatRef.current) {
      edgeStripMatRef.current.opacity = cutGeos ? glowPulse : 0;
    }

    // --- pack idle float + tilt toward pointer -------------------------------
    const tear = a.tear;
    if (packRef.current) {
      const pack = packRef.current;
      if (phase === "tear") {
        // hold the pack steady while the user is cutting so the trail lands
        // where they actually drag
        if (tear.active) {
          pack.position.y = THREE.MathUtils.damp(
            pack.position.y,
            packBaseY,
            10,
            dt,
          );
          pack.rotation.y = THREE.MathUtils.damp(pack.rotation.y, 0, 10, dt);
          pack.rotation.x = THREE.MathUtils.damp(pack.rotation.x, 0, 10, dt);
        } else {
          // bulk stacks barely tilt — seen edge-on, the pitched slats splay
          // into a fanned mess (reference app locks its stack down too)
          const tiltY = stackCount > 1 ? 0.06 : 0.35;
          const tiltX = stackCount > 1 ? 0.04 : 0.2;
          pack.position.y = packBaseY + Math.sin(t * 1.3) * 0.06;
          pack.rotation.y = THREE.MathUtils.damp(
            pack.rotation.y,
            pointer.x * tiltY,
            4,
            dt,
          );
          pack.rotation.x = THREE.MathUtils.damp(
            pack.rotation.x,
            -pointer.y * tiltX,
            4,
            dt,
          );
        }
      }
    }

    // --- tear feedback: glowing trail along the actual drag path -------------
    if (phase === "tear" && !tear.active && !a.torn && tear.progress > 0) {
      tear.progress = Math.max(0, tear.progress - dt * 1.6); // spring back
    }
    const trailVisible =
      phase === "tear" &&
      !a.torn &&
      tear.path.length > 1 &&
      (tear.active || tear.progress > 0.01);
    tearTrail.visible = trailVisible;
    tearTrailPoints.visible = trailVisible;
    if (trailVisible) {
      (tearTrailPoints.material as THREE.PointsMaterial).opacity =
        0.25 + tear.progress * 0.55;
      const posAttr = tearTrail.geometry.getAttribute(
        "position",
      ) as THREE.BufferAttribute;
      for (let i = 0; i < tear.path.length; i++) {
        const p = tear.path[i];
        posAttr.setXYZ(
          i,
          p.x,
          p.y,
          faceZ(p.x, p.y / PACK_H + 0.5) + 0.05,
        );
      }
      posAttr.needsUpdate = true;
      tearTrail.geometry.setDrawRange(0, tear.path.length);
      (tearTrail.material as THREE.LineBasicMaterial).opacity =
        0.35 + tear.progress * 0.65;
    }
    if (tearHeadRef.current) {
      const last = tear.path[tear.path.length - 1];
      tearHeadRef.current.visible = trailVisible && !!last;
      if (last) {
        tearHeadRef.current.position.set(
          last.x,
          last.y,
          faceZ(last.x, last.y / PACK_H + 0.5) + 0.06,
        );
      }
      const s = 0.3 + tear.progress * 0.5 + Math.sin(t * 20) * 0.05;
      tearHeadRef.current.scale.setScalar(s);
    }

    // --- opening timeline ----------------------------------------------------
    if (phase === "opening") {
      const duration = 1.7 + (stackCount - 1) * 0.12;
      a.openT = Math.min(1, a.openT + dt / duration);
      const T = a.openT * (duration / 1.7); // in single-pack time units

      if (packRef.current) {
        packRef.current.rotation.x = THREE.MathUtils.damp(
          packRef.current.rotation.x,
          0,
          6,
          dt,
        );
        packRef.current.rotation.y = THREE.MathUtils.damp(
          packRef.current.rotation.y,
          0,
          6,
          dt,
        );
      }

      // 0 → 0.45 (+stagger per pack): every strip in the stack shears off
      stripRefs.current.forEach((g, i) => {
        if (!g) return;
        const s = easeInCubic(
          THREE.MathUtils.clamp((T - i * 0.07) / 0.45, 0, 1),
        );
        g.position.x = s * 3.4;
        g.position.y = s * 1.6;
        g.rotation.z = -s * 0.9;
        g.visible = s < 1;
      });
      // 0.3 → 0.8 (+stagger): wrapper bodies slide down + fade
      const slide = easeInCubic(THREE.MathUtils.clamp((T - 0.3) / 0.5, 0, 1));
      bodyRefs.current.forEach((g, i) => {
        if (!g) return;
        const s = easeInCubic(
          THREE.MathUtils.clamp((T - 0.3 - i * 0.05) / 0.5, 0, 1),
        );
        // pitched slats mostly dissolve in place — a full slide in their
        // tilted local frame would launch them at the camera
        g.position.y = -s * (i === 0 ? 4.2 : 1.4);
        g.visible = s < 1;
      });
      for (const mat of wrapperMaterials.current) {
        mat.opacity = 1 - slide;
      }
      // 0.45 → 1: cards rise and settle center-stage
      const rise = easeOutCubic(THREE.MathUtils.clamp((T - 0.45) / 0.55, 0, 1));
      if (stackRef.current) {
        stackRef.current.position.y = -0.15 + rise * 0.15;
        stackRef.current.position.z = rise * 0.9;
        const sc = 0.92 + rise * 0.2;
        stackRef.current.scale.setScalar(sc);
      }
      if (T >= 1 && !a.openedNotified) {
        a.openedNotified = true;
        onOpened();
      }
    }

    // --- reveal phase --------------------------------------------------------
    if (phase === "reveal") {
      const idx = a.topIndex;
      const top = idx < cards.length ? cards[idx] : null;
      const isBig = top ? tierRank(top.tier) >= 3 : false;

      // charge-up before big reveals
      if (top && isBig && !a.charge.done) {
        a.charge.t += dt / 1.4;
        if (a.charge.t >= 1) {
          a.charge.done = true;
          onFlash();
        }
      }
      const charging = top && isBig && !a.charge.done;
      if (chargeGlowRef.current) {
        const glowMat = chargeGlowRef.current.material as THREE.SpriteMaterial;
        if (charging) {
          chargeGlowRef.current.visible = true;
          const pulse = a.charge.t * (3 + Math.sin(t * 14) * 0.4) + 1.5;
          chargeGlowRef.current.scale.setScalar(pulse);
          glowMat.opacity = 0.15 + a.charge.t * 0.5;
          glowMat.color.copy(top!.tier === "chase" ? GOLD : glowColor);
        } else {
          glowMat.opacity = THREE.MathUtils.damp(glowMat.opacity, 0, 8, dt);
          if (glowMat.opacity < 0.01) chargeGlowRef.current.visible = false;
        }
      }

      // stack tilt toward pointer
      if (stackRef.current) {
        const shake = charging ? Math.sin(t * 55) * 0.02 * a.charge.t : 0;
        stackRef.current.rotation.y = THREE.MathUtils.damp(
          stackRef.current.rotation.y,
          pointer.x * 0.4,
          5,
          dt,
        );
        stackRef.current.rotation.x = THREE.MathUtils.damp(
          stackRef.current.rotation.x,
          -pointer.y * 0.25,
          5,
          dt,
        );
        stackRef.current.position.x = shake;
      }

      // dismiss animations
      for (const [cardIdx, d] of a.dismiss) {
        const group = cardRefs.current[cardIdx];
        if (!group) continue;
        d.t = Math.min(1, d.t + dt / 0.45);
        const e = easeInCubic(d.t);
        group.position.x = d.dir * e * 5.5;
        group.position.y = e * 1.4;
        group.rotation.z = -d.dir * e * 0.5;
        if (d.t >= 1) {
          group.visible = false;
          a.dismiss.delete(cardIdx);
          if (cardIdx === cards.length - 1 && !a.allNotified) {
            a.allNotified = true;
            onAllRevealed();
          }
        }
      }

      // pop-in scale for the current top card after a big reveal
      const topGroup = cardRefs.current[idx];
      if (topGroup && top) {
        const target = charging ? 0.97 : 1;
        topGroup.scale.setScalar(
          THREE.MathUtils.damp(topGroup.scale.x, target, 6, dt),
        );
      }
    }

    // --- holo + sheen shader uniforms ---------------------------------------
    for (const mat of holoMaterials) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uTilt.value.set(pointer.x, pointer.y);
    }
    sheenMat.uniforms.uTime.value = t;
    sheenMat.uniforms.uOpacity.value = wrapperMaterials.current[0]?.opacity ?? 1;
  });

  const cardsVisible = phase !== "summary" && phase !== "final";

  return (
    <group>
      <FoilEnvironment />
      <ambientLight intensity={0.55} />
      <directionalLight position={[3, 5, 6]} intensity={1.0} />
      <directionalLight position={[-4, -2, 4]} intensity={0.35} color="#8fb7ff" />

      {/* charge glow behind the stack */}
      <sprite ref={chargeGlowRef} position={[0, 0, 0.3]} visible={false}>
        <spriteMaterial
          map={glowTex}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          opacity={0}
        />
      </sprite>

      {/* card stack — mounted only once the pack is actually opening, so
          cards can never poke through the sealed wrapper */}
      {(phase === "opening" || phase === "reveal") && (
        <group
          ref={stackRef}
          position={[0, -0.15, 0]}
          scale={0.92}
          visible={false}
          onPointerDown={handleStackClick}
        >
          {cards.map((card, i) => (
            <group
              key={card.id}
              ref={(g) => {
                cardRefs.current[i] = g;
              }}
              position={[0, 0, -i * 0.012]}
            >
              <mesh>
                <planeGeometry args={[CARD_W, CARD_H]} />
                {/* unlit + untonemapped: card scans render exactly as-is */}
                <meshBasicMaterial
                  map={frontTextures[i]}
                  transparent
                  alphaTest={0.05}
                  toneMapped={false}
                />
              </mesh>
              {holoIntensityFor(card) > 0 && (
                <mesh position={[0, 0, 0.002]} material={holoMaterials[i]}>
                  <planeGeometry args={[CARD_W, CARD_H]} />
                </mesh>
              )}
              <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.003]}>
                <planeGeometry args={[CARD_W, CARD_H]} />
                <meshBasicMaterial map={backTexture} toneMapped={false} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* booster pack stack — bulk opens cascade upward so every pack peeks
          out above the one in front, like the reference app */}
      {cardsVisible && (
        <group ref={packRef} position={[0, packBaseY, 0]}>
          {Array.from({ length: stackCount }).map((_, i) => (
            // pivot at the pack's BOTTOM edge: slats lean back away from the
            // camera, so they can never swing through the front pack
            <group
              key={i}
              position={
                i === 0
                  ? [0, -PACK_H / 2, 0]
                  : [0, 0.85 + (i - 1) * 0.17, -0.3 - (i - 1) * 0.15]
              }
              rotation={i === 0 ? [0, 0, 0] : [-1.05, 0, 0]}
            >
              <group position={[0, PACK_H / 2, 0]}>
              <group
                ref={(g) => {
                  bodyRefs.current[i] = g;
                }}
              >
                <mesh
                  geometry={cutGeos ? cutGeos.bodyF : bodyGeo}
                  renderOrder={5}
                >
                  <FoilMaterial
                    map={wrapperFrontTex}
                    normalMap={normalTex}
                    materialRef={registerWrapperMaterial}
                  />
                </mesh>
                <mesh
                  geometry={cutGeos ? cutGeos.bodyB : bodyGeo}
                  renderOrder={5}
                  rotation={[0, Math.PI, 0]}
                >
                  <FoilMaterial
                    map={wrapperBackTex}
                    normalMap={normalTex}
                    materialRef={registerWrapperMaterial}
                  />
                </mesh>
                {[-1, 1].map((side) => (
                  <mesh
                    key={side}
                    position={[
                      side * (PACK_W / 2 - 0.005),
                      PACK_H * (TEAR_FRAC / 2 - 0.5),
                      0.005,
                    ]}
                    rotation={[0, (side * Math.PI) / 2, 0]}
                    renderOrder={4}
                  >
                    <planeGeometry
                      args={[PACK_T * 1.15, PACK_H * TEAR_FRAC * 0.92]}
                    />
                    <meshPhysicalMaterial
                      ref={registerWrapperMaterial}
                      color={variant.palette.bottom}
                      roughness={0.5}
                      metalness={0.3}
                      transparent
                    />
                  </mesh>
                ))}
                {i === 0 && (
                  <mesh
                    geometry={cutGeos ? cutGeos.bodyF : bodyGeo}
                    renderOrder={6}
                    position={[0, 0, 0.004]}
                    material={sheenMat}
                  />
                )}
                {i === 0 && cutGeos && (
                  <mesh geometry={cutGeos.edgeBody} renderOrder={7}>
                    <meshBasicMaterial
                      ref={edgeBodyMatRef}
                      color="#bffcff"
                      transparent
                      opacity={0}
                      blending={THREE.AdditiveBlending}
                      depthWrite={false}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                )}
              </group>

              <group
                ref={(g) => {
                  stripRefs.current[i] = g;
                }}
              >
                <mesh
                  geometry={cutGeos ? cutGeos.stripF : stripGeo}
                  renderOrder={5}
                >
                  <FoilMaterial
                    map={wrapperFrontTex}
                    normalMap={normalTex}
                    materialRef={registerWrapperMaterial}
                  />
                </mesh>
                <mesh
                  geometry={cutGeos ? cutGeos.stripB : stripGeo}
                  renderOrder={5}
                  rotation={[0, Math.PI, 0]}
                >
                  <FoilMaterial
                    map={wrapperBackTex}
                    normalMap={normalTex}
                    materialRef={registerWrapperMaterial}
                  />
                </mesh>
                {i === 0 && (
                  <mesh
                    geometry={cutGeos ? cutGeos.stripF : stripGeo}
                    renderOrder={6}
                    position={[0, 0, 0.004]}
                    material={sheenMat}
                  />
                )}
                {i === 0 && cutGeos && (
                  <mesh geometry={cutGeos.edgeStrip} renderOrder={7}>
                    <meshBasicMaterial
                      ref={edgeStripMatRef}
                      color="#bffcff"
                      transparent
                      opacity={0}
                      blending={THREE.AdditiveBlending}
                      depthWrite={false}
                      side={THREE.DoubleSide}
                    />
                  </mesh>
                )}
                </group>
              </group>
            </group>
          ))}

          {/* tear hit area + glow feedback */}
          {phase === "tear" && (
            <>
              <mesh
                position={[0, (CUT_MIN + CUT_MAX) / 2, 0.3]}
                onPointerDown={handleTearDown}
                onPointerMove={handleTearMove}
              >
                <planeGeometry args={[PACK_W * 1.5, CUT_MAX - CUT_MIN + 0.5]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              <primitive object={tearTrail} />
              <primitive object={tearTrailPoints} />
              <sprite ref={tearHeadRef} position={[0, TEAR_Y, 0.32]} visible={false}>
                <spriteMaterial
                  map={glowTex}
                  color={accentColor}
                  transparent
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                />
              </sprite>
            </>
          )}
        </group>
      )}
    </group>
  );
}

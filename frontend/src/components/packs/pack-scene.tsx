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

function makeWrapperGeometry(yFrom: number, yTo: number): THREE.PlaneGeometry {
  const height = PACK_H * (yTo - yFrom);
  const geo = new THREE.PlaneGeometry(PACK_W, height, 24, 18);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const vFrac = yFrom + (pos.getY(i) / height + 0.5) * (yTo - yFrom);
    // pillow bulge across the width, pinched flat at the crimped ends
    const crimp = Math.min(1, Math.min(vFrac, 1 - vFrac) / 0.09);
    pos.setZ(i, Math.cos((x / PACK_W) * Math.PI) * 0.2 * crimp + 0.01);
    uv.setY(i, vFrac);
  }
  geo.computeVertexNormals();
  return geo;
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

  // serrated crimp edges: notch triangles out of the very top/bottom
  ctx.globalCompositeOperation = "destination-out";
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
  const fullGeo = useMemo(() => makeWrapperGeometry(0, 1), []);
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
      group.rotation.y = THREE.MathUtils.damp(
        group.rotation.y,
        isHover ? state.pointer.x * 0.4 : Math.sin(t * 0.6 + i) * 0.06,
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
          position={[(i - (PACK_VARIANTS.length - 1) / 2) * 1.85, 0, 0]}
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
        </group>
      ))}
    </group>
  );
}

/* ---------------------------------- scene ----------------------------------- */

// deterministic per-pack jitter so a stack looks hand-piled, not machine-aligned
function stackJitterX(i: number): number {
  return i === 0 ? 0 : Math.sin(i * 12.9898) * 0.06;
}
function stackJitterRot(i: number): number {
  return i === 0 ? 0 : Math.sin(i * 78.233) * 0.03;
}

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

  const bodyGeo = useMemo(() => makeWrapperGeometry(0, TEAR_FRAC), []);
  const stripGeo = useMemo(() => makeWrapperGeometry(TEAR_FRAC, 1), []);

  const holoMaterials = useMemo(
    () => cards.map((card) => makeHoloMaterial(holoIntensityFor(card))),
    [cards],
  );

  const packRef = useRef<THREE.Group>(null);
  const stripRefs = useRef<(THREE.Group | null)[]>([]);
  const bodyRefs = useRef<(THREE.Group | null)[]>([]);
  const stackRef = useRef<THREE.Group>(null);
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const tearLineRef = useRef<THREE.Mesh>(null);
  const tearHeadRef = useRef<THREE.Sprite>(null);
  const chargeGlowRef = useRef<THREE.Sprite>(null);

  const wrapperMaterials = useRef<THREE.MeshPhysicalMaterial[]>([]);

  const anim = useRef({
    torn: false,
    openT: 0,
    openedNotified: false,
    topIndex: 0,
    charge: { t: 0, done: false },
    dismiss: new Map<number, { t: number; dir: number }>(),
    allNotified: false,
    tear: { active: false, startX: 0, dir: 1, progress: 0 },
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

  const handleTearDown = (e: ThreeEvent<PointerEvent>) => {
    if (phase !== "tear") return;
    e.stopPropagation();
    anim.current.tear.active = true;
    anim.current.tear.startX = e.point.x;
  };

  const handleTearMove = (e: ThreeEvent<PointerEvent>) => {
    const tear = anim.current.tear;
    if (phase !== "tear" || !tear.active || anim.current.torn) return;
    const dx = e.point.x - tear.startX;
    if (Math.abs(dx) > 0.01) tear.dir = Math.sign(dx);
    tear.progress = THREE.MathUtils.clamp(Math.abs(dx) / (PACK_W * 0.72), 0, 1);
    if (tear.progress >= 1) {
      anim.current.torn = true;
      tear.active = false;
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

    // --- pack idle float + tilt toward pointer -------------------------------
    if (packRef.current) {
      const pack = packRef.current;
      if (phase === "tear") {
        pack.position.y = Math.sin(t * 1.3) * 0.06;
        pack.rotation.y = THREE.MathUtils.damp(
          pack.rotation.y,
          pointer.x * 0.35,
          4,
          dt,
        );
        pack.rotation.x = THREE.MathUtils.damp(
          pack.rotation.x,
          -pointer.y * 0.2,
          4,
          dt,
        );
      }
    }

    // --- tear feedback -------------------------------------------------------
    const tear = a.tear;
    if (phase === "tear" && !tear.active && !a.torn && tear.progress > 0) {
      tear.progress = Math.max(0, tear.progress - dt * 1.6); // spring back
    }
    const tearSpan = PACK_W * 0.72;
    if (tearLineRef.current) {
      tearLineRef.current.visible = phase === "tear" && tear.progress > 0.01;
      tearLineRef.current.scale.x = Math.max(
        (tear.progress * tearSpan) / PACK_W,
        0.001,
      );
      tearLineRef.current.position.x =
        tear.startX + (tear.dir * tear.progress * tearSpan) / 2;
      const mat = tearLineRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.4 + tear.progress * 0.6;
    }
    if (tearHeadRef.current) {
      tearHeadRef.current.visible = phase === "tear" && tear.progress > 0.01;
      tearHeadRef.current.position.x =
        tear.startX + tear.dir * tear.progress * tearSpan;
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
        g.position.y = -s * 4.2;
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

      {/* card stack (lives "inside" the pack until opened) */}
      {cardsVisible && (
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
                <meshStandardMaterial
                  map={frontTextures[i]}
                  transparent
                  alphaTest={0.05}
                  roughness={0.85}
                  metalness={0}
                  envMapIntensity={0}
                />
              </mesh>
              {holoIntensityFor(card) > 0 && (
                <mesh position={[0, 0, 0.002]} material={holoMaterials[i]}>
                  <planeGeometry args={[CARD_W, CARD_H]} />
                </mesh>
              )}
              <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.003]}>
                <planeGeometry args={[CARD_W, CARD_H]} />
                <meshStandardMaterial
                  map={backTexture}
                  roughness={0.85}
                  envMapIntensity={0}
                />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* booster pack stack — bulk opens pile all packs behind the front one */}
      {cardsVisible && (
        <group ref={packRef}>
          {Array.from({ length: stackCount }).map((_, i) => (
            <group
              key={i}
              position={[stackJitterX(i), 0, -i * 0.5]}
              rotation={[0, 0, stackJitterRot(i)]}
              scale={1 - i * 0.012}
            >
              <group
                ref={(g) => {
                  bodyRefs.current[i] = g;
                }}
              >
                <mesh
                  geometry={bodyGeo}
                  renderOrder={5}
                  position={[0, PACK_H * (TEAR_FRAC / 2 - 0.5), 0]}
                >
                  <FoilMaterial
                    map={wrapperFrontTex}
                    normalMap={normalTex}
                    materialRef={registerWrapperMaterial}
                  />
                </mesh>
                <mesh
                  geometry={bodyGeo}
                  renderOrder={5}
                  position={[0, PACK_H * (TEAR_FRAC / 2 - 0.5), 0]}
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
                    geometry={bodyGeo}
                    renderOrder={6}
                    position={[0, PACK_H * (TEAR_FRAC / 2 - 0.5), 0.004]}
                    material={sheenMat}
                  />
                )}
              </group>

              <group
                ref={(g) => {
                  stripRefs.current[i] = g;
                }}
              >
                <mesh
                  geometry={stripGeo}
                  renderOrder={5}
                  position={[0, PACK_H * ((TEAR_FRAC + 1) / 2 - 0.5), 0]}
                >
                  <FoilMaterial
                    map={wrapperFrontTex}
                    normalMap={normalTex}
                    materialRef={registerWrapperMaterial}
                  />
                </mesh>
                <mesh
                  geometry={stripGeo}
                  renderOrder={5}
                  position={[0, PACK_H * ((TEAR_FRAC + 1) / 2 - 0.5), 0]}
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
                    geometry={stripGeo}
                    renderOrder={6}
                    position={[0, PACK_H * ((TEAR_FRAC + 1) / 2 - 0.5), 0.004]}
                    material={sheenMat}
                  />
                )}
              </group>
            </group>
          ))}

          {/* tear hit area + glow feedback */}
          {phase === "tear" && (
            <>
              <mesh
                position={[0, TEAR_Y, 0.3]}
                onPointerDown={handleTearDown}
                onPointerMove={handleTearMove}
              >
                <planeGeometry args={[PACK_W * 1.5, 0.9]} />
                <meshBasicMaterial transparent opacity={0} depthWrite={false} />
              </mesh>
              <mesh ref={tearLineRef} position={[0, TEAR_Y, 0.26]} visible={false}>
                <planeGeometry args={[PACK_W, 0.05]} />
                <meshBasicMaterial
                  color={accentColor}
                  transparent
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                />
              </mesh>
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

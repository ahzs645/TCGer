"use client";

import { useFrame, useLoader, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { tierRank, type PulledCard } from "./pack-data";

export type PackPhase = "tear" | "opening" | "reveal" | "summary";

export interface PackSceneControls {
  timeScale: number;
}

interface PackExperienceProps {
  cards: PulledCard[];
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

function paintWrapper(front: boolean): THREE.CanvasTexture {
  const w = 512;
  const h = 768;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#101b3f");
  sky.addColorStop(0.45, "#2c2a6e");
  sky.addColorStop(0.75, "#5b2a8c");
  sky.addColorStop(1, "#1b1034");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // aurora streaks
  for (let i = 0; i < 5; i++) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "rgba(64,224,208,0)");
    g.addColorStop(0.5, `rgba(${80 + i * 30},${200 - i * 20},255,0.10)`);
    g.addColorStop(1, "rgba(64,224,208,0)");
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-0.5 + i * 0.22);
    ctx.fillRect(-w, -40 - i * 26, w * 2, 60);
    ctx.restore();
  }

  // sparkles
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const r = Math.random() * 1.6 + 0.3;
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.5 + 0.1})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  if (front) {
    // emblem
    const cy = h * 0.44;
    const emblem = ctx.createRadialGradient(w / 2, cy, 10, w / 2, cy, 150);
    emblem.addColorStop(0, "rgba(255,255,255,0.9)");
    emblem.addColorStop(0.35, "rgba(150,220,255,0.5)");
    emblem.addColorStop(1, "rgba(150,220,255,0)");
    ctx.fillStyle = emblem;
    ctx.beginPath();
    ctx.arc(w / 2, cy, 150, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 92px system-ui, sans-serif";
    ctx.shadowColor = "rgba(120,200,255,0.9)";
    ctx.shadowBlur = 24;
    ctx.fillText("TCGer", w / 2, h * 0.28);
    ctx.shadowBlur = 0;
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillText("DEMO BOOSTER", w / 2, h * 0.62);
    ctx.font = "500 22px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("5 CARDS · EVOLVING SKIES POOL", w / 2, h * 0.9);
  } else {
    ctx.textAlign = "center";
    ctx.font = "600 26px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("TCGer · DEV BUILD", w / 2, h * 0.5);
  }

  // metallic crimp bands top + bottom
  for (const [y0, y1] of [
    [0, h * 0.075],
    [h * 0.925, h],
  ] as const) {
    for (let x = 0; x < w; x += 6) {
      const lum = 120 + Math.sin(x * 0.9) * 60 + Math.random() * 25;
      ctx.fillStyle = `rgb(${lum},${lum},${lum + 12})`;
      ctx.fillRect(x, y0, 6, y1 - y0);
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

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
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

/* ---------------------------------- scene ----------------------------------- */

export function PackExperience({
  cards,
  phase,
  controls,
  onTorn,
  onOpened,
  onReveal,
  onAllRevealed,
  onFlash,
}: PackExperienceProps) {
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

  const wrapperFrontTex = useMemo(() => paintWrapper(true), []);
  const wrapperBackTex = useMemo(() => paintWrapper(false), []);
  const glowTex = useMemo(() => makeGlowTexture(), []);

  const bodyGeo = useMemo(() => makeWrapperGeometry(0, TEAR_FRAC), []);
  const stripGeo = useMemo(() => makeWrapperGeometry(TEAR_FRAC, 1), []);

  const holoMaterials = useMemo(
    () => cards.map((card) => makeHoloMaterial(holoIntensityFor(card))),
    [cards],
  );

  const packRef = useRef<THREE.Group>(null);
  const stripRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const stackRef = useRef<THREE.Group>(null);
  const cardRefs = useRef<(THREE.Group | null)[]>([]);
  const tearLineRef = useRef<THREE.Mesh>(null);
  const tearHeadRef = useRef<THREE.Sprite>(null);
  const chargeGlowRef = useRef<THREE.Sprite>(null);

  const wrapperMaterials = useRef<THREE.MeshStandardMaterial[]>([]);

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

  // detach pointer-up anywhere ends the tear drag
  useEffect(() => {
    const end = () => {
      anim.current.tear.active = false;
    };
    window.addEventListener("pointerup", end);
    return () => window.removeEventListener("pointerup", end);
  }, []);

  const registerWrapperMaterial = (mat: THREE.MeshStandardMaterial | null) => {
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
    tear.progress = THREE.MathUtils.clamp(
      Math.abs(dx) / (PACK_W * 0.72),
      0,
      1,
    );
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
      a.openT = Math.min(1, a.openT + dt / 1.7);
      const T = a.openT;

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

      // 0 → 0.45: strip shears off and flies away
      if (stripRef.current) {
        const s = easeInCubic(Math.min(1, T / 0.45));
        stripRef.current.position.x = s * 3.4;
        stripRef.current.position.y = s * 1.6;
        stripRef.current.rotation.z = -s * 0.9;
        stripRef.current.visible = s < 1;
      }
      // 0.3 → 0.8: wrapper body slides down + fades
      const slide = easeInCubic(
        THREE.MathUtils.clamp((T - 0.3) / 0.5, 0, 1),
      );
      if (bodyRef.current) {
        bodyRef.current.position.y = -slide * 4.2;
        bodyRef.current.visible = slide < 1;
      }
      for (const mat of wrapperMaterials.current) {
        mat.opacity = 1 - slide;
      }
      // 0.45 → 1: cards rise and settle center-stage
      const rise = easeOutCubic(
        THREE.MathUtils.clamp((T - 0.45) / 0.55, 0, 1),
      );
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
          const pulse =
            a.charge.t * (3 + Math.sin(t * 14) * 0.4) + 1.5;
          chargeGlowRef.current.scale.setScalar(pulse);
          glowMat.opacity = 0.15 + a.charge.t * 0.5;
          glowMat.color.setHSL(
            top!.tier === "chase" ? 0.13 : 0.75,
            0.8,
            0.7,
          );
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

    // --- holo shader uniforms ------------------------------------------------
    for (const mat of holoMaterials) {
      mat.uniforms.uTime.value = t;
      mat.uniforms.uTilt.value.set(pointer.x, pointer.y);
    }
  });

  const cardsVisible = phase !== "summary";

  return (
    <group>
      <ambientLight intensity={0.85} />
      <directionalLight position={[3, 5, 6]} intensity={1.4} />
      <directionalLight position={[-4, -2, 4]} intensity={0.4} color="#8fb7ff" />

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
                  roughness={0.4}
                  metalness={0.1}
                />
              </mesh>
              {holoIntensityFor(card) > 0 && (
                <mesh position={[0, 0, 0.002]} material={holoMaterials[i]}>
                  <planeGeometry args={[CARD_W, CARD_H]} />
                </mesh>
              )}
              <mesh rotation={[0, Math.PI, 0]} position={[0, 0, -0.003]}>
                <planeGeometry args={[CARD_W, CARD_H]} />
                <meshStandardMaterial map={backTexture} roughness={0.5} />
              </mesh>
            </group>
          ))}
        </group>
      )}

      {/* booster pack wrapper */}
      {phase !== "summary" && (
        <group ref={packRef}>
          <group ref={bodyRef}>
            <mesh geometry={bodyGeo} renderOrder={5} position={[0, PACK_H * (TEAR_FRAC / 2 - 0.5), 0]}>
              <meshStandardMaterial
                ref={registerWrapperMaterial}
                map={wrapperFrontTex}
                roughness={0.45}
                metalness={0.3}
              />
            </mesh>
            <mesh
              geometry={bodyGeo}
              renderOrder={5}
              position={[0, PACK_H * (TEAR_FRAC / 2 - 0.5), 0]}
              rotation={[0, Math.PI, 0]}
            >
              <meshStandardMaterial
                ref={registerWrapperMaterial}
                map={wrapperBackTex}
                roughness={0.45}
                metalness={0.3}
              />
            </mesh>
          </group>

          <group ref={stripRef}>
            <mesh geometry={stripGeo} renderOrder={5} position={[0, PACK_H * ((TEAR_FRAC + 1) / 2 - 0.5), 0]}>
              <meshStandardMaterial
                map={wrapperFrontTex}
                roughness={0.45}
                metalness={0.3}
              />
            </mesh>
            <mesh
              geometry={stripGeo}
              renderOrder={5}
              position={[0, PACK_H * ((TEAR_FRAC + 1) / 2 - 0.5), 0]}
              rotation={[0, Math.PI, 0]}
            >
              <meshStandardMaterial
                map={wrapperBackTex}
                roughness={0.45}
                metalness={0.3}
              />
            </mesh>
          </group>

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
                  color="#aef1ff"
                  transparent
                  blending={THREE.AdditiveBlending}
                  depthWrite={false}
                />
              </mesh>
              <sprite ref={tearHeadRef} position={[0, TEAR_Y, 0.32]} visible={false}>
                <spriteMaterial
                  map={glowTex}
                  color="#ccf6ff"
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

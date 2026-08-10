"use client";

import { Canvas } from "@react-three/fiber";
import Image from "next/image";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { generatePack, tierRank, type PulledCard } from "./pack-data";
import {
  PackExperience,
  type PackPhase,
  type PackSceneControls,
} from "./pack-scene";

const PHASE_HINTS: Record<PackPhase, string> = {
  tear: "Swipe across the dotted line to tear the pack open",
  opening: "",
  reveal: "Tap the stack to reveal the next card",
  summary: "",
};

const TIER_LABEL_CLASSES: Record<string, string> = {
  common: "text-slate-300",
  uncommon: "text-emerald-300",
  rare: "text-sky-300",
  ultra: "text-violet-300",
  chase: "text-amber-300",
};

export function PackOpening() {
  const [pack, setPack] = useState<PulledCard[] | null>(null);
  const [packKey, setPackKey] = useState(0);
  const [phase, setPhase] = useState<PackPhase>("tear");
  const [revealedCount, setRevealedCount] = useState(0);
  const [flashKey, setFlashKey] = useState(0);
  const [forceChase, setForceChase] = useState(false);
  const [slowMo, setSlowMo] = useState(false);
  const controls = useRef<PackSceneControls>({ timeScale: 1 });

  useEffect(() => {
    setPack(generatePack());
  }, []);

  useEffect(() => {
    controls.current.timeScale = slowMo ? 0.25 : 1;
  }, [slowMo]);

  const reroll = useCallback(
    (chase: boolean) => {
      setPack(generatePack(chase));
      setPackKey((k) => k + 1);
      setPhase("tear");
      setRevealedCount(0);
    },
    [],
  );

  const handleTorn = useCallback(() => setPhase("opening"), []);
  const handleOpened = useCallback(() => {
    setPhase("reveal");
    setRevealedCount(1);
  }, []);
  const handleReveal = useCallback(
    (count: number) => setRevealedCount(count),
    [],
  );
  const handleAllRevealed = useCallback(() => setPhase("summary"), []);
  const handleFlash = useCallback(() => setFlashKey((k) => k + 1), []);

  const revealed = pack ? pack.slice(0, revealedCount) : [];

  return (
    <div className="relative h-[72vh] min-h-[540px] w-full overflow-hidden rounded-xl border border-border bg-[radial-gradient(ellipse_at_center,#1c2340_0%,#0b0e1d_70%)]">
      {pack && phase !== "summary" && (
        <Canvas
          key={packKey}
          camera={{ position: [0, 0, 7], fov: 40 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
        >
          <Suspense fallback={null}>
            <PackExperience
              cards={pack}
              phase={phase}
              controls={controls}
              onTorn={handleTorn}
              onOpened={handleOpened}
              onReveal={handleReveal}
              onAllRevealed={handleAllRevealed}
              onFlash={handleFlash}
            />
          </Suspense>
        </Canvas>
      )}

      {/* reveal flash */}
      {flashKey > 0 && (
        <div
          key={flashKey}
          className="pointer-events-none absolute inset-0 animate-[pack-flash_0.6s_ease-out_forwards] bg-white"
        />
      )}
      <style>{`@keyframes pack-flash { 0% { opacity: 0.9; } 100% { opacity: 0; } }`}</style>

      {/* phase hint */}
      {pack && PHASE_HINTS[phase] && (
        <p className="pointer-events-none absolute inset-x-0 bottom-5 text-center text-sm font-medium text-white/70">
          {PHASE_HINTS[phase]}
        </p>
      )}

      {/* summary */}
      {pack && phase === "summary" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-6">
          <h2 className="text-xl font-heading font-semibold text-white">
            Pack results
          </h2>
          <div className="flex flex-wrap items-start justify-center gap-4">
            {pack.map((card) => (
              <figure key={card.id} className="w-32 text-center sm:w-36">
                <Image
                  src={card.imageUrlSmall}
                  alt={card.name}
                  width={245}
                  height={342}
                  unoptimized
                  className={cn(
                    "w-full rounded-lg shadow-lg",
                    tierRank(card.tier) >= 3 &&
                      "ring-2 ring-amber-300/80 shadow-amber-400/30",
                  )}
                />
                <figcaption className="mt-1.5 text-xs text-white/85">
                  {card.name}
                  <span
                    className={cn(
                      "block text-[10px] uppercase tracking-wide",
                      TIER_LABEL_CLASSES[card.tier],
                    )}
                  >
                    {card.rarity}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
          <button
            type="button"
            onClick={() => reroll(forceChase)}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Open another pack
          </button>
        </div>
      )}

      {/* dev HUD */}
      <div className="absolute right-3 top-3 w-52 space-y-2 rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-[11px] text-white/80 backdrop-blur">
        <p className="flex justify-between">
          <span className="text-white/50">phase</span>
          <span>{phase}</span>
        </p>
        <p className="flex justify-between">
          <span className="text-white/50">revealed</span>
          <span>
            {revealedCount}/{pack?.length ?? 0}
          </span>
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <HudButton onClick={() => reroll(forceChase)}>Reroll</HudButton>
          {phase === "tear" && (
            <HudButton onClick={handleTorn}>Skip tear</HudButton>
          )}
          <HudButton
            active={forceChase}
            onClick={() => setForceChase((v) => !v)}
          >
            Force chase
          </HudButton>
          <HudButton active={slowMo} onClick={() => setSlowMo((v) => !v)}>
            Slow-mo
          </HudButton>
        </div>
        {revealed.length > 0 && phase !== "summary" && (
          <ul className="space-y-0.5 border-t border-white/10 pt-1.5">
            {revealed.map((card) => (
              <li key={card.id} className="flex justify-between gap-2">
                <span className="truncate">{card.name}</span>
                <span className={cn("shrink-0", TIER_LABEL_CLASSES[card.tier])}>
                  {card.tier}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HudButton({
  children,
  onClick,
  active = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded border border-white/15 px-2 py-1 transition hover:bg-white/10",
        active && "border-amber-300/60 bg-amber-300/15 text-amber-200",
      )}
    >
      {children}
    </button>
  );
}

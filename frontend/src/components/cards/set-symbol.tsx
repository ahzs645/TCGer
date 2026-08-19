"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { gamePresentation } from "@/lib/games";
import type { TcgCode } from "@/types/card";

interface SetSymbolProps {
  /** URL to the set expansion symbol image (small icon on cards) */
  symbolUrl?: string;
  /** Raster symbol used if the primary vector symbol cannot be loaded */
  symbolFallbackUrl?: string;
  /** URL to the set logo (larger branding image) */
  logoUrl?: string;
  /** Set code to derive fallback letters from (e.g., 'xy7', 'LOB', 'aer') */
  setCode?: string;
  /** Set name for tooltip / alt text */
  setName?: string;
  /** Which TCG this set belongs to */
  tcg?: TcgCode;
  /** Show the logo instead of the symbol when available */
  variant?: "symbol" | "logo";
  /** Size preset */
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const SIZE_MAP = {
  xs: { icon: 14, label: "text-[8px] px-1 py-0.5 min-w-[20px]" },
  sm: { icon: 18, label: "text-[9px] px-1.5 py-0.5 min-w-[26px]" },
  md: { icon: 24, label: "text-[10px] px-2 py-1 min-w-[32px]" },
  lg: { icon: 32, label: "text-[11px] px-2.5 py-1 min-w-[40px]" },
} as const;

/**
 * Derive a short label from a set code for the fallback display.
 * - Yu-Gi-Oh: extract prefix before the hyphen (e.g., "LOB-001" → "LOB")
 * - Pokemon: uppercase code (e.g., "xy7" → "XY7")
 * - MTG: uppercase code (e.g., "aer" → "AER")
 */
function deriveLabel(setCode?: string, tcg?: TcgCode): string {
  if (!setCode) return "?";

  if (tcg === "yugioh") {
    const prefix = setCode.split("-")[0];
    return prefix.toUpperCase().slice(0, 5);
  }

  return setCode.toUpperCase().slice(0, 5);
}

export function SetSymbol({
  symbolUrl,
  symbolFallbackUrl,
  logoUrl,
  setCode,
  setName,
  tcg,
  variant = "symbol",
  size = "sm",
  className,
}: SetSymbolProps) {
  const imageUrls = useMemo(
    () =>
      Array.from(
        new Set(
          (variant === "logo"
            ? [logoUrl, symbolUrl, symbolFallbackUrl]
            : [symbolUrl, symbolFallbackUrl, logoUrl]
          ).filter((url): url is string => Boolean(url)),
        ),
      ),
    [logoUrl, symbolFallbackUrl, symbolUrl, variant],
  );
  const [imageIndex, setImageIndex] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const imageUrl = imageUrls[imageIndex];

  useEffect(() => {
    setImageIndex(0);
    setImgFailed(false);
    setImgLoaded(false);
  }, [imageUrls]);

  const handleError = useCallback(() => {
    if (imageIndex + 1 < imageUrls.length) {
      setImageIndex((current) => current + 1);
      setImgLoaded(false);
      return;
    }
    setImgFailed(true);
  }, [imageIndex, imageUrls.length]);

  const handleLoad = useCallback(() => {
    setImgLoaded(true);
  }, []);

  const sizeConfig = SIZE_MAP[size];
  const label = deriveLabel(setCode, tcg);
  const title = setName ?? setCode ?? "Unknown set";
  const accent = gamePresentation(tcg).color;
  const fallbackStyle = tcg
    ? {
        color: accent,
        borderColor: `${accent}66`,
        backgroundColor: `${accent}1f`,
      }
    : undefined;

  const showImage = Boolean(imageUrl) && !imgFailed;

  if (showImage) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center relative",
          className,
        )}
        title={title}
        data-oid=":djzosk"
      >
        {/* Show fallback label behind image until it loads */}
        {!imgLoaded && (
          <span
            className={cn(
              "inline-flex items-center justify-center rounded border font-mono font-semibold uppercase leading-none",
              sizeConfig.label,
              !tcg && "border-border bg-muted text-muted-foreground",
            )}
            style={fallbackStyle}
            data-oid="hy-z:jc"
          >
            {label}
          </span>
        )}
        <Image
          key={imageUrl}
          src={imageUrl!}
          alt={title}
          width={sizeConfig.icon}
          height={sizeConfig.icon}
          className={cn(
            "object-contain",
            !imgLoaded && "absolute inset-0 opacity-0",
            imgLoaded && "opacity-100",
          )}
          onError={handleError}
          onLoad={handleLoad}
          unoptimized
          data-oid="g0w0a57"
        />
      </span>
    );
  }

  // Fallback: styled letter label
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded border font-mono font-semibold uppercase leading-none",
        sizeConfig.label,
        !tcg && "border-border bg-muted text-muted-foreground",
        className,
      )}
      style={fallbackStyle}
      title={title}
      data-oid="u3gb8zd"
    >
      {label}
    </span>
  );
}

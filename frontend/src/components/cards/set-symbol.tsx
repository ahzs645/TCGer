'use client';

import Image from 'next/image';
import { useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { TcgCode } from '@/types/card';

interface SetSymbolProps {
  /** URL to the set expansion symbol image (small icon on cards) */
  symbolUrl?: string;
  /** URL to the set logo (larger branding image) */
  logoUrl?: string;
  /** Set code to derive fallback letters from (e.g., 'xy7', 'LOB', 'aer') */
  setCode?: string;
  /** Set name for tooltip / alt text */
  setName?: string;
  /** Which TCG this set belongs to */
  tcg?: TcgCode;
  /** Show the logo instead of the symbol when available */
  variant?: 'symbol' | 'logo';
  /** Size preset */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZE_MAP = {
  xs: { icon: 14, label: 'text-[8px] px-1 py-0.5 min-w-[20px]' },
  sm: { icon: 18, label: 'text-[9px] px-1.5 py-0.5 min-w-[26px]' },
  md: { icon: 24, label: 'text-[10px] px-2 py-1 min-w-[32px]' },
  lg: { icon: 32, label: 'text-[11px] px-2.5 py-1 min-w-[40px]' },
} as const;

const TCG_COLORS: Record<TcgCode, string> = {
  pokemon: 'bg-red-500/15 text-red-700 border-red-300 dark:text-red-400 dark:border-red-700',
  magic: 'bg-amber-500/15 text-amber-700 border-amber-300 dark:text-amber-400 dark:border-amber-700',
  yugioh: 'bg-violet-500/15 text-violet-700 border-violet-300 dark:text-violet-400 dark:border-violet-700',
};

/**
 * Derive a short label from a set code for the fallback display.
 * - Yu-Gi-Oh: extract prefix before the hyphen (e.g., "LOB-001" → "LOB")
 * - Pokemon: uppercase code (e.g., "xy7" → "XY7")
 * - MTG: uppercase code (e.g., "aer" → "AER")
 */
function deriveLabel(setCode?: string, tcg?: TcgCode): string {
  if (!setCode) return '?';

  if (tcg === 'yugioh') {
    const prefix = setCode.split('-')[0];
    return prefix.toUpperCase().slice(0, 5);
  }

  return setCode.toUpperCase().slice(0, 5);
}

export function SetSymbol({
  symbolUrl,
  logoUrl,
  setCode,
  setName,
  tcg,
  variant = 'symbol',
  size = 'sm',
  className,
}: SetSymbolProps) {
  const imageUrl = variant === 'logo' ? (logoUrl ?? symbolUrl) : (symbolUrl ?? logoUrl);
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const handleError = useCallback(() => {
    setImgFailed(true);
  }, []);

  const handleLoad = useCallback(() => {
    setImgLoaded(true);
  }, []);

  const sizeConfig = SIZE_MAP[size];
  const label = deriveLabel(setCode, tcg);
  const title = setName ?? setCode ?? 'Unknown set';
  const colorClass = tcg ? TCG_COLORS[tcg] : 'bg-muted text-muted-foreground border-border';

  const showImage = Boolean(imageUrl) && !imgFailed;

  if (showImage) {
    return (
      <span className={cn('inline-flex items-center justify-center relative', className)} title={title}>
        {/* Show fallback label behind image until it loads */}
        {!imgLoaded && (
          <span
            className={cn(
              'inline-flex items-center justify-center rounded border font-mono font-semibold uppercase leading-none',
              sizeConfig.label,
              colorClass,
            )}
          >
            {label}
          </span>
        )}
        <Image
          src={imageUrl!}
          alt={title}
          width={sizeConfig.icon}
          height={sizeConfig.icon}
          className={cn(
            'object-contain',
            !imgLoaded && 'absolute inset-0 opacity-0',
            imgLoaded && 'opacity-100',
          )}
          onError={handleError}
          onLoad={handleLoad}
          unoptimized
        />
      </span>
    );
  }

  // Fallback: styled letter label
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded border font-mono font-semibold uppercase leading-none',
        sizeConfig.label,
        colorClass,
        className,
      )}
      title={title}
    >
      {label}
    </span>
  );
}

'use client';

import { useState, useRef, useCallback } from 'react';
import Image from 'next/image';
import { Minus, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useModuleStore } from '@/stores/preferences';
import type { Card } from '@/types/card';

interface CardPreviewProps {
  card: Card;
}

export function CardPreview({ card }: CardPreviewProps) {
  const showCardNumbers = useModuleStore((state) => state.showCardNumbers);
  const cardRef = useRef<HTMLDivElement>(null);
  const [throttledPos, setThrottledPos] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [amountOwned, setAmountOwned] = useState(0);

  const throttledSetPos = useRef(
    throttle<[{ x: number; y: number }]>((position) => setThrottledPos(position), 50)
  );

  const updateMousePos = (e: MouseEvent) => {
    throttledSetPos.current({ x: e.clientX, y: e.clientY });
  };

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    window.addEventListener('mousemove', updateMousePos);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    window.removeEventListener('mousemove', updateMousePos);
  }, []);

  let centeredX = 0;
  let centeredY = 0;

  if (cardRef.current && isHovering) {
    const rect = cardRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    centeredX = throttledPos.x - centerX;
    centeredY = throttledPos.y - centerY;
  }

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const rotateY = isHovering ? clamp(centeredX / 4, -10, 10) : 0;
  const rotateX = isHovering ? clamp(-centeredY / 4, -10, 10) : 0;

  const cardStyle = {
    transform: `perspective(1000px) rotateY(${rotateY}deg) rotateX(${rotateX}deg) scale(${isHovering ? 1.04 : 1})`,
    transition: 'transform 0.3s cubic-bezier(0.17, 0.67, 0.5, 1.03)',
    transformStyle: 'preserve-3d' as const,
    opacity: amountOwned > 0 ? 1 : 0.5,
    width: '100%',
    height: 'auto'
  };

  return (
    <div className="group flex flex-col items-center rounded-lg basis-1/5 min-w-0 px-1 sm:px-2">
      <button type="button" className="cursor-pointer w-full">
        <div
          style={{
            flex: '1 0 20%',
            perspective: '1000px',
            transformStyle: 'preserve-3d',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: isHovering ? 10 : 0
          }}
        >
          <div
            ref={cardRef}
            style={{ width: '100%', height: 'auto' }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          >
            {card.imageUrlSmall ? (
              <img
                draggable={false}
                loading="lazy"
                className="card-test"
                alt={card.name}
                src={card.imageUrlSmall}
                style={cardStyle}
              />
            ) : (
              <img
                draggable={false}
                loading="lazy"
                className="card-test"
                alt={card.name}
                src={card.imageUrl}
                style={cardStyle}
              />
            )}
          </div>
        </div>
      </button>
      <div className="w-full min-w-0 pt-2 space-y-1">
        <p className="text-[12px] text-center font-semibold leading-tight break-words">
          {showCardNumbers && (card.setCode || card.id) && (
            <>
              <span className="block md:inline">{card.setCode || card.id}</span>
              <span className="hidden md:inline"> – </span>
            </>
          )}
          <span className="block md:inline break-words">{card.name}</span>
        </p>
        {card.rarity && (
          <div className="flex justify-center">
            <Badge variant="outline" className="text-[10px] h-5">
              {card.rarity}
            </Badge>
          </div>
        )}
        {card.setName && (
          <p className="text-[10px] text-center text-muted-foreground break-words px-1">{card.setName}</p>
        )}
      </div>
      <div className="flex items-center gap-x-1 mt-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAmountOwned(Math.max(0, amountOwned - 1))}
          className="rounded-full h-9 w-9"
          tabIndex={-1}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <input
          min="0"
          max="99"
          className="w-7 text-center border-none rounded"
          type="text"
          value={amountOwned}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!isNaN(val) && val >= 0 && val <= 99) {
              setAmountOwned(val);
            }
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full h-9 w-9"
          onClick={() => setAmountOwned(Math.min(99, amountOwned + 1))}
          tabIndex={-1}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function throttle<T extends unknown[]>(fn: (...args: T) => void, delay: number): (...args: T) => void {
  let lastCall = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: T): void => {
    const now = performance.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall < delay) {
      if (!timeoutId) {
        timeoutId = setTimeout(() => {
          lastCall = performance.now();
          timeoutId = null;
          fn(...args);
        }, delay - timeSinceLastCall);
      }
      return;
    }

    lastCall = now;
    fn(...args);
  };
}

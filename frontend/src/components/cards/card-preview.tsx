'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Check, Loader2, Minus, Plus } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useModuleStore } from '@/stores/preferences';
import { useCollectionsStore } from '@/stores/collections';
import { useAuthStore } from '@/stores/auth';
import type { Card } from '@/types/card';
import { normalizeHexColor } from '@/lib/color';

interface CardPreviewProps {
  card: Card;
}

export function CardPreview({ card }: CardPreviewProps) {
  const showCardNumbers = useModuleStore((state) => state.showCardNumbers);
  const cardRef = useRef<HTMLDivElement>(null);
  const [throttledPos, setThrottledPos] = useState({ x: 0, y: 0 });
  const [isHovering, setIsHovering] = useState(false);
  const [amountOwned, setAmountOwned] = useState(1);
  const { token, isAuthenticated } = useAuthStore();
  const { collections, addCardToBinder, isLoading: collectionsLoading, hasFetched } = useCollectionsStore((state) => ({
    collections: state.collections,
    addCardToBinder: state.addCardToBinder,
    isLoading: state.isLoading,
    hasFetched: state.hasFetched
  }));
  const isSignedIn = isAuthenticated && Boolean(token);
  const [selectedBinderId, setSelectedBinderId] = useState<string>(collections[0]?.id ?? '');
  const [status, setStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const selectedBinder = collections.find((binder) => binder.id === selectedBinderId);
  const selectedAccent = normalizeHexColor(selectedBinder?.colorHex);

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

  useEffect(() => {
    if (!collections.length) {
      setSelectedBinderId('');
      return;
    }

    if (!selectedBinderId || !collections.some((binder) => binder.id === selectedBinderId)) {
      setSelectedBinderId(collections[0].id);
    }
  }, [collections, selectedBinderId]);

  const handleAddToBinder = async () => {
    if (!isSignedIn) {
      setStatus('error');
      setStatusMessage('Sign in to add cards to a binder.');
      return;
    }

    if (!selectedBinderId) {
      setStatus('error');
      setStatusMessage('Create a binder first.');
      return;
    }

    const quantity = Math.max(1, Number.isFinite(amountOwned) ? amountOwned : 1);
    setStatus('pending');
    setStatusMessage(null);

    try {
      await addCardToBinder(token, selectedBinderId, {
        cardId: card.id,
        quantity,
        cardData: {
          name: card.name,
          tcg: card.tcg,
          externalId: card.id,
          setCode: card.setCode,
          setName: card.setName,
          rarity: card.rarity,
          imageUrl: card.imageUrl,
          imageUrlSmall: card.imageUrlSmall
        }
      });
      setAmountOwned(1);
      setStatus('success');
      setTimeout(() => {
        setStatus('idle');
      }, 2000);
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'Unable to add card to binder.');
    }
  };

  const addDisabled = !selectedBinderId || status === 'pending' || collectionsLoading;
  const showEmptyBindersMessage = hasFetched && collections.length === 0;

  return (
    <div className="group flex min-w-0 basis-1/5 flex-col items-center rounded-lg px-1 sm:px-2">
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
      <div className="mt-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAmountOwned(Math.max(1, amountOwned - 1))}
          className="rounded-full h-9 w-9"
          tabIndex={-1}
        >
          <Minus className="h-4 w-4" />
        </Button>
        <input
          min="1"
          max="99"
          className="w-9 text-center border-none rounded"
          type="text"
          value={amountOwned}
          onChange={(e) => {
            const val = parseInt(e.target.value, 10);
            if (!Number.isNaN(val) && val >= 1 && val <= 99) {
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
      <div className="mt-3 w-full space-y-1 text-xs">
        {collections.length ? (
          <>
            <div className="flex items-center gap-2">
              <Select
                value={selectedBinderId || undefined}
                onValueChange={setSelectedBinderId}
                disabled={collectionsLoading || status === 'pending'}
              >
                <SelectTrigger className="h-8 flex-1 justify-between gap-2 text-left text-xs">
                  <div className="flex items-center gap-2">
                    {selectedAccent ? (
                      <span
                        className="inline-flex h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: selectedAccent }}
                        aria-hidden="true"
                      />
                    ) : null}
                    <SelectValue placeholder="Select a binder" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {collections.map((binder) => {
                    const accent = normalizeHexColor(binder.colorHex);
                    return (
                      <SelectItem key={binder.id} value={binder.id}>
                        <span className="flex items-center gap-2">
                          {accent ? (
                            <span
                              className="inline-flex h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: accent }}
                              aria-hidden="true"
                            />
                          ) : null}
                          {binder.name}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button className="shrink-0 gap-1" size="sm" onClick={handleAddToBinder} disabled={addDisabled}>
                {status === 'pending' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : status === 'success' ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                <span>{status === 'success' ? 'Added' : 'Add'}</span>
              </Button>
            </div>
          </>
        ) : (
          <p className="text-center text-muted-foreground">
            {!isSignedIn
              ? 'Sign in to add cards to your binders.'
              : showEmptyBindersMessage
                ? 'Create a binder from the collection page to start adding cards.'
                : 'Loading binders...'}
          </p>
        )}
        {status === 'error' && statusMessage ? (
          <p className="text-center text-destructive">{statusMessage}</p>
        ) : null}
        {status === 'success' && !statusMessage ? (
          <p className="text-center text-emerald-600">Card added!</p>
        ) : null}
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

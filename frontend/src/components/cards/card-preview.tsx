import Image from 'next/image';
import { Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card as UiCard, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GAME_LABELS } from '@/lib/utils';
import type { Card } from '@/types/card';

interface CardPreviewProps {
  card: Card;
}

export function CardPreview({ card }: CardPreviewProps) {
  return (
    <UiCard className="flex h-full flex-col">
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{GAME_LABELS[card.tcg]}</span>
          {card.rarity && <Badge variant="outline">{card.rarity}</Badge>}
        </div>
        <CardTitle className="text-base font-semibold leading-tight">{card.name}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {card.setName ?? 'Unknown Set'} {card.setCode ? `• ${card.setCode}` : ''}
        </p>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="relative h-48 w-full overflow-hidden rounded-md border bg-muted/20">
          {card.imageUrlSmall ? (
            <Image
              src={card.imageUrlSmall}
              alt={card.name}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Sparkles className="h-10 w-10" />
            </div>
          )}
        </div>
        <div className="space-y-2 text-xs text-muted-foreground">
          {card.attributes && Object.keys(card.attributes).length > 0 ? (
            <div className="grid gap-1">
              {Object.entries(card.attributes)
                .slice(0, 4)
                .map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="font-medium capitalize">{formatKey(key)}</span>
                    <span>{String(value)}</span>
                  </div>
                ))}
            </div>
          ) : (
            <p>No additional attributes recorded.</p>
          )}
        </div>
        <Button variant="outline" size="sm" className="mt-auto">
          Add to collection
        </Button>
      </CardContent>
    </UiCard>
  );
}

function formatKey(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

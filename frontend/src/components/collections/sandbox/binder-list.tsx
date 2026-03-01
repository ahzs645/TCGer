'use client';

import { Button } from '@/components/ui/button';
import type { Collection } from '@/lib/api/collections';

interface BinderListProps {
  binders: Collection[];
  activeBinderId: string;
  onSelectBinder: (binderId: string) => void;
  onAddBinder?: () => void;
  onEditBinder?: (binderId: string) => void;
  onEditBinderColor?: (binderId: string) => void;
}

export function BinderList({ binders, activeBinderId, onSelectBinder, onAddBinder, onEditBinder, onEditBinderColor }: BinderListProps) {
  const totals = binders.reduce(
    (acc, binder) => {
      acc.rows += binder.cards.length;
      acc.copies += binder.cards.reduce((sum, card) => sum + (card.copies?.length ?? card.quantity ?? 0), 0);
      return acc;
    },
    { rows: 0, copies: 0 }
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Binders</p>
          <p className="text-xs text-muted-foreground">Switch between binder scopes or jump into All binders.</p>
        </div>
        <Button size="sm" variant="outline" type="button" onClick={onAddBinder} disabled={!onAddBinder}>
          + Add binder
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        <button
          className="rounded-lg border-2 bg-card px-3 py-3 text-left transition-all hover:border-primary/40 hover:bg-muted/50"
          style={activeBinderId === 'all' ? { borderColor: 'var(--primary)', borderWidth: '2px' } : undefined}
          onClick={() => onSelectBinder('all')}
        >
          <div className="space-y-2">
            <p className="text-sm font-medium">All binders</p>
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold text-foreground">{totals.copies} copies</p>
              <p>{totals.rows} unique</p>
            </div>
          </div>
        </button>

        {binders.map((binder) => {
          const isActive = binder.id === activeBinderId;
          // Ensure color has # prefix
          const normalizedColor = binder.colorHex ? (binder.colorHex.startsWith('#') ? binder.colorHex : `#${binder.colorHex}`) : '#9CA3AF';
          const borderColor = isActive ? normalizedColor : 'transparent';
          const displayColor = normalizedColor;
          return (
            <div
              key={binder.id}
              className="rounded-lg border-2 bg-card px-3 py-3 cursor-pointer transition-all hover:bg-muted/50 group relative"
              style={{ borderColor }}
              onClick={() => onSelectBinder(binder.id)}
            >
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex h-3 w-3 rounded-full shrink-0 border border-gray-300"
                    style={{ backgroundColor: displayColor }}
                  />
                  <p className="text-sm font-medium truncate">{binder.name}</p>
                </div>
                <div className="text-xs text-muted-foreground">
                  <p className="font-semibold text-foreground">
                    {binder.cards.reduce((sum, card) => sum + (card.copies?.length ?? card.quantity ?? 0), 0)} copies
                  </p>
                  <p>{binder.cards.length} unique</p>
                </div>
              </div>
              <div className="mt-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="h-6 px-2 text-[10px] rounded hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditBinder?.(binder.id);
                  }}
                  disabled={!onEditBinder}
                >
                  Edit
                </button>
                <button
                  className="h-6 px-2 text-[10px] rounded hover:bg-muted"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditBinderColor?.(binder.id);
                  }}
                  disabled={!onEditBinderColor}
                >
                  Color
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

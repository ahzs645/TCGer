'use client';

import { ChevronDown, Palette, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import type { Collection } from '@/lib/api/collections';

interface BinderListProps {
  binders: Collection[];
  activeBinderId: string;
  onSelectBinder: (binderId: string) => void;
  onAddBinder?: () => void;
  onEditBinder?: (binderId: string) => void;
  onEditBinderColor?: (binderId: string) => void;
}

function normalizeColor(hex?: string) {
  if (!hex) return '#9CA3AF';
  return hex.startsWith('#') ? hex : `#${hex}`;
}

function binderCopyCount(binder: Collection) {
  return binder.cards.reduce((sum, card) => sum + (card.copies?.length ?? card.quantity ?? 0), 0);
}

export function BinderList({ binders, activeBinderId, onSelectBinder, onAddBinder, onEditBinder, onEditBinderColor }: BinderListProps) {
  const totals = binders.reduce(
    (acc, binder) => {
      acc.rows += binder.cards.length;
      acc.copies += binderCopyCount(binder);
      return acc;
    },
    { rows: 0, copies: 0 }
  );

  const activeBinder = binders.find((b) => b.id === activeBinderId);
  const activeLabel = activeBinderId === 'all' ? 'All binders' : activeBinder?.name ?? 'Select binder';
  const activeColor = activeBinderId === 'all' ? undefined : normalizeColor(activeBinder?.colorHex);
  const activeCount = activeBinderId === 'all'
    ? `${totals.copies} copies · ${totals.rows} unique`
    : activeBinder
      ? `${binderCopyCount(activeBinder)} copies · ${activeBinder.cards.length} unique`
      : '';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Binder</p>
          <p className="text-xs text-muted-foreground hidden sm:block">Switch between binder scopes or jump into All binders.</p>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full justify-between gap-2 h-auto py-2">
            <div className="flex items-center gap-2 min-w-0">
              {activeColor && (
                <span
                  className="inline-flex h-3 w-3 rounded-full shrink-0 border border-gray-300 dark:border-gray-600"
                  style={{ backgroundColor: activeColor }}
                />
              )}
              <div className="text-left min-w-0">
                <p className="text-sm font-medium truncate">{activeLabel}</p>
                <p className="text-xs text-muted-foreground font-normal">{activeCount}</p>
              </div>
            </div>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)] max-h-80 overflow-y-auto">
          <DropdownMenuLabel>Binders</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem
              className="flex items-center justify-between gap-2"
              onSelect={() => onSelectBinder('all')}
            >
              <span className="font-medium">All binders</span>
              <span className="text-xs text-muted-foreground">{totals.copies}</span>
            </DropdownMenuItem>
            {binders.map((binder) => {
              const color = normalizeColor(binder.colorHex);
              const copies = binderCopyCount(binder);
              return (
                <DropdownMenuItem
                  key={binder.id}
                  className="flex items-center gap-2 group/item"
                  onSelect={() => onSelectBinder(binder.id)}
                >
                  <span
                    className="inline-flex h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1 truncate">{binder.name}</span>
                  <div className="flex items-center gap-1">
                    {onEditBinder && (
                      <button
                        className="h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted hidden group-focus/item:flex group-hover/item:flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBinder(binder.id);
                        }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    {onEditBinderColor && (
                      <button
                        className="h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted hidden group-focus/item:flex group-hover/item:flex"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBinderColor(binder.id);
                        }}
                      >
                        <Palette className="h-3 w-3" />
                      </button>
                    )}
                    <span className="text-xs text-muted-foreground tabular-nums">{copies}</span>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
          {onAddBinder && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onAddBinder} className="gap-2">
                <Plus className="h-3.5 w-3.5" />
                Add binder
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

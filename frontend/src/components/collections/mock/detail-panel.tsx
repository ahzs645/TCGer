'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ChevronDown, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { CONDITION_COPY, CONDITION_ORDER, conditionRangeLabel, formatCurrency } from './mock-helpers';
import type { Collection, CollectionCard, CollectionCardCopy, CollectionTag } from '@/lib/api/collections';
import { TagCombobox } from './tag-combobox';
import { useModuleStore } from '@/stores/preferences';

const GAME_LABELS: Record<string, string> = {
  magic: 'Magic: The Gathering',
  yugioh: 'Yu-Gi-Oh!',
  pokemon: 'Pokémon'
};

interface MockDetailPanelProps {
  card: CollectionCard | null;
  selectedCopy: CollectionCardCopy | null;
  availableTags: CollectionTag[];
  draftCopyTags: string[];
  onToggleTag: (tagId: string) => void;
  onCreateTag: (label: string) => Promise<CollectionTag>;
  binderOptions: { id: string; name: string; colorHex?: string }[];
  draftBinderId: string;
  draftCondition: (typeof CONDITION_ORDER)[number];
  draftNotes: string;
  onBinderChange: (binderId: string) => void;
  onConditionChange: (condition: (typeof CONDITION_ORDER)[number]) => void;
  onNotesChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
  onMove: () => void;
  moveStatus: 'idle' | 'pending' | 'success' | 'error';
  moveError: string | null;
  status: 'idle' | 'saving' | 'success' | 'error';
  errorMessage: string | null;
  onSelectPrint?: () => void;
  printSelectionLabel?: string;
  printSelectionDisabled?: boolean;
}

export function MockDetailPanel({
  card,
  selectedCopy,
  availableTags,
  draftCopyTags,
  onToggleTag,
  onCreateTag,
  binderOptions,
  draftBinderId,
  draftCondition,
  draftNotes,
  onBinderChange,
  onConditionChange,
  onNotesChange,
  onSave,
  onReset,
  onMove,
  moveStatus,
  moveError,
  status,
  errorMessage,
  onSelectPrint,
  printSelectionLabel,
  printSelectionDisabled
}: MockDetailPanelProps) {
  const [isImageOpen, setIsImageOpen] = useState(false);
  const showCardNumbers = useModuleStore((state) => state.showCardNumbers);
  const showPricing = useModuleStore((state) => state.showPricing);
  const supportsPrintSelection = card ? ['magic', 'pokemon'].includes(card.tcg) : false;

  if (!card) {
    return (
      <Card className="sticky top-4 h-fit">
        <CardHeader>
          <CardTitle>Select a card</CardTitle>
          <CardDescription>Choose a row from the table to preview binder details and edit metadata.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="sticky top-4 h-fit">
      <CardHeader className="space-y-4">
        <div className="flex gap-4">
          <div className="w-36 shrink-0">
            {card.imageUrl ? (
              <Button
                variant="ghost"
                className="w-full overflow-hidden rounded-lg border-2 bg-muted p-0 h-auto cursor-zoom-in"
                style={{ borderColor: card.binderColorHex ? (card.binderColorHex.startsWith('#') ? card.binderColorHex : `#${card.binderColorHex}`) : 'var(--border)' }}
                onClick={() => setIsImageOpen(true)}
              >
                <Image
                  src={card.imageUrl}
                  alt={card.name}
                  width={240}
                  height={340}
                  className="w-full"
                  style={{ height: 'auto', objectFit: 'contain' }}
                />
              </Button>
            ) : (
              <div className="flex h-40 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground">
                No image
              </div>
            )}
          </div>
          <div className="space-y-2">
            <CardTitle>{card.name}</CardTitle>
            {showCardNumbers && (card.setName || card.setCode) && (
              <p className="text-sm text-muted-foreground">
                {card.setName ?? card.setCode}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div>
                <p className="uppercase">Binder</p>
                <p className="text-sm font-medium text-foreground">{card.binderName ?? 'Unsorted'}</p>
              </div>
              <div>
                <p className="uppercase">Game</p>
                <p className="text-sm font-medium text-foreground">{GAME_LABELS[card.tcg]}</p>
              </div>
              <div>
                <p className="uppercase">Rarity</p>
                <p className="text-sm font-medium text-foreground">{card.rarity ?? 'Unknown'}</p>
              </div>
              <div>
                <p className="uppercase">Quantity</p>
                <p className="text-sm font-medium text-foreground">{card.copies.length}</p>
              </div>
              <div>
                <p className="uppercase">Condition</p>
                <p className="text-sm font-medium text-foreground">{conditionRangeLabel(card.copies)}</p>
              </div>
              {showPricing && (
                <div>
                  <p className="uppercase">Est. value</p>
                  <p className="text-sm font-medium text-foreground">{formatCurrency(card.price)}</p>
                </div>
              )}
            </div>
          </div>
        </div>
        {supportsPrintSelection && onSelectPrint ? (
          <div className="space-y-1">
            <Label className="text-xs font-medium text-muted-foreground">Print</Label>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-between"
              onClick={onSelectPrint}
              disabled={printSelectionDisabled || !selectedCopy}
            >
              <span className="truncate">{printSelectionLabel || 'Select a print'}</span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Button>
            <p className="text-[11px] text-muted-foreground">
              {selectedCopy ? 'Updates the printing for this copy only.' : 'Select a copy to change its print.'}
            </p>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {selectedCopy ? (
          <>
            <div className="space-y-2">
              <Label>Binder assignment</Label>
              <Select value={draftBinderId} onValueChange={onBinderChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select binder" />
                </SelectTrigger>
                <SelectContent>
                  {binderOptions.map((binder) => (
                    <SelectItem key={binder.id} value={binder.id}>
                      {binder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Button variant="secondary" className="w-full" onClick={onMove} disabled={moveStatus === 'pending'}>
                {moveStatus === 'pending' ? 'Moving…' : 'Move card'}
              </Button>
              {moveStatus === 'success' && <p className="text-xs text-emerald-600">Copy moved successfully.</p>}
              {moveStatus === 'error' && <p className="text-xs text-destructive">{moveError ?? 'Unable to move copy.'}</p>}
            </div>
            <div className="space-y-2">
              <Label>Condition</Label>
              <Select value={draftCondition} onValueChange={(value) => onConditionChange(value as (typeof CONDITION_ORDER)[number])}>
                <SelectTrigger>
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_ORDER.map((condition) => (
                    <SelectItem key={condition} value={condition}>
                      {CONDITION_COPY[condition].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={draftNotes}
                onChange={(event) => onNotesChange(event.target.value)}
                rows={4}
                placeholder="Add personal notes (sleeves, grading plans, etc.)"
              />
            </div>
            <div className="space-y-2">
              <Label>Tags</Label>
              <TagCombobox
                availableTags={availableTags}
                selectedTags={draftCopyTags}
                onToggleTag={onToggleTag}
                onCreateTag={onCreateTag}
              />
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={onSave}>
                {status === 'saving' ? 'Saving…' : 'Save changes'}
              </Button>
              <Button variant="ghost" className="flex-1" onClick={onReset}>
                Reset
              </Button>
            </div>
            {status === 'success' && <p className="text-xs text-emerald-600">Copy updated successfully.</p>}
            {status === 'error' && <p className="text-xs text-destructive">{errorMessage ?? 'Failed to update copy.'}</p>}
          </>
        ) : (
          <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-sm text-muted-foreground">
            Select a specific copy from the table to edit binder assignment, condition, notes, or tags.
          </div>
        )}
      </CardContent>

      <Dialog open={isImageOpen} onOpenChange={setIsImageOpen}>
        <DialogPortal>
          <DialogOverlay className="backdrop-blur-lg bg-transparent" />
          <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95">
            <VisuallyHidden>
              <DialogTitle>{card.name} - Card Image</DialogTitle>
              <DialogDescription>Full size view of {card.name}</DialogDescription>
            </VisuallyHidden>
            <div className="relative inline-block">
              {card.imageUrl && (
                <Image
                  src={card.imageUrl}
                  alt={card.name}
                  width={600}
                  height={840}
                  className="max-h-[85vh] w-auto object-contain rounded-lg shadow-2xl"
                  priority
                />
              )}
              <button
                onClick={() => setIsImageOpen(false)}
                className="absolute right-2 top-2 bg-black/50 text-white rounded-full p-2 hover:bg-black/70 transition-colors z-10"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </Card>
  );
}

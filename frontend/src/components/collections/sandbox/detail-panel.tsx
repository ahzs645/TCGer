"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  CONDITION_COPY,
  CONDITION_ORDER,
  conditionRangeLabel,
  formatCurrency,
} from "./helpers";
import type {
  CollectionCard,
  CollectionCardCopy,
  CollectionTag,
} from "@/lib/api/collections";
import { TagCombobox } from "./tag-combobox";
import { useModuleStore } from "@/stores/preferences";

const GAME_LABELS: Record<string, string> = {
  magic: "Magic: The Gathering",
  yugioh: "Yu-Gi-Oh!",
  pokemon: "Pokémon",
};

export interface DetailPanelProps {
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
  moveStatus: "idle" | "pending" | "success" | "error";
  moveError: string | null;
  status: "idle" | "saving" | "success" | "error";
  errorMessage: string | null;
  onSelectPrint?: () => void;
  printSelectionLabel?: string;
  printSelectionDisabled?: boolean;
  onClose?: () => void;
  open?: boolean;
}

/** Compact card header for the mobile drawer */
function CompactCardHeader({ card }: { card: CollectionCard }) {
  const showPricing = useModuleStore((state) => state.showPricing);
  const borderColor = card.binderColorHex
    ? card.binderColorHex.startsWith("#")
      ? card.binderColorHex
      : `#${card.binderColorHex}`
    : "var(--border)";

  return (
    <div className="flex gap-3 items-start" data-oid="eookq90">
      <div className="w-16 shrink-0" data-oid="4ifie:3">
        {card.imageUrl ? (
          <Image
            src={card.imageUrl}
            alt={card.name}
            width={64}
            height={90}
            className="w-full rounded-md border-2 object-contain"
            style={{ borderColor, height: "auto" }}
            data-oid="6qh0:3e"
          />
        ) : (
          <div
            className="flex h-20 items-center justify-center rounded-md border-2 bg-muted text-[10px] text-muted-foreground"
            style={{ borderColor }}
            data-oid="gtu02q7"
          >
            No image
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0" data-oid="8vhirt4">
        <p
          className="font-semibold text-sm leading-tight truncate"
          data-oid="4.yccb9"
        >
          {card.name}
        </p>
        <p
          className="text-xs text-muted-foreground truncate"
          data-oid="fd4v1q7"
        >
          {card.binderName ?? "Unsorted"}
        </p>
        <div
          className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground"
          data-oid="32k-92e"
        >
          <span data-oid="w6l50im">{card.rarity ?? "N/A"}</span>
          <span data-oid="-tlo0_8">
            {card.copies.length} {card.copies.length === 1 ? "copy" : "copies"}
          </span>
          <span data-oid="59v_pmi">{conditionRangeLabel(card.copies)}</span>
          {showPricing && (
            <span data-oid="5z8z:qm">{formatCurrency(card.price)}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Full card header for the desktop sidebar */
function FullCardHeader({
  card,
  onImageClick,
}: {
  card: CollectionCard;
  onImageClick: () => void;
}) {
  const showCardNumbers = useModuleStore((state) => state.showCardNumbers);
  const showPricing = useModuleStore((state) => state.showPricing);
  const borderColor = card.binderColorHex
    ? card.binderColorHex.startsWith("#")
      ? card.binderColorHex
      : `#${card.binderColorHex}`
    : "var(--border)";

  return (
    <div className="flex min-w-0 gap-3" data-oid="fvz26-.">
      <div className="w-28 shrink-0" data-oid="69tz9p0">
        {card.imageUrl ? (
          <Button
            variant="ghost"
            className="w-full overflow-hidden rounded-lg border-2 bg-muted p-0 h-auto cursor-zoom-in"
            style={{ borderColor }}
            onClick={onImageClick}
            data-oid="rbta55d"
          >
            <Image
              src={card.imageUrl}
              alt={card.name}
              width={240}
              height={340}
              className="w-full"
              style={{ height: "auto", objectFit: "contain" }}
              data-oid="od5w73e"
            />
          </Button>
        ) : (
          <div
            className="flex h-40 items-center justify-center rounded-lg border bg-muted text-xs text-muted-foreground"
            data-oid="_21b_bz"
          >
            No image
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2" data-oid="ekm:rxa">
        <CardTitle className="line-clamp-2" data-oid="fh82emd">
          {card.name}
        </CardTitle>
        {showCardNumbers && (card.setName || card.setCode) && (
          <p
            className="truncate text-sm text-muted-foreground"
            data-oid="gza1fbl"
          >
            {card.setName ?? card.setCode}
          </p>
        )}
        <div
          className="grid grid-cols-2 gap-2 text-xs text-muted-foreground"
          data-oid="uftg8pr"
        >
          <div className="min-w-0" data-oid="aefq.pn">
            <p className="uppercase" data-oid="e8m7h7y">
              Binder
            </p>
            <p
              className="break-words text-sm font-medium leading-snug text-foreground"
              data-oid=".kskdez"
            >
              {card.binderName ?? "Unsorted"}
            </p>
          </div>
          <div className="min-w-0" data-oid="84m0mgx">
            <p className="uppercase" data-oid="v-s-0xp">
              Game
            </p>
            <p
              className="break-words text-sm font-medium leading-snug text-foreground"
              data-oid="_yl__x8"
            >
              {GAME_LABELS[card.tcg]}
            </p>
          </div>
          <div className="min-w-0" data-oid=".dz8lzr">
            <p className="uppercase" data-oid="oqsxa6e">
              Rarity
            </p>
            <p
              className="break-words text-sm font-medium leading-snug text-foreground"
              data-oid="ffcvvnt"
            >
              {card.rarity ?? "Unknown"}
            </p>
          </div>
          <div className="min-w-0" data-oid="hykxsus">
            <p className="uppercase" data-oid="po7n6ks">
              Quantity
            </p>
            <p
              className="break-words text-sm font-medium leading-snug text-foreground"
              data-oid="j2_j.c:"
            >
              {card.copies.length}
            </p>
          </div>
          <div className="min-w-0" data-oid="z_mcpz:">
            <p className="uppercase" data-oid="rq81mv7">
              Condition
            </p>
            <p
              className="break-words text-sm font-medium leading-snug text-foreground"
              data-oid="rl0x.d7"
            >
              {conditionRangeLabel(card.copies)}
            </p>
          </div>
          {showPricing && (
            <div className="min-w-0" data-oid="4:gg-8f">
              <p className="uppercase" data-oid="0wofrfd">
                Est. value
              </p>
              <p
                className="break-words text-sm font-medium leading-snug text-foreground"
                data-oid="o6_px99"
              >
                {formatCurrency(card.price)}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Print selection button (shared) */
function PrintSelection({
  card,
  selectedCopy,
  onSelectPrint,
  printSelectionLabel,
  printSelectionDisabled,
}: {
  card: CollectionCard;
  selectedCopy: CollectionCardCopy | null;
  onSelectPrint?: () => void;
  printSelectionLabel?: string;
  printSelectionDisabled?: boolean;
}) {
  const supportsPrintSelection = ["magic", "pokemon"].includes(card.tcg);
  if (!supportsPrintSelection || !onSelectPrint) return null;

  return (
    <div className="space-y-1" data-oid="grqiyj0">
      <Label
        className="text-xs font-medium text-muted-foreground"
        data-oid="puje7_b"
      >
        Print
      </Label>
      <Button
        type="button"
        variant="outline"
        className="w-full justify-between"
        onClick={onSelectPrint}
        disabled={printSelectionDisabled || !selectedCopy}
        data-oid="rotqxi:"
      >
        <span className="truncate" data-oid="4ex_jxf">
          {printSelectionLabel || "Select a print"}
        </span>
        <ChevronDown
          className="h-4 w-4 shrink-0 text-muted-foreground"
          data-oid="8k1ii97"
        />
      </Button>
      <p className="text-[11px] text-muted-foreground" data-oid="6qc1.b3">
        {selectedCopy
          ? "Updates the printing for this copy only."
          : "Select a copy to change its print."}
      </p>
    </div>
  );
}

/** Shared edit form for both desktop and mobile */
function EditForm({
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
  compact = false,
}: {
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
  moveStatus: "idle" | "pending" | "success" | "error";
  moveError: string | null;
  status: "idle" | "saving" | "success" | "error";
  errorMessage: string | null;
  compact?: boolean;
}) {
  if (!selectedCopy) {
    return (
      <div
        className="rounded-lg border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground"
        data-oid="7lav:vu"
      >
        Select a specific copy to edit binder, condition, notes, or tags.
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"} data-oid="m5bxbj:">
      {compact ? (
        /* Mobile compact: binder + condition side by side */
        <>
          <div className="grid grid-cols-2 gap-3" data-oid="w:box.q">
            <div className="space-y-1.5" data-oid="xd:.z4:">
              <Label className="text-xs" data-oid="fz.5oaq">
                Binder
              </Label>
              <Select
                value={draftBinderId}
                onValueChange={onBinderChange}
                data-oid="bdrkta_"
              >
                <SelectTrigger className="h-9" data-oid="9-zy3lj">
                  <SelectValue placeholder="Select binder" data-oid="7p:vkwr" />
                </SelectTrigger>
                <SelectContent data-oid="3cs8geb">
                  {binderOptions.map((binder) => (
                    <SelectItem
                      key={binder.id}
                      value={binder.id}
                      data-oid="gjysuma"
                    >
                      {binder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5" data-oid="h8h76lj">
              <Label className="text-xs" data-oid="wm0rjyu">
                Condition
              </Label>
              <Select
                value={draftCondition}
                onValueChange={(value) =>
                  onConditionChange(value as (typeof CONDITION_ORDER)[number])
                }
                data-oid="4b6qmgy"
              >
                <SelectTrigger className="h-9" data-oid="ci6vo6m">
                  <SelectValue placeholder="Condition" data-oid="ydgz9o8" />
                </SelectTrigger>
                <SelectContent data-oid="gf-k95.">
                  {CONDITION_ORDER.map((condition) => (
                    <SelectItem
                      key={condition}
                      value={condition}
                      data-oid="g0ejgjx"
                    >
                      {CONDITION_COPY[condition].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="w-full"
            onClick={onMove}
            disabled={moveStatus === "pending"}
            data-oid="p_k0n0a"
          >
            {moveStatus === "pending" ? "Moving…" : "Move card"}
          </Button>
          {moveStatus === "success" && (
            <p className="text-xs text-emerald-600" data-oid="4wbch7f">
              Moved.
            </p>
          )}
          {moveStatus === "error" && (
            <p className="text-xs text-destructive" data-oid="l2m7eqn">
              {moveError ?? "Unable to move."}
            </p>
          )}
          <div className="space-y-1.5" data-oid="yay6-h.">
            <Label className="text-xs" data-oid="c7n8:03">
              Notes
            </Label>
            <Textarea
              value={draftNotes}
              onChange={(event) => onNotesChange(event.target.value)}
              rows={2}
              placeholder="Notes (sleeves, grading, etc.)"
              className="text-sm"
              data-oid="rwuafw1"
            />
          </div>
          <div className="space-y-1.5" data-oid="vb8y6uw">
            <Label className="text-xs" data-oid="vaoyyyk">
              Tags
            </Label>
            <TagCombobox
              availableTags={availableTags}
              selectedTags={draftCopyTags}
              onToggleTag={onToggleTag}
              onCreateTag={onCreateTag}
              data-oid="toib4pj"
            />
          </div>
          <div className="flex gap-2" data-oid="w7m_qlj">
            <Button
              size="sm"
              className="flex-1"
              onClick={onSave}
              data-oid="4cgrtxt"
            >
              {status === "saving" ? "Saving…" : "Save"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="flex-1"
              onClick={onReset}
              data-oid="23n8skq"
            >
              Reset
            </Button>
          </div>
          {status === "success" && (
            <p className="text-xs text-emerald-600" data-oid="pc66joe">
              Updated.
            </p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive" data-oid="o1jzju_">
              {errorMessage ?? "Failed."}
            </p>
          )}
        </>
      ) : (
        /* Desktop: full layout */
        <>
          <div className="space-y-2" data-oid="oqpp:-n">
            <Label data-oid="p.niri7">Binder assignment</Label>
            <Select
              value={draftBinderId}
              onValueChange={onBinderChange}
              data-oid=":pa0y.9"
            >
              <SelectTrigger data-oid="92qjheg">
                <SelectValue placeholder="Select binder" data-oid="z3hrl2q" />
              </SelectTrigger>
              <SelectContent data-oid="0xz7kwq">
                {binderOptions.map((binder) => (
                  <SelectItem
                    key={binder.id}
                    value={binder.id}
                    data-oid="rwtztoz"
                  >
                    {binder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1" data-oid="kjwpazt">
            <Button
              variant="secondary"
              className="w-full"
              onClick={onMove}
              disabled={moveStatus === "pending"}
              data-oid=":m1fsk0"
            >
              {moveStatus === "pending" ? "Moving…" : "Move card"}
            </Button>
            {moveStatus === "success" && (
              <p className="text-xs text-emerald-600" data-oid="z57kld:">
                Copy moved successfully.
              </p>
            )}
            {moveStatus === "error" && (
              <p className="text-xs text-destructive" data-oid="9_vwicq">
                {moveError ?? "Unable to move copy."}
              </p>
            )}
          </div>
          <div className="space-y-2" data-oid="9c0ryt6">
            <Label data-oid="tgzb3os">Condition</Label>
            <Select
              value={draftCondition}
              onValueChange={(value) =>
                onConditionChange(value as (typeof CONDITION_ORDER)[number])
              }
              data-oid="l54cpoc"
            >
              <SelectTrigger data-oid="mvahvyi">
                <SelectValue
                  placeholder="Select condition"
                  data-oid="gh-qtg:"
                />
              </SelectTrigger>
              <SelectContent data-oid="zvcg1f0">
                {CONDITION_ORDER.map((condition) => (
                  <SelectItem
                    key={condition}
                    value={condition}
                    data-oid=".fbpj_d"
                  >
                    {CONDITION_COPY[condition].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2" data-oid="nhu.vox">
            <Label data-oid="igsimji">Notes</Label>
            <Textarea
              value={draftNotes}
              onChange={(event) => onNotesChange(event.target.value)}
              rows={4}
              placeholder="Add personal notes (sleeves, grading plans, etc.)"
              data-oid="emb685u"
            />
          </div>
          <div className="space-y-2" data-oid="01uopxy">
            <Label data-oid="m3oneet">Tags</Label>
            <TagCombobox
              availableTags={availableTags}
              selectedTags={draftCopyTags}
              onToggleTag={onToggleTag}
              onCreateTag={onCreateTag}
              data-oid="wqhqj3t"
            />
          </div>
          <div className="flex gap-2" data-oid="px7x9kj">
            <Button className="flex-1" onClick={onSave} data-oid="kb85y.v">
              {status === "saving" ? "Saving…" : "Save changes"}
            </Button>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={onReset}
              data-oid="-v2zsft"
            >
              Reset
            </Button>
          </div>
          {status === "success" && (
            <p className="text-xs text-emerald-600" data-oid="0-efsow">
              Copy updated successfully.
            </p>
          )}
          {status === "error" && (
            <p className="text-xs text-destructive" data-oid="nx8qiaf">
              {errorMessage ?? "Failed to update copy."}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Desktop sidebar detail panel — unchanged behavior, hidden on mobile */
export function DetailPanel(props: DetailPanelProps) {
  const {
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
    printSelectionDisabled,
  } = props;

  const [isImageOpen, setIsImageOpen] = useState(false);

  if (!card) {
    return (
      <Card className="sticky top-4 h-fit hidden lg:block" data-oid="st0.bso">
        <CardHeader data-oid="gc_4ffw">
          <CardTitle data-oid="nkhr4j-">Select a card</CardTitle>
          <CardDescription data-oid="l61::wi">
            Choose a row from the table to preview binder details and edit
            metadata.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="sticky top-4 h-fit hidden lg:block" data-oid="p60mzkx">
      <CardHeader className="space-y-4" data-oid="irmhzf3">
        <FullCardHeader
          card={card}
          onImageClick={() => setIsImageOpen(true)}
          data-oid="_wiiac_"
        />
        <PrintSelection
          card={card}
          selectedCopy={selectedCopy}
          onSelectPrint={onSelectPrint}
          printSelectionLabel={printSelectionLabel}
          printSelectionDisabled={printSelectionDisabled}
          data-oid="yhtsmuh"
        />
      </CardHeader>
      <CardContent data-oid="-fqyxis">
        <EditForm
          selectedCopy={selectedCopy}
          availableTags={availableTags}
          draftCopyTags={draftCopyTags}
          onToggleTag={onToggleTag}
          onCreateTag={onCreateTag}
          binderOptions={binderOptions}
          draftBinderId={draftBinderId}
          draftCondition={draftCondition}
          draftNotes={draftNotes}
          onBinderChange={onBinderChange}
          onConditionChange={onConditionChange}
          onNotesChange={onNotesChange}
          onSave={onSave}
          onReset={onReset}
          onMove={onMove}
          moveStatus={moveStatus}
          moveError={moveError}
          status={status}
          errorMessage={errorMessage}
          data-oid="vz3s8yo"
        />
      </CardContent>

      <Dialog
        open={isImageOpen}
        onOpenChange={setIsImageOpen}
        data-oid="-f2ydgi"
      >
        <DialogPortal data-oid="2re9x7.">
          <DialogOverlay
            className="backdrop-blur-lg bg-transparent"
            data-oid="o_6.4_2"
          />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            data-oid="fp0qm4c"
          >
            <VisuallyHidden data-oid="t0-1y_u">
              <DialogTitle data-oid="szp_b06">
                {card.name} - Card Image
              </DialogTitle>
              <DialogDescription data-oid="156a23s">
                Full size view of {card.name}
              </DialogDescription>
            </VisuallyHidden>
            <div className="relative inline-block" data-oid=":.d27f.">
              {card.imageUrl && (
                <Image
                  src={card.imageUrl}
                  alt={card.name}
                  width={600}
                  height={840}
                  className="max-h-[85vh] w-auto object-contain rounded-lg shadow-2xl"
                  priority
                  data-oid="mv.a_2e"
                />
              )}
              <button
                onClick={() => setIsImageOpen(false)}
                className="absolute right-2 top-2 bg-black/50 text-white rounded-full p-2 hover:bg-black/70 transition-colors z-10"
                data-oid="g:.-z7_"
              >
                <X className="h-4 w-4" data-oid="rlwgzdl" />
                <span className="sr-only" data-oid="p1yw94k">
                  Close
                </span>
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPortal>
      </Dialog>
    </Card>
  );
}

/** Returns true when viewport is below the lg breakpoint (1024px) */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1023px)");
    setIsMobile(mql.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return isMobile;
}

/** Mobile bottom-sheet detail panel — only opens below lg breakpoint */
export function MobileDetailDrawer(props: DetailPanelProps) {
  const {
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
    printSelectionDisabled,
    onClose,
    open: openProp,
  } = props;

  const isMobile = useIsMobile();
  const isOpen = isMobile && (openProp ?? false);

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
      data-oid="78yndmb"
    >
      <DrawerContent className="max-h-[85vh]" data-oid="8-yl.z:">
        <VisuallyHidden data-oid="67mnufd">
          <DrawerTitle data-oid="s969-q:">
            {card?.name ?? "Card details"}
          </DrawerTitle>
          <DrawerDescription data-oid="a1fjxzc">
            Edit card details
          </DrawerDescription>
        </VisuallyHidden>
        {card && (
          <div
            className="overflow-y-auto px-4 pb-6 pt-2 space-y-4"
            data-oid="p:gkjvo"
          >
            <CompactCardHeader card={card} data-oid="-cwqbog" />
            <PrintSelection
              card={card}
              selectedCopy={selectedCopy}
              onSelectPrint={onSelectPrint}
              printSelectionLabel={printSelectionLabel}
              printSelectionDisabled={printSelectionDisabled}
              data-oid="eju_4_-"
            />

            <EditForm
              selectedCopy={selectedCopy}
              availableTags={availableTags}
              draftCopyTags={draftCopyTags}
              onToggleTag={onToggleTag}
              onCreateTag={onCreateTag}
              binderOptions={binderOptions}
              draftBinderId={draftBinderId}
              draftCondition={draftCondition}
              draftNotes={draftNotes}
              onBinderChange={onBinderChange}
              onConditionChange={onConditionChange}
              onNotesChange={onNotesChange}
              onSave={onSave}
              onReset={onReset}
              onMove={onMove}
              moveStatus={moveStatus}
              moveError={moveError}
              status={status}
              errorMessage={errorMessage}
              compact
              data-oid="8fh8i_a"
            />
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}

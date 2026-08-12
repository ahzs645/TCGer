"use client";

import { useMemo, useState } from "react";
import { FolderSearch, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CollectionCard } from "@/lib/api/collections";
import { SMART_FOLDER_STORAGE_KEY_PREFIX } from "@/lib/storage/keys";

export type SmartFolderRuleType =
  | "tcg"
  | "rarity"
  | "condition"
  | "setCode"
  | "isFoil";

export interface SmartFolderRule {
  id: string;
  type: SmartFolderRuleType;
  value: string;
}

export interface SmartFolder {
  id: string;
  name: string;
  colorHex: string;
  matchMode: "all" | "any";
  rules: SmartFolderRule[];
}

const RULE_LABELS: Record<SmartFolderRuleType, string> = {
  tcg: "TCG game",
  rarity: "Rarity",
  condition: "Condition",
  setCode: "Set code",
  isFoil: "Foil only",
};

/** A fresh demo should show what automatic folders do before the visitor builds one. */
const DEMO_SMART_FOLDERS: SmartFolder[] = [
  {
    id: "demo-smart-folder-pokemon",
    name: "Pokémon chase cards",
    colorHex: "#ef4444",
    matchMode: "any",
    rules: [
      { id: "demo-rule-pokemon", type: "tcg", value: "pokemon" },
      { id: "demo-rule-ultra-rare", type: "rarity", value: "Ultra Rare" },
    ],
  },
  {
    id: "demo-smart-folder-foil",
    name: "Foils",
    colorHex: "#8b5cf6",
    matchMode: "all",
    rules: [{ id: "demo-rule-foil", type: "isFoil", value: "true" }],
  },
];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function smartFolderStorageKey(userId?: string | null) {
  return `${SMART_FOLDER_STORAGE_KEY_PREFIX}${userId || "local"}`;
}

export function loadSmartFolders(userId?: string | null): SmartFolder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(smartFolderStorageKey(userId));
    if (raw === null && userId === "demo-user-001") {
      return DEMO_SMART_FOLDERS.map((folder) => ({
        ...folder,
        rules: folder.rules.map((rule) => ({ ...rule })),
      }));
    }
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? (parsed as SmartFolder[]) : [];
  } catch {
    return [];
  }
}

function persistSmartFolders(
  userId: string | null | undefined,
  folders: SmartFolder[],
) {
  localStorage.setItem(smartFolderStorageKey(userId), JSON.stringify(folders));
}

export function matchesSmartFolder(card: CollectionCard, folder: SmartFolder) {
  const matchesRule = (rule: SmartFolderRule) => {
    const value = rule.value.trim().toLowerCase();
    switch (rule.type) {
      case "tcg":
        return card.tcg.toLowerCase() === value;
      case "rarity":
        return card.rarity?.toLowerCase() === value;
      case "condition":
        return card.copies.some(
          (copy) => copy.condition?.toLowerCase() === value,
        );
      case "setCode":
        return card.setCode?.toLowerCase() === value;
      case "isFoil":
        return card.copies.some(
          (copy) => copy.isFoil || Boolean(copy.finishCode),
        );
    }
  };
  if (!folder.rules.length) return true;
  return folder.matchMode === "all"
    ? folder.rules.every(matchesRule)
    : folder.rules.some(matchesRule);
}

interface SmartFolderManagerProps {
  userId?: string | null;
  cards: CollectionCard[];
  folders: SmartFolder[];
  activeFolderId: string | null;
  onFoldersChange: (folders: SmartFolder[]) => void;
  onSelect: (folderId: string | null) => void;
}

export function SmartFolderManager({
  userId,
  cards,
  folders,
  activeFolderId,
  onFoldersChange,
  onSelect,
}: SmartFolderManagerProps) {
  const [editing, setEditing] = useState<SmartFolder | null>(null);
  const [open, setOpen] = useState(false);
  const active = folders.find((folder) => folder.id === activeFolderId) ?? null;
  const countById = useMemo(
    () =>
      new Map(
        folders.map((folder) => [
          folder.id,
          cards.filter((card) => matchesSmartFolder(card, folder)).length,
        ]),
      ),
    [cards, folders],
  );

  const commit = (folder: SmartFolder) => {
    const next = folders.some((candidate) => candidate.id === folder.id)
      ? folders.map((candidate) =>
          candidate.id === folder.id ? folder : candidate,
        )
      : [...folders, folder];
    onFoldersChange(next);
    persistSmartFolders(userId, next);
    onSelect(folder.id);
    setOpen(false);
  };

  const remove = () => {
    if (!editing) return;
    const next = folders.filter((folder) => folder.id !== editing.id);
    onFoldersChange(next);
    persistSmartFolders(userId, next);
    if (activeFolderId === editing.id) onSelect(null);
    setOpen(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Smart folder</p>
          <p className="text-xs text-muted-foreground">
            Reusable, automatic collection filters.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="mr-1 h-4 w-4" /> New
        </Button>
      </div>
      <div className="flex gap-2">
        <Select
          value={activeFolderId ?? "__none__"}
          onValueChange={(value) =>
            onSelect(value === "__none__" ? null : value)
          }
        >
          <SelectTrigger className="min-w-0 flex-1">
            <SelectValue placeholder="Choose a smart folder" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No smart folder</SelectItem>
            {folders.map((folder) => (
              <SelectItem key={folder.id} value={folder.id}>
                {folder.name} ({countById.get(folder.id) ?? 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {active ? (
          <Button
            variant="outline"
            size="icon"
            aria-label={`Edit ${active.name}`}
            onClick={() => {
              setEditing(active);
              setOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {active ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: active.colorHex }}
          />
          <FolderSearch className="h-3.5 w-3.5" />
          {active.rules.length} rule{active.rules.length === 1 ? "" : "s"} ·
          match {active.matchMode}
        </div>
      ) : null}
      <SmartFolderEditor
        key={`${editing?.id ?? "new"}-${open ? "open" : "closed"}`}
        open={open}
        folder={editing}
        onOpenChange={setOpen}
        onSave={commit}
        onDelete={editing ? remove : undefined}
      />
    </div>
  );
}

function SmartFolderEditor({
  open,
  folder,
  onOpenChange,
  onSave,
  onDelete,
}: {
  open: boolean;
  folder: SmartFolder | null;
  onOpenChange: (open: boolean) => void;
  onSave: (folder: SmartFolder) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<SmartFolder>(
    () => folder ?? emptyFolder(),
  );
  const addRule = () =>
    setDraft((current) => ({
      ...current,
      rules: [...current.rules, { id: newId(), type: "tcg", value: "pokemon" }],
    }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {folder ? "Edit smart folder" : "New smart folder"}
          </DialogTitle>
          <DialogDescription>
            Cards are included automatically when they match these rules.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-[1fr_7rem] gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                placeholder="Graded Pokémon"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Color</Label>
              <Input
                type="color"
                value={draft.colorHex}
                onChange={(event) =>
                  setDraft({ ...draft, colorHex: event.target.value })
                }
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Match mode</Label>
            <Select
              value={draft.matchMode}
              onValueChange={(value) =>
                setDraft({ ...draft, matchMode: value as "all" | "any" })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All rules</SelectItem>
                <SelectItem value="any">Any rule</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Rules</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRule}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add rule
              </Button>
            </div>
            {draft.rules.map((rule) => (
              <div
                key={rule.id}
                className="grid grid-cols-[9rem_1fr_auto] gap-2 rounded-lg border p-2"
              >
                <Select
                  value={rule.type}
                  onValueChange={(type) =>
                    setDraft({
                      ...draft,
                      rules: draft.rules.map((candidate) =>
                        candidate.id === rule.id
                          ? {
                              ...candidate,
                              type: type as SmartFolderRuleType,
                              value:
                                type === "isFoil" ? "true" : candidate.value,
                            }
                          : candidate,
                      ),
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(RULE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {rule.type === "isFoil" ? (
                  <div className="flex items-center rounded-md border px-3 text-sm text-muted-foreground">
                    Foil cards only
                  </div>
                ) : (
                  <Input
                    value={rule.value}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        rules: draft.rules.map((candidate) =>
                          candidate.id === rule.id
                            ? { ...candidate, value: event.target.value }
                            : candidate,
                        ),
                      })
                    }
                    placeholder={RULE_LABELS[rule.type]}
                  />
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Remove rule"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      rules: draft.rules.filter(
                        (candidate) => candidate.id !== rule.id,
                      ),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {!draft.rules.length ? (
              <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                Add at least one rule.
              </p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {onDelete ? (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !draft.name.trim() ||
                !draft.rules.length ||
                draft.rules.some(
                  (rule) => rule.type !== "isFoil" && !rule.value.trim(),
                )
              }
              onClick={() => onSave({ ...draft, name: draft.name.trim() })}
            >
              Save folder
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function emptyFolder(): SmartFolder {
  return {
    id: newId(),
    name: "",
    colorHex: "#6366F1",
    matchMode: "all",
    rules: [],
  };
}

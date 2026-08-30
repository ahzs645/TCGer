"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Box,
  LayoutGrid,
  Lock,
  LockOpen,
  Plus,
  Rows3,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  createStorageCompartment,
  createStorageContainer,
  getStorageContainers,
  placeStorageCopy,
  removeStoragePlacement,
  updateStorageCompartment,
  updateStorageContainer,
  type StorageContainer,
  type StoragePlacement,
  type UnsortedStorageCopy,
} from "@/lib/api/collection-operations";
import { useAuthStore } from "@/stores/auth";
import { useCollectionsStore } from "@/stores/collections";
import { StorageAuditDialog } from "./storage-audit-dialog";

type Selection =
  | { type: "unsorted"; item: UnsortedStorageCopy }
  | { type: "placement"; item: StoragePlacement }
  | null;

export function StorageEditor() {
  const token = useAuthStore((state) => state.token);
  const collections = useCollectionsStore((state) => state.collections);
  const queryClient = useQueryClient();
  const [activeContainerId, setActiveContainerId] = useState<string | null>(
    null,
  );
  const [activeCompartmentId, setActiveCompartmentId] = useState<string | null>(
    null,
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const containersQuery = useQuery({
    queryKey: ["storage", "containers"],
    queryFn: () => getStorageContainers(token!),
    enabled: !!token,
  });
  const containers = containersQuery.data ?? [];
  const activeContainer =
    containers.find((item) => item.id === activeContainerId) ?? containers[0];
  const activeCompartment =
    activeContainer?.compartments.find(
      (item) => item.id === activeCompartmentId,
    ) ?? activeContainer?.compartments[0];
  const entryDetails = useMemo(
    () =>
      new Map(
        collections.flatMap((binder) =>
          binder.cards.flatMap((card) =>
            card.copies.map(
              (copy) =>
                [
                  copy.id,
                  {
                    collectionEntryId: copy.id,
                    binderId: binder.id,
                    cardId: card.cardId,
                    name: card.name,
                    printedName: (
                      card as typeof card & { printedName?: string }
                    ).printedName,
                    setCode: card.setCode,
                    collectorNumber: card.collectorNumber,
                    imageUrl: card.imageUrlSmall ?? card.imageUrl,
                    availableQuantity: 1,
                  },
                ] as const,
            ),
          ),
        ),
      ),
    [collections],
  );
  const placedIds = useMemo(
    () =>
      new Set(
        containers.flatMap((container) =>
          container.compartments.flatMap((compartment) =>
            compartment.placements.map(
              (placement) => placement.collectionEntryId,
            ),
          ),
        ),
      ),
    [containers],
  );
  const unsorted = useMemo(
    () =>
      Array.from(entryDetails.values()).filter(
        (item) => !placedIds.has(item.collectionEntryId),
      ),
    [entryDetails, placedIds],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["storage", "containers"],
    });
  };
  const placeMutation = useMutation({
    mutationFn: async (slotIndex: number) => {
      if (!selection || !activeCompartment) return;
      if (selection.type === "unsorted") {
        return placeStorageCopy(token!, {
          collectionEntryId: selection.item.collectionEntryId,
          quantity: 1,
          compartmentId: activeCompartment.id,
          slotIndex,
          allowDuplicateStacking: true,
        });
      }
      const origin = containers
        .flatMap((container) => container.compartments)
        .find((compartment) =>
          compartment.placements.some((item) => item.id === selection.item.id),
        );
      await removeStoragePlacement(token!, selection.item.id);
      try {
        return await placeStorageCopy(token!, {
          collectionEntryId: selection.item.collectionEntryId,
          quantity: selection.item.quantity,
          compartmentId: activeCompartment.id,
          slotIndex,
          allowDuplicateStacking: true,
        });
      } catch (error) {
        if (origin) {
          await placeStorageCopy(token!, {
            collectionEntryId: selection.item.collectionEntryId,
            quantity: selection.item.quantity,
            compartmentId: origin.id,
            slotIndex: selection.item.slotIndex,
            allowDuplicateStacking: true,
          }).catch(() => undefined);
        }
        throw error;
      }
    },
    onSuccess: async () => {
      setSelection(null);
      setNotice("Storage location saved.");
      await refresh();
    },
    onError: (error) => setNotice((error as Error).message),
  });
  const containerMutation = useMutation({
    mutationFn: ({
      containerId,
      input,
    }: {
      containerId: string;
      input: { order?: number; locked?: boolean };
    }) => updateStorageContainer(token!, containerId, input),
    onSuccess: refresh,
    onError: (error) => setNotice((error as Error).message),
  });
  const compartmentMutation = useMutation({
    mutationFn: ({
      compartmentId,
      input,
    }: {
      compartmentId: string;
      input: { order?: number; pageNumber?: number; locked?: boolean };
    }) => updateStorageCompartment(token!, compartmentId, input),
    onSuccess: refresh,
    onError: (error) => setNotice((error as Error).message),
  });

  const moveContainer = (direction: -1 | 1) => {
    if (!activeContainer) return;
    const ordered = [...containers].sort(
      (left, right) => left.order - right.order,
    );
    const index = ordered.findIndex((item) => item.id === activeContainer.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    containerMutation.mutate({
      containerId: activeContainer.id,
      input: { order: swap.order },
    });
    containerMutation.mutate({
      containerId: swap.id,
      input: { order: activeContainer.order },
    });
  };
  const moveCompartment = (direction: -1 | 1) => {
    if (!activeCompartment || !activeContainer) return;
    const ordered = [...activeContainer.compartments].sort(
      (left, right) => left.order - right.order,
    );
    const index = ordered.findIndex((item) => item.id === activeCompartment.id);
    const swap = ordered[index + direction];
    if (!swap) return;
    compartmentMutation.mutate({
      compartmentId: activeCompartment.id,
      input: { order: swap.order, pageNumber: swap.pageNumber },
    });
    compartmentMutation.mutate({
      compartmentId: swap.id,
      input: {
        order: activeCompartment.order,
        pageNumber: activeCompartment.pageNumber,
      },
    });
  };
  if (!token) {
    return <EmptyMessage title="Sign in to organize physical storage" />;
  }
  if (containersQuery.isLoading) {
    return <EmptyMessage title="Loading your storage…" />;
  }
  if (containersQuery.error) {
    return (
      <EmptyMessage
        title="Storage could not be loaded"
        detail={String(containersQuery.error as Error)}
      />
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[17rem_minmax(0,1fr)_19rem]">
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-base">Storage</CardTitle>
            <NewContainerDialog token={token} onCreated={refresh} />
          </div>
          <CardDescription>
            Binders and boxes in physical order.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {containers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create a binder or box to start assigning exact locations.
            </p>
          ) : (
            containers.map((container) => (
              <button
                key={container.id}
                type="button"
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  activeContainer?.id === container.id
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => {
                  setActiveContainerId(container.id);
                  setActiveCompartmentId(container.compartments[0]?.id ?? null);
                  setSelection(null);
                }}
              >
                {container.kind === "binder" ? (
                  <Rows3 className="h-4 w-4" />
                ) : (
                  <Box className="h-4 w-4" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {container.name}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {container.compartments.length}{" "}
                    {container.kind === "binder" ? "pages" : "rows"}
                  </span>
                </span>
                {container.locked && <Lock className="h-3.5 w-3.5" />}
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader className="pb-3">
          {activeContainer && activeCompartment ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>{activeContainer.name}</CardTitle>
                  <CardDescription>
                    Select an unsorted card or occupied slot, then choose its
                    destination.
                  </CardDescription>
                </div>
                <div className="flex gap-1">
                  <StorageAuditDialog key={activeCompartment.id} token={token} container={activeContainer} compartment={activeCompartment} entries={entryDetails} />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move storage earlier"
                    onClick={() => moveContainer(-1)}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Move storage later"
                    onClick={() => moveContainer(1)}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={containerMutation.isPending}
                    onClick={() =>
                      containerMutation.mutate({
                        containerId: activeContainer.id,
                        input: { locked: !activeContainer.locked },
                      })
                    }
                  >
                    {activeContainer.locked ? (
                      <LockOpen className="mr-2 h-4 w-4" />
                    ) : (
                      <Lock className="mr-2 h-4 w-4" />
                    )}
                    {activeContainer.locked ? "Unlock" : "Lock"}
                  </Button>
                </div>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 pt-2">
                {activeContainer.compartments.map((compartment) => (
                  <Button
                    key={compartment.id}
                    size="sm"
                    variant={
                      activeCompartment.id === compartment.id
                        ? "default"
                        : "outline"
                    }
                    onClick={() => {
                      setActiveCompartmentId(compartment.id);
                      setSelection(null);
                    }}
                  >
                    {compartment.label}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <CardTitle>Create your first storage container</CardTitle>
          )}
        </CardHeader>
        {activeContainer && activeCompartment && (
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/20 p-3 text-sm">
              <span>Duplicate copies can stack in the same slot.</span>
              {activeCompartment.locked && (
                <Badge variant="secondary">
                  <Lock className="mr-2 h-3.5 w-3.5" />
                  Page locked
                </Badge>
              )}
              <Badge variant="outline">
                {activeCompartment.placements.reduce(
                  (sum, item) => sum + item.quantity,
                  0,
                )}{" "}
                / {activeCompartment.capacity}
              </Badge>
              <div className="ml-auto flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move page earlier"
                  disabled={activeContainer.locked}
                  onClick={() => moveCompartment(-1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move page later"
                  disabled={activeContainer.locked}
                  onClick={() => moveCompartment(1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    activeContainer.locked || compartmentMutation.isPending
                  }
                  onClick={() =>
                    compartmentMutation.mutate({
                      compartmentId: activeCompartment.id,
                      input: { locked: !activeCompartment.locked },
                    })
                  }
                >
                  {activeCompartment.locked ? (
                    <LockOpen className="mr-2 h-4 w-4" />
                  ) : (
                    <Lock className="mr-2 h-4 w-4" />
                  )}
                  {activeCompartment.locked ? "Unlock page" : "Lock page"}
                </Button>
              </div>
            </div>
            {selection && (
              <p
                className="rounded-md border border-primary/30 bg-primary/5 p-2 text-sm"
                role="status"
              >
                Moving{" "}
                <strong>
                  {selection.type === "unsorted"
                    ? (selection.item.printedName ?? selection.item.name)
                    : (entryDetails.get(selection.item.collectionEntryId)
                        ?.printedName ??
                      entryDetails.get(selection.item.collectionEntryId)
                        ?.name ??
                      "card")}
                </strong>
                . Choose a slot, or press Escape to cancel.
              </p>
            )}
            <SlotGrid
              compartment={activeCompartment}
              disabled={
                activeContainer.locked ||
                activeCompartment.locked ||
                placeMutation.isPending
              }
              selection={selection}
              entryDetails={entryDetails}
              onSelectPlacement={(item) =>
                setSelection({ type: "placement", item })
              }
              onPlace={(slot) => placeMutation.mutate(slot)}
              onCancel={() => setSelection(null)}
            />
            {notice && (
              <p className="text-sm text-muted-foreground" role="status">
                {notice}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <Card className="h-fit xl:sticky xl:top-20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Unsorted</CardTitle>
          <CardDescription>
            Copies that still need a physical home.
          </CardDescription>
        </CardHeader>
        <CardContent className="max-h-[34rem] space-y-2 overflow-y-auto">
          {unsorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Everything is filed.
            </p>
          ) : (
            unsorted.map((item) => (
              <button
                key={item.collectionEntryId}
                type="button"
                className={`w-full rounded-lg border p-3 text-left ${
                  selection?.type === "unsorted" &&
                  selection.item.collectionEntryId === item.collectionEntryId
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
                onClick={() => setSelection({ type: "unsorted", item })}
              >
                <span className="block truncate text-sm font-medium">
                  {item.printedName ?? item.name}
                </span>
                {item.printedName && item.printedName !== item.name && (
                  <span className="block truncate text-xs text-muted-foreground">
                    Canonical: {item.name}
                  </span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {[
                    item.setCode,
                    item.collectorNumber && `#${item.collectorNumber}`,
                    `${item.availableQuantity} available`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SlotGrid({
  compartment,
  disabled,
  selection,
  entryDetails,
  onSelectPlacement,
  onPlace,
  onCancel,
}: {
  compartment: StorageContainer["compartments"][number];
  disabled: boolean;
  selection: Selection;
  entryDetails: Map<string, UnsortedStorageCopy>;
  onSelectPlacement: (item: StoragePlacement) => void;
  onPlace: (slot: number) => void;
  onCancel: () => void;
}) {
  const bySlot = useMemo(() => {
    const map = new Map<number, StoragePlacement[]>();
    for (const item of compartment.placements) {
      map.set(item.slotIndex, [...(map.get(item.slotIndex) ?? []), item]);
    }
    return map;
  }, [compartment.placements]);
  return (
    <div
      className="grid gap-2"
      style={{
        gridTemplateColumns: `repeat(${compartment.columns}, minmax(0, 1fr))`,
      }}
      onKeyDown={(event) => event.key === "Escape" && onCancel()}
    >
      {Array.from(
        { length: compartment.rows * compartment.columns },
        (_, slotIndex) => {
          const placements = bySlot.get(slotIndex) ?? [];
          const top = placements.at(-1);
          const canPlace =
            !!selection &&
            (!top ||
              top.collectionEntryId === selection.item.collectionEntryId ||
              selection.type === "placement");
          const topDetails = top
            ? entryDetails.get(top.collectionEntryId)
            : undefined;
          return (
            <button
              key={slotIndex}
              type="button"
              disabled={disabled || (!!selection && !canPlace)}
              aria-label={
                top
                  ? `Slot ${slotIndex + 1}: ${topDetails?.printedName ?? topDetails?.name ?? "occupied"}`
                  : `Empty slot ${slotIndex + 1}`
              }
              className={`relative aspect-[2.5/3.5] min-h-20 overflow-hidden rounded-md border text-left transition ${
                selection?.type === "placement" && top?.id === selection.item.id
                  ? "border-primary ring-2 ring-primary"
                  : canPlace
                    ? "border-primary/60 hover:bg-primary/5"
                    : "hover:bg-muted/40"
              } disabled:cursor-not-allowed disabled:opacity-60`}
              onClick={() => {
                if (selection && canPlace) onPlace(slotIndex);
                else if (top) onSelectPlacement(top);
              }}
            >
              <span className="absolute left-1 top-1 z-10 rounded bg-background/90 px-1 text-[10px]">
                {slotIndex + 1}
              </span>
              {top ? (
                <div className="flex h-full flex-col justify-end bg-muted/30 p-2 pt-6">
                  <span className="line-clamp-3 text-xs font-medium">
                    {topDetails?.printedName ??
                      topDetails?.name ??
                      "Stored card"}
                  </span>
                  {placements.length > 1 || top.quantity > 1 ? (
                    <Badge
                      className="mt-1 w-fit text-[10px]"
                      variant="secondary"
                    >
                      x
                      {placements.reduce((sum, item) => sum + item.quantity, 0)}
                    </Badge>
                  ) : null}
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <LayoutGrid className="h-4 w-4 opacity-30" />
                </div>
              )}
            </button>
          );
        },
      )}
    </div>
  );
}

function NewContainerDialog({
  token,
  onCreated,
}: {
  token: string;
  onCreated: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"binder" | "box">("binder");
  const [count, setCount] = useState("20");
  const [rows, setRows] = useState("3");
  const [columns, setColumns] = useState("3");
  const mutation = useMutation({
    mutationFn: async () => {
      const compartmentCount = Number(count);
      const container = await createStorageContainer(token, {
        name: name.trim(),
        kind,
      });
      await Promise.all(
        Array.from({ length: compartmentCount }, (_, index) =>
          createStorageCompartment(token, {
            containerId: container.id,
            label: `${kind === "binder" ? "Page" : "Row"} ${index + 1}`,
            order: index,
            pageNumber: kind === "binder" ? index + 1 : undefined,
            rows: Number(rows),
            columns: Number(columns),
            capacity: Number(rows) * Number(columns),
          }),
        ),
      );
      return container;
    },
    onSuccess: async () => {
      await onCreated();
      setOpen(false);
      setName("");
    },
  });
  const valid =
    name.trim() &&
    Number(count) > 0 &&
    Number(count) <= 200 &&
    Number(rows) > 0 &&
    Number(columns) > 0;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="icon"
          variant="outline"
          aria-label="Add storage container"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New physical storage</DialogTitle>
          <DialogDescription>
            Create ordered pages or rows with fixed capacities. You can lock
            them after arranging.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="storage-name">Name</Label>
            <Input
              id="storage-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Trade binder"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={kind}
              onValueChange={(value) => setKind(value as "binder" | "box")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="binder">Binder</SelectItem>
                <SelectItem value="box">Box</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="storage-count">
              {kind === "binder" ? "Pages" : "Rows"}
            </Label>
            <Input
              id="storage-count"
              type="number"
              min="1"
              max="200"
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="storage-rows">Slot rows</Label>
            <Input
              id="storage-rows"
              type="number"
              min="1"
              max="10"
              value={rows}
              onChange={(event) => setRows(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="storage-columns">Slot columns</Label>
            <Input
              id="storage-columns"
              type="number"
              min="1"
              max="12"
              value={columns}
              onChange={(event) => setColumns(event.target.value)}
            />
          </div>
        </div>
        {mutation.error && (
          <p className="text-sm text-destructive" role="alert">
            {(mutation.error as Error).message}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyMessage({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {detail && <CardDescription>{detail}</CardDescription>}
      </CardHeader>
    </Card>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Clipboard,
  Download,
  FileText,
  List,
  Pencil,
  Plus,
  QrCode,
  ScanLine,
  Search,
  Trash2,
} from "lucide-react";
import type QrScannerType from "qr-scanner";

import { AppShell } from "@/components/layout/app-shell";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createOnlineCodes,
  deleteOnlineCode,
  getOnlineCodes,
  updateOnlineCode,
  type OnlineCode,
  type OnlineCodeStatus,
  type TcgCode,
} from "@/lib/api/online-codes";
import {
  canonicalizeOnlineCode,
  getOnlineCodeGame,
  groupOnlineCodes,
  normalizeOnlineCode,
  onlineCodeGames,
  parseOnlineCodeInput,
} from "@/lib/online-codes";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";

const statusMeta: Record<
  OnlineCodeStatus,
  { label: string; className: string }
> = {
  unused: {
    label: "Unused",
    className:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  redeemed: {
    label: "Redeemed",
    className: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  invalid: {
    label: "Invalid",
    className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  },
  traded: {
    label: "Traded",
    className:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
};

type StatusFilter = OnlineCodeStatus | "all";
type GameFilter = TcgCode | "all";
type ListMode = "codes" | "blocks";

export function OnlineCodesContent() {
  const { token, isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();
  const [manualOpen, setManualOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editing, setEditing] = useState<OnlineCode | null>(null);
  const [game, setGame] = useState<GameFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [mode, setMode] = useState<ListMode>("codes");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const ready = isAuthenticated && !!token;

  const query = useQuery({
    queryKey: ["online-codes", game],
    queryFn: () => getOnlineCodes(token!, game === "all" ? undefined : game),
    enabled: ready,
  });

  const refresh = () =>
    void queryClient.invalidateQueries({
      queryKey: ["online-codes"],
    });

  const createMutation = useMutation({
    mutationFn: (input: {
      tcg: TcgCode;
      codes: string[];
      source: "camera" | "manual" | "import";
      productName?: string;
      notes?: string;
    }) =>
      createOnlineCodes(token!, {
        tcg: input.tcg,
        codes: input.codes.map((code) => ({ code })),
        source: input.source,
        productName: input.productName || undefined,
        notes: input.notes || undefined,
      }),
    onSuccess: (result) => {
      refresh();
      setMessage(
        `${result.created} code${result.created === 1 ? "" : "s"} saved${
          result.duplicates
            ? ` · ${result.duplicates} duplicate${result.duplicates === 1 ? "" : "s"} skipped`
            : ""
        }`,
      );
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      status?: OnlineCodeStatus;
      productName?: string | null;
      notes?: string | null;
    }) => updateOnlineCode(token!, id, input),
    onSuccess: refresh,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOnlineCode(token!, id),
    onSuccess: refresh,
  });

  const codes = useMemo(() => query.data ?? [], [query.data]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return codes.filter((code) => {
      if (status !== "all" && code.status !== status) return false;
      if (!needle) return true;
      return [
        code.code,
        code.productName,
        code.notes,
        getOnlineCodeGame(code.tcg).label,
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(needle));
    });
  }, [codes, search, status]);

  const counts = useMemo(
    () =>
      codes.reduce(
        (result, code) => ({
          ...result,
          [code.status]: result[code.status] + 1,
        }),
        { unused: 0, redeemed: 0, invalid: 0, traded: 0 } as Record<
          OnlineCodeStatus,
          number
        >,
      ),
    [codes],
  );

  const exportCodes = () => {
    const blob = new Blob([filtered.map((code) => code.code).join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `code-vault-${game}-${new Date().toISOString().slice(0, 10)}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Badge variant="secondary">Multi-game</Badge>
              <Badge variant="outline">Private vault</Badge>
            </div>
            <h1 className="text-3xl font-heading font-bold">Code Vault</h1>
            <p className="mt-1 text-muted-foreground">
              Store and track redemption codes for MTG Arena, Pokémon TCG Live,
              and your other games.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={exportCodes}
              disabled={!filtered.length}
            >
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
            <Button
              variant="outline"
              onClick={() => setManualOpen(true)}
              disabled={!ready}
            >
              <Plus className="mr-2 h-4 w-4" /> Add codes
            </Button>
            <Button onClick={() => setScannerOpen(true)} disabled={!ready}>
              <ScanLine className="mr-2 h-4 w-4" /> Scan codes
            </Button>
          </div>
        </div>

        {message && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            <Check className="h-4 w-4" /> {message}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(statusMeta) as OnlineCodeStatus[]).map((key) => (
            <Card key={key}>
              <CardContent className="flex items-center justify-between p-4">
                <span className="text-sm text-muted-foreground">
                  {statusMeta[key].label}
                </span>
                <span className="text-2xl font-semibold tabular-nums">
                  {counts[key]}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader className="pb-4">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <CardTitle>Stored codes</CardTitle>
                <CardDescription>
                  {filtered.length} shown · {codes.length} total
                </CardDescription>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={game}
                  onValueChange={(value) => setGame(value as GameFilter)}
                >
                  <SelectTrigger className="w-full sm:w-52">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All games</SelectItem>
                    {onlineCodeGames.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative min-w-56">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search code, product, notes"
                    className="pl-9"
                  />
                </div>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as StatusFilter)}
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {(Object.keys(statusMeta) as OnlineCodeStatus[]).map(
                      (key) => (
                        <SelectItem key={key} value={key}>
                          {statusMeta[key].label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Tabs
              value={mode}
              onValueChange={(value) => setMode(value as ListMode)}
            >
              <TabsList>
                <TabsTrigger value="codes">
                  <List className="mr-2 h-4 w-4" />
                  Codes
                </TabsTrigger>
                <TabsTrigger value="blocks">
                  <FileText className="mr-2 h-4 w-4" />
                  Blocks of 10
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            {!ready ? (
              <EmptyState
                title="Sign in to use your code vault"
                description="Codes are private to your TCGer account."
              />
            ) : query.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-20 w-full" />
                ))}
              </div>
            ) : query.error ? (
              <EmptyState
                title="Codes could not be loaded"
                description={(query.error as Error).message}
              />
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No matching codes"
                description="Scan a supported card or add a batch manually to get started."
              />
            ) : mode === "blocks" ? (
              <CodeBlocks codes={filtered} />
            ) : (
              <div className="divide-y rounded-lg border">
                {filtered.map((code) => (
                  <CodeRow
                    key={code.id}
                    code={code}
                    busy={updateMutation.isPending || deleteMutation.isPending}
                    onEdit={() => setEditing(code)}
                    onStatus={(nextStatus) =>
                      updateMutation.mutate({ id: code.id, status: nextStatus })
                    }
                    onDelete={() => {
                      if (window.confirm("Delete this online code?"))
                        deleteMutation.mutate(code.id);
                    }}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {manualOpen && (
        <ManualCodeDialog
          open
          defaultGame={game === "all" ? "pokemon" : game}
          saving={createMutation.isPending}
          onOpenChange={setManualOpen}
          onSave={(values) =>
            createMutation.mutate(values, {
              onSuccess: () => setManualOpen(false),
            })
          }
        />
      )}
      {scannerOpen && (
        <CodeScannerDialog
          open
          defaultGame={game === "all" ? "pokemon" : game}
          saving={createMutation.isPending}
          onOpenChange={setScannerOpen}
          onSave={(tcg, codesToSave) =>
            createMutation.mutate(
              { tcg, codes: codesToSave, source: "camera" },
              { onSuccess: () => setScannerOpen(false) },
            )
          }
        />
      )}
      {editing && (
        <EditCodeDialog
          key={editing.id}
          code={editing}
          saving={updateMutation.isPending}
          onOpenChange={(open) => !open && setEditing(null)}
          onSave={(input) =>
            updateMutation.mutate(
              { id: editing.id, ...input },
              { onSuccess: () => setEditing(null) },
            )
          }
        />
      )}
    </AppShell>
  );
}

function CodeRow({
  code,
  busy,
  onEdit,
  onStatus,
  onDelete,
}: {
  code: OnlineCode;
  busy: boolean;
  onEdit: () => void;
  onStatus: (status: OnlineCodeStatus) => void;
  onDelete: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code.code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <code className="break-all font-mono text-sm font-semibold">
            {code.code}
          </code>
          <Badge
            variant="outline"
            className={statusMeta[code.status].className}
          >
            {statusMeta[code.status].label}
          </Badge>
          <Badge variant="secondary" className="capitalize">
            {code.source}
          </Badge>
          <Badge variant="outline">{getOnlineCodeGame(code.tcg).label}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {code.productName || `${getOnlineCodeGame(code.tcg).service} code`} ·{" "}
          {new Date(code.capturedAt).toLocaleString()}
        </p>
        {code.notes && (
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
            {code.notes}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={code.status}
          onValueChange={(value) => onStatus(value as OnlineCodeStatus)}
          disabled={busy}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(statusMeta) as OnlineCodeStatus[]).map((key) => (
              <SelectItem key={key} value={key}>
                {statusMeta[key].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="icon"
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-4 w-4" />
          ) : (
            <Clipboard className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onEdit}
          aria-label="Edit code"
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete code"
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>
    </div>
  );
}

function CodeBlocks({ codes }: { codes: OnlineCode[] }) {
  const grouped = onlineCodeGames
    .map((game) => ({
      game,
      codes: codes.filter((code) => code.tcg === game.value),
    }))
    .filter((group) => group.codes.length > 0);
  return (
    <div className="space-y-6">
      {grouped.map(({ game, codes: gameCodes }) => (
        <section key={game.value} className="space-y-3">
          <h3 className="font-medium">{game.label}</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {groupOnlineCodes(gameCodes).map((block, index) => (
              <div
                key={block[0]?.id ?? index}
                className="rounded-lg border bg-muted/30 p-4"
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-medium">Block {index + 1}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      navigator.clipboard.writeText(
                        block.map((item) => item.code).join("\n"),
                      )
                    }
                  >
                    <Clipboard className="mr-2 h-4 w-4" /> Copy block
                  </Button>
                </div>
                <ol className="space-y-1 font-mono text-sm">
                  {block.map((item, itemIndex) => (
                    <li key={item.id} className="break-all">
                      <span className="mr-2 text-muted-foreground">
                        {index * 10 + itemIndex + 1}.
                      </span>
                      {item.code}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ManualCodeDialog({
  open,
  defaultGame,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  defaultGame: TcgCode;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    tcg: TcgCode;
    codes: string[];
    source: "manual";
    productName?: string;
    notes?: string;
  }) => void;
}) {
  const [tcg, setTcg] = useState<TcgCode>(defaultGame);
  const [value, setValue] = useState("");
  const [productName, setProductName] = useState("");
  const [notes, setNotes] = useState("");
  const codes = parseOnlineCodeInput(value);
  const gameMeta = getOnlineCodeGame(tcg);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add redemption codes</DialogTitle>
          <DialogDescription>
            Paste up to 250 codes, one per line or separated by commas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Game</Label>
            <Select
              value={tcg}
              onValueChange={(value) => setTcg(value as TcgCode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {onlineCodeGames.map((game) => (
                  <SelectItem key={game.value} value={game.value}>
                    {game.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="online-code-input">Codes</Label>
            <Textarea
              id="online-code-input"
              rows={8}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="font-mono"
              placeholder={gameMeta.codeExample}
            />
            <p className="text-xs text-muted-foreground">
              {codes.length} unique valid code{codes.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="online-code-product">
              Product or set (optional)
            </Label>
            <Input
              id="online-code-product"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
              placeholder={`e.g. ${gameMeta.service} prerelease reward`}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="online-code-notes">Notes (optional)</Label>
            <Textarea
              id="online-code-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!codes.length || codes.length > 250 || saving}
            onClick={() =>
              onSave({
                tcg,
                codes,
                source: "manual",
                productName: productName.trim() || undefined,
                notes: notes.trim() || undefined,
              })
            }
          >
            {saving
              ? "Saving…"
              : `Save ${codes.length || ""} code${codes.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CodeScannerDialog({
  open,
  defaultGame,
  saving,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  defaultGame: TcgCode;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (tcg: TcgCode, codes: string[]) => void;
}) {
  const [tcg, setTcg] = useState<TcgCode>(defaultGame);
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !videoRef.current) return;
    let cancelled = false;
    void import("qr-scanner").then(async ({ default: QrScanner }) => {
      if (cancelled || !videoRef.current) return;
      const scanner = new QrScanner(
        videoRef.current,
        (result) => {
          const value = canonicalizeOnlineCode(result.data);
          if (!value) return;
          setCodes((current) =>
            current.some(
              (item) =>
                normalizeOnlineCode(item) === normalizeOnlineCode(value),
            )
              ? current
              : current.length >= 250
                ? current
                : [...current, value],
          );
        },
        {
          preferredCamera: "environment",
          maxScansPerSecond: 12,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          returnDetailedScanResult: true,
        },
      );
      scannerRef.current = scanner;
      try {
        await scanner.start();
      } catch (scanError) {
        setError(
          scanError instanceof Error
            ? scanError.message
            : "Camera access was not available.",
        );
      }
    });
    return () => {
      cancelled = true;
      scannerRef.current?.destroy();
      scannerRef.current = null;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Continuous code scanner</DialogTitle>
          <DialogDescription>
            QR codes scan automatically. For printed MTG Arena codes, use manual
            entry on the website or the iOS live-text scanner.
          </DialogDescription>
        </DialogHeader>
        <Select value={tcg} onValueChange={(value) => setTcg(value as TcgCode)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {onlineCodeGames.map((game) => (
              <SelectItem key={game.value} value={game.value}>
                {game.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          <video
            ref={videoRef}
            className="h-full w-full object-cover"
            muted
            playsInline
          />
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <Badge className="bg-black/70 text-white hover:bg-black/70">
              <QrCode className="mr-2 h-4 w-4" />
              {codes.length} captured
            </Badge>
          </div>
          {error && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white">
              <span>{error}</span>
            </div>
          )}
        </div>
        {codes.length > 0 && (
          <div className="max-h-28 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs">
            {codes
              .slice()
              .reverse()
              .map((code) => (
                <div key={normalizeOnlineCode(code)} className="break-all">
                  {code}
                </div>
              ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!codes.length || saving}
            onClick={() => onSave(tcg, codes)}
          >
            {saving
              ? "Saving…"
              : `Save ${codes.length} code${codes.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditCodeDialog({
  code,
  saving,
  onOpenChange,
  onSave,
}: {
  code: OnlineCode;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (input: {
    status: OnlineCodeStatus;
    productName: string | null;
    notes: string | null;
  }) => void;
}) {
  const [status, setStatus] = useState<OnlineCodeStatus>(code.status);
  const [productName, setProductName] = useState(code.productName ?? "");
  const [notes, setNotes] = useState(code.notes ?? "");
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit online code</DialogTitle>
          <DialogDescription className="break-all font-mono">
            {code.code}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as OnlineCodeStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(statusMeta) as OnlineCodeStatus[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {statusMeta[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-code-product">Product or set</Label>
            <Input
              id="edit-code-product"
              value={productName}
              onChange={(event) => setProductName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-code-notes">Notes</Label>
            <Textarea
              id="edit-code-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving}
            onClick={() =>
              onSave({
                status,
                productName: productName.trim() || null,
                notes: notes.trim() || null,
              })
            }
          >
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      className={cn(
        "grid min-h-56 place-items-center rounded-lg border border-dashed p-8 text-center",
      )}
    >
      <div>
        <QrCode className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
        <h3 className="font-medium">{title}</h3>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

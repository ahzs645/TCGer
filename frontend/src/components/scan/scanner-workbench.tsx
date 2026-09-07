"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  recordingDatabase,
  exportRecordedRun,
  importRecordedRun,
  replaySummary,
  type RecordedRun,
  type RecordedAttempt,
} from "@/lib/scan/recorded-runs";
import { SCANNER_REVIEW_DB_NAME } from "@/lib/storage/keys";
import Dexie, { type Table } from "dexie";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/stores/auth";
import {
  getCollections,
  addCardToCollection,
  type Collection,
} from "@/lib/api/collections";
import { getTrackedCardPrices } from "@/lib/api/pricing";
import type { BinderPage } from "@tcg/api-types";
import { saveBinderPage, getBinderPages } from "@/lib/api/binder-pages";
import { scanCardImageApi, type CardScanMatch } from "@/lib/api/scan";
import { useVideoScanData } from "./use-video-scan-data";
import type { ScanFilter } from "./video-scan-types";
import type { VideoQuad } from "@/lib/scan/scan-types";
import { recognizeCrop } from "@/lib/scan/recognize-crop";
import { warpCanvasFromQuad } from "@/lib/scan/quad-warp";
import { detectCards, ensureYoloModel } from "@/lib/scan/yolo-detector";
import {
  gridQuads,
  ScanConsensus,
  scanCurrencyTotals,
  validQuad,
  type ScanRegion,
} from "@/lib/scan/scanner-workflow";

interface SessionCard {
  id: string;
  card: CardScanMatch;
  saved?: boolean;
  price?: number;
  currency?: string;
}
interface Draft {
  regions: ScanRegion[];
  session: SessionCard[];
  photo: Blob | null;
  pageNumber: number;
  binderId: string;
  width: number;
  height: number;
}
function sessionTable() {
  const db = new Dexie(SCANNER_REVIEW_DB_NAME);
  db.version(1).stores({ drafts: "" });
  db.version(2).stores({ drafts: "", runs: "id,createdAt" });
  return { db, table: db.table("drafts") as Table<Draft, string> };
}
const toBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Photo could not be captured.")),
      "image/jpeg",
      0.92,
    ),
  );
const key = (card: { tcg: string; externalId: string }) =>
  `${card.tcg}:${card.externalId}`;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Camera and page review share the same accepted-printing and retry rules. */
export function ScannerWorkbench() {
  const token = useAuthStore((s) => s.token);
  const owner = useAuthStore((s) => s.user?.id) ?? "local";
  const draftKey = `${owner}:review`;
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const working = useRef(false);
  const cameraGeneration = useRef(0);
  const consensus = useRef(new ScanConsensus());
  const [camera, setCamera] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torch, setTorch] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const [autoOpen, setAutoOpen] = useState(true);
  const [filter, setFilter] = useState<ScanFilter>("pokemon");
  const [engine, setEngine] = useState<"local" | "embedding" | "phash">(
    "local",
  );
  const [debug, setDebug] = useState(false);
  const [developer, setDeveloper] = useState(false);
  const activations = useRef(0);
  const [recording, setRecording] = useState(false);
  const [saveAttemptImages, setSaveAttemptImages] = useState(true);
  const [intervalMs, setIntervalMs] = useState(1400);
  const [attempts, setAttempts] = useState<RecordedAttempt[]>([]);
  const [runs, setRuns] = useState<RecordedRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<string>("");
  const [replayReport, setReplayReport] = useState("");
  const [warmStart, setWarmStart] = useState(true);
  useEffect(() => {
    setDeveloper(localStorage.getItem("tcger.scanner.developer") === "true");
  }, []);
  async function loadRuns() {
    const { db, runs } = recordingDatabase();
    try {
      setRuns(
        (await runs.orderBy("createdAt").reverse().toArray()).filter(
          (run) => run.ownerId === draftKey,
        ),
      );
    } finally {
      db.close();
    }
  }
  function download(text: string, filename: string) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [regions, setRegions] = useState<ScanRegion[]>([]);
  const [session, setSession] = useState<SessionCard[]>([]);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<CardScanMatch | null>(null);
  const [binders, setBinders] = useState<Collection[]>([]);
  const [binderId, setBinderId] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [savedPages, setSavedPages] = useState<BinderPage[]>([]);
  const [savedPageId, setSavedPageId] = useState("");
  useEffect(() => {
    let cancelled = false;
    setSavedPages([]);
    setSavedPageId("");
    if (token && binderId)
      void getBinderPages(token, binderId)
        .then((pages) => {
          if (!cancelled) setSavedPages(pages);
        })
        .catch((error) => {
          if (!cancelled) setError(errorText(error));
        });
    return () => {
      cancelled = true;
    };
  }, [token, binderId]);
  useEffect(() => {
    setRuns([]);
    setAttempts([]);
    setSelectedRun("");
    setRecording(false);
  }, [draftKey]);
  async function reviewSavedPage() {
    const page = savedPages.find((page) => page.id === savedPageId);
    if (!page?.imageUrl)
      throw new Error(
        "This saved page has no photo. Choose its page number and upload a replacement photo.",
      );
    const response = await fetch(page.imageUrl);
    if (!response.ok) throw new Error("Could not load the saved page photo");
    const photo = await response.blob();
    const bitmap = await createImageBitmap(photo);
    const { width, height } = bitmap;
    bitmap.close();
    const regions: ScanRegion[] = page.placements.map((placement) => ({
      id: `${page.id}:${placement.slotIndex}`,
      quad: [
        placement.quad.topLeft,
        placement.quad.topRight,
        placement.quad.bottomRight,
        placement.quad.bottomLeft,
      ].map((point) => ({
        x: point.x * width,
        y: point.y * height,
      })) as VideoQuad,
      candidates: [
        {
          externalId: placement.cardId,
          tcg: placement.tcg,
          name: placement.name,
          setCode: placement.setCode ?? null,
          confidence: placement.confidence,
          distance: 0,
          setName: null,
          rarity: null,
          imageUrl: null,
        },
      ],
      selected: 0,
      confirmed: placement.status === "matched",
      included: true,
    }));
    setPhoto(photo);
    setDimensions({ width, height });
    setPageNumber(page.pageNumber);
    setRegions(regions);
    setActive(regions[0]?.id ?? null);
    setStatus(
      `Reviewing saved page ${page.pageNumber}. Upload a new photo and save this page number to replace it.`,
    );
  }
  const [rows, setRows] = useState(3);
  const [columns, setColumns] = useState(3);
  const [hydrated, setHydrated] = useState(false);
  const hydratedOwner = useRef<string | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const callbacks = useMemo(
    () => ({
      onHashStatus: setStatus,
      onHashCount: () => {},
      onLoadingChange: () => {},
    }),
    [],
  );
  const { ensureEmbeddingIndexes } = useVideoScanData(token, callbacks);
  const sourceUrl = useMemo(
    () => (photo ? URL.createObjectURL(photo) : null),
    [photo],
  );
  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    },
    [sourceUrl],
  );
  useEffect(
    () => () => stream.current?.getTracks().forEach((track) => track.stop()),
    [],
  );
  useEffect(() => {
    if (camera && video.current) video.current.srcObject = stream.current;
  }, [camera]);
  useEffect(() => {
    if (!token) {
      setBinders([]);
      return;
    }
    void getCollections(token)
      .then(setBinders)
      .catch((e) => setError(errorText(e)));
  }, [token]);
  useEffect(() => {
    let cancelled = false;
    setHydrated(false);
    hydratedOwner.current = null;
    const { db, table } = sessionTable();
    void table
      .get(draftKey)
      .then((draft) => {
        if (cancelled) return;
        setRegions(draft?.regions ?? []);
        setSession(draft?.session ?? []);
        setPhoto(draft?.photo ?? null);
        setBinderId(draft?.binderId ?? "");
        setPageNumber(draft?.pageNumber ?? 1);
        setDimensions({ width: draft?.width ?? 1, height: draft?.height ?? 1 });
        hydratedOwner.current = draftKey;
        setHydrated(true);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(`Could not restore scanner review: ${errorText(e)}`);
        }
      })
      .finally(() => db.close());
    return () => {
      cancelled = true;
    };
  }, [draftKey]);
  useEffect(() => {
    if (!hydrated || hydratedOwner.current !== draftKey || busy) return;
    const { db, table } = sessionTable();
    void table
      .put(
        { regions, session, photo, pageNumber, binderId, ...dimensions },
        draftKey,
      )
      .catch((e) =>
        setError(
          `Review is only in memory; browser storage failed: ${errorText(e)}`,
        ),
      )
      .finally(() => db.close());
  }, [
    regions,
    session,
    photo,
    pageNumber,
    binderId,
    dimensions,
    draftKey,
    hydrated,
    busy,
  ]);
  const run = useCallback(async (action: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
      setAutomatic(false);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);
  function stopCamera() {
    cameraGeneration.current++;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setCamera(false);
    setAutomatic(false);
    setTorch(false);
  }
  async function startCamera() {
    const next = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = next;
    const capabilities = next
      .getVideoTracks()[0]
      ?.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
    setTorchSupported(Boolean(capabilities?.torch));
    setCamera(true);
    if (warmStart && engine === "local") {
      setStatus("Preloading scanner models…");
      const indexes = await ensureEmbeddingIndexes(filter);
      const { ensureEmbeddingModel } = await import(
        "@/lib/scan/embedding-matcher"
      );
      if (indexes[0])
        await ensureEmbeddingModel({
          model: indexes[0].model,
          dtype: indexes[0].dtype,
          encoder: indexes[0].encoder,
          modelUrl: indexes[0].modelUrl,
        });
      await ensureYoloModel();
      setStatus("Camera ready.");
    }
  }
  function frame(): HTMLCanvasElement {
    if (!video.current?.videoWidth)
      throw new Error("Wait for the camera preview before capturing.");
    const capture = document.createElement("canvas");
    const scale = Math.min(
      1,
      1920 / Math.max(video.current.videoWidth, video.current.videoHeight),
    );
    capture.width = Math.round(video.current.videoWidth * scale);
    capture.height = Math.round(video.current.videoHeight * scale);
    capture
      .getContext("2d")!
      .drawImage(video.current, 0, 0, capture.width, capture.height);
    return capture;
  }
  async function fromPhoto(): Promise<HTMLCanvasElement> {
    if (!photo) throw new Error("Capture or upload a photo first.");
    const bitmap = await createImageBitmap(photo);
    const result = document.createElement("canvas");
    result.width = bitmap.width;
    result.height = bitmap.height;
    result.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return result;
  }
  async function recognize(crop: HTMLCanvasElement) {
    if (engine === "local") {
      const indexes = await ensureEmbeddingIndexes(filter);
      if (!indexes.length)
        throw new Error("No recognition package is available for this game.");
      const candidates = await recognizeCrop(crop, indexes);
      const best = candidates[0];
      return {
        candidates,
        accepted:
          best?.passedThreshold && !best.requiresPrintingChoice ? best : null,
      };
    }
    if (!token) throw new Error("Sign in to use server recognition.");
    const result = await scanCardImageApi({
      token,
      file: new File([await toBlob(crop)], "card.jpg", { type: "image/jpeg" }),
      tcg: filter,
      scanEngine: engine,
      saveDebugCapture: debug,
      captureSource: "web-workbench",
    });
    return {
      candidates: result.candidates,
      accepted:
        result.meta?.catalogDecision?.accepted === false ||
        result.match?.requiresPrintingChoice
          ? null
          : result.match,
    };
  }
  async function matches(crop: HTMLCanvasElement) {
    const started = performance.now();
    const result = await recognize(crop);
    if (recording) {
      const attempt: RecordedAttempt = {
        id: crypto.randomUUID(),
        at: new Date().toISOString(),
        engine,
        elapsedMs: performance.now() - started,
        accepted: result.accepted,
        candidates: result.candidates,
        crop: saveAttemptImages ? await toBlob(crop) : undefined,
      };
      setAttempts((previous) => [...previous, attempt].slice(-500));
    }
    return result;
  }
  function addToSession(card: CardScanMatch, id = crypto.randomUUID()) {
    setSession((previous) =>
      previous.some((row) => row.id === id && row.saved)
        ? previous
        : [...previous.filter((row) => row.id !== id), { id, card }],
    );
    if (autoOpen) setDetail(card);
  }
  async function capture(page: boolean) {
    const source = frame();
    setAutomatic(false);
    setPhoto(await toBlob(source));
    setDimensions({ width: source.width, height: source.height });
    await prepare(source, page);
  }
  async function prepare(source: HTMLCanvasElement, page: boolean) {
    let quads: VideoQuad[];
    if (page) {
      setStatus("Finding cards on the page…");
      await ensureYoloModel();
      const detected = await detectCards(source);
      quads = detected
        .sort(
          (a, b) =>
            Math.round(a.cy / (source.height / rows)) -
              Math.round(b.cy / (source.height / rows)) || a.cx - b.cx,
        )
        .slice(0, 100)
        .map((item) => item.quad);
      if (!quads.length) {
        setStatus(
          "No card boundaries found. Adjust the grid corners before recognizing.",
        );
        quads = gridQuads(source.width, source.height, rows, columns);
      }
    } else {
      quads = gridQuads(source.width, source.height, 1, 1);
    }
    const next = quads.map((quad) => ({
      id: crypto.randomUUID(),
      quad,
      candidates: [],
      selected: 0,
      confirmed: false,
      included: true,
    }));
    setRegions(next);
    setActive(next[0]?.id ?? null);
    if (!page) await recognizeRegions(source, next);
  }
  async function recognizeRegions(
    source: HTMLCanvasElement,
    targets: ScanRegion[],
  ) {
    for (const region of targets) {
      if (!region.included) continue;
      if (!validQuad(region.quad))
        throw new Error(
          "Corners must form a clockwise rectangle without crossing.",
        );
      setStatus(
        `Recognizing card ${targets.indexOf(region) + 1} of ${targets.length}…`,
      );
      const result = await matches(warpCanvasFromQuad(source, region.quad));
      setRegions((previous) =>
        previous.map((item) =>
          item.id === region.id
            ? {
                ...item,
                candidates: result.candidates,
                selected: 0,
                confirmed: Boolean(result.accepted),
                error: result.candidates.length
                  ? undefined
                  : "No match. Adjust the corners or search manually.",
              }
            : item,
        ),
      );
    }
    setStatus("Review each card and choose its exact printing before adding.");
  }
  const automaticStep = useRef<() => Promise<void>>(async () => {});
  automaticStep.current = async () => {
    if (!camera || !automatic || working.current) return;
    await run(async () => {
      const generation = cameraGeneration.current;
      const source = frame();
      await ensureYoloModel();
      const detections = await detectCards(source);
      if (detections.length !== 1) {
        consensus.current.observe(null);
        setStatus("Show one card, fully in frame.");
        return;
      }
      const quad = detections[0]!.quad;
      if (
        quad.some(
          (p) =>
            p.x < 3 ||
            p.y < 3 ||
            p.x > source.width - 3 ||
            p.y > source.height - 3,
        )
      ) {
        consensus.current.observe(null);
        return;
      }
      const { accepted } = await matches(warpCanvasFromQuad(source, quad));
      if (generation !== cameraGeneration.current) return;
      if (consensus.current.observe(accepted)) {
        addToSession(accepted!);
        setStatus(
          "Card added to session. Remove it from view before showing the next card.",
        );
      }
    });
  };
  useEffect(() => {
    if (!automatic) return;
    const timer = setInterval(() => void automaticStep.current(), intervalMs);
    return () => clearInterval(timer);
  }, [automatic, intervalMs]);
  const selected = regions.find((item) => item.id === active);
  const patch = (id: string, update: Partial<ScanRegion>) =>
    setRegions((previous) =>
      previous.map((item) =>
        item.id === id
          ? {
              ...item,
              ...update,
              saved:
                update.saved ??
                (update.candidates ||
                update.quad ||
                update.selected !== undefined
                  ? false
                  : item.saved),
            }
          : item,
      ),
    );
  const reviewed = regions.filter(
    (item) =>
      item.included &&
      item.confirmed &&
      item.candidates[item.selected] &&
      !item.candidates[item.selected]?.requiresPrintingChoice,
  );
  async function saveSession() {
    if (!token || !binderId) throw new Error("Choose a binder first.");
    let checkpoint = session;
    for (const item of session.filter((item) => !item.saved)) {
      await addCardToCollection(token, binderId, {
        cardId: item.card.externalId,
        quantity: 1,
        cardData: {
          externalId: item.card.externalId,
          name: item.card.name,
          tcg: item.card.tcg,
          setCode: item.card.setCode ?? undefined,
          imageUrl: item.card.imageUrl ?? undefined,
          rarity: item.card.rarity ?? undefined,
        },
      });
      // Checkpoint each successful copy. A retry only sends the remaining copies.
      checkpoint = checkpoint.map((row) =>
        row.id === item.id ? { ...row, saved: true } : row,
      );
      setSession(checkpoint);
      const { db, table } = sessionTable();
      try {
        await table.put(
          {
            regions,
            session: checkpoint,
            photo,
            pageNumber,
            binderId,
            ...dimensions,
          },
          draftKey,
        );
      } finally {
        db.close();
      }
    }
    setStatus("Session added to binder.");
  }
  async function savePage() {
    if (!token || !binderId) throw new Error("Choose a binder first.");
    const saved = await saveBinderPage(
      token,
      binderId,
      {
        pageNumber,
        capturedAt: new Date().toISOString(),
        placements: regions.flatMap((region, slotIndex) => {
          const card = region.candidates[region.selected];
          if (!region.included || !card) return [];
          if (!validQuad(region.quad))
            throw new Error("Fix crossed corners before saving this page.");
          const points = region.quad.map((p) => ({
            x: Math.max(0, Math.min(1, p.x / dimensions.width)),
            y: Math.max(0, Math.min(1, p.y / dimensions.height)),
          }));
          return [
            {
              slotIndex,
              cardId: card.externalId,
              name: card.name,
              tcg: card.tcg,
              setCode: card.setCode ?? undefined,
              confidence: card.confidence,
              status:
                region.confirmed && !card.requiresPrintingChoice
                  ? ("matched" as const)
                  : ("uncertain" as const),
              quad: {
                topLeft: points[0]!,
                topRight: points[1]!,
                bottomRight: points[2]!,
                bottomLeft: points[3]!,
              },
            },
          ];
        }),
      },
      photo ?? undefined,
    );
    setSavedPages((previous) => [
      ...previous.filter((page) => page.id !== saved.id),
      saved,
    ]);
    setStatus(
      `Page ${pageNumber} and photo saved. Saving this page again replaces its review and photo.`,
    );
  }
  const totals = scanCurrencyTotals(
    session.flatMap((item) =>
      item.price != null && item.currency
        ? [{ price: item.price, currency: item.currency }]
        : [],
    ),
  );
  return (
    <section
      className="space-y-4 rounded-xl border p-4 [&_select]:rounded [&_select]:border [&_select]:bg-background [&_select]:p-2 [&_input:not([type=checkbox]):not([type=range]):not([type=file])]:rounded [&_input:not([type=checkbox]):not([type=range]):not([type=file])]:border [&_input:not([type=checkbox]):not([type=range]):not([type=file])]:bg-background [&_input:not([type=checkbox]):not([type=range]):not([type=file])]:p-2"
      aria-label="Camera and binder scanner"
    >
      <h2 className="text-xl font-semibold">
        <button
          onClick={() => {
            activations.current++;
            if (activations.current >= 7) {
              setDeveloper(true);
              localStorage.setItem("tcger.scanner.developer", "true");
              void loadRuns();
              setStatus("Developer tools unlocked.");
            }
          }}
        >
          Camera &amp; binder pages
        </button>
      </h2>
      <div className="flex flex-wrap gap-3">
        <label>
          Game{" "}
          <select
            aria-label="Scanner game"
            value={filter}
            onChange={(e) => setFilter(e.target.value as ScanFilter)}
          >
            {["pokemon", "magic", "yugioh", "all"].map((game) => (
              <option key={game}>{game}</option>
            ))}
          </select>
        </label>
        <label>
          Recognition{" "}
          <select
            value={engine}
            onChange={(e) => setEngine(e.target.value as typeof engine)}
          >
            <option value="local">On this device</option>
            <option value="embedding" disabled={!token}>
              Server embedding
            </option>
            <option value="phash" disabled={!token}>
              Server image matching
            </option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={autoOpen}
            onChange={(e) => setAutoOpen(e.target.checked)}
          />{" "}
          Open card after capture
        </label>
        {engine !== "local" && (
          <label>
            <input
              type="checkbox"
              checked={debug}
              onChange={(e) => setDebug(e.target.checked)}
            />{" "}
            Save debug captures on server
          </label>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy && !camera}
          onClick={() => (camera ? stopCamera() : void run(startCamera))}
        >
          {camera ? "Stop camera" : "Start camera"}
        </Button>
        <Button
          disabled={!camera || busy}
          onClick={() => void run(() => capture(false))}
        >
          Capture card
        </Button>
        <Button
          disabled={!camera || busy}
          onClick={() => void run(() => capture(true))}
        >
          Capture binder page
        </Button>
        {camera && (
          <label>
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => {
                setAutomatic(e.target.checked);
                consensus.current.nextCard();
              }}
            />{" "}
            Automatic capture
          </label>
        )}
        {camera && torchSupported && (
          <Button
            onClick={() =>
              void run(async () => {
                await stream.current!.getVideoTracks()[0]!.applyConstraints({
                  advanced: [{ torch: !torch } as MediaTrackConstraintSet],
                });
                setTorch(!torch);
              })
            }
          >
            {torch ? "Turn torch off" : "Turn torch on"}
          </Button>
        )}
        <label className="text-sm">
          Upload card or page
          <input
            aria-label="Upload scanner photo"
            disabled={busy}
            type="file"
            accept="image/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                void run(async () => {
                  const bitmap = await createImageBitmap(file);
                  const source = document.createElement("canvas");
                  const scale = Math.min(
                    1,
                    2400 / Math.max(bitmap.width, bitmap.height),
                  );
                  source.width = Math.round(bitmap.width * scale);
                  source.height = Math.round(bitmap.height * scale);
                  source
                    .getContext("2d")!
                    .drawImage(bitmap, 0, 0, source.width, source.height);
                  bitmap.close();
                  setPhoto(await toBlob(source));
                  setDimensions({ width: source.width, height: source.height });
                  setRegions([]);
                  setStatus("Choose Detect page, Grid, or Single card below.");
                });
            }}
          />
        </label>
      </div>
      {camera && (
        <video
          className="max-h-96 w-full rounded-lg bg-black"
          ref={video}
          autoPlay
          muted
          playsInline
        />
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm text-muted-foreground">
        {status}
      </p>
      {photo && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => prepare(await fromPhoto(), true))
              }
            >
              Detect page
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => prepare(await fromPhoto(), false))
              }
            >
              Single card
            </Button>
            <label>
              Rows
              <input
                className="w-12"
                type="number"
                min={1}
                max={10}
                value={rows}
                onChange={(e) =>
                  setRows(
                    Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                  )
                }
              />
            </label>
            <label>
              Columns
              <input
                className="w-12"
                type="number"
                min={1}
                max={10}
                value={columns}
                onChange={(e) =>
                  setColumns(
                    Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                  )
                }
              />
            </label>
            <Button
              disabled={busy}
              onClick={() => {
                const next = gridQuads(
                  dimensions.width,
                  dimensions.height,
                  rows,
                  columns,
                ).map((quad) => ({
                  id: crypto.randomUUID(),
                  quad,
                  candidates: [],
                  selected: 0,
                  confirmed: false,
                  included: true,
                }));
                setRegions(next);
                setActive(next[0]?.id ?? null);
              }}
            >
              Use grid
            </Button>
            <Button
              disabled={busy || !regions.length}
              onClick={() =>
                void run(async () =>
                  recognizeRegions(await fromPhoto(), regions),
                )
              }
            >
              Recognize regions
            </Button>
          </div>
          <div
            className="relative mx-auto max-w-3xl"
            style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}
          >
            {/* The captured image is deliberately local, with pixel coordinates preserved for crop review. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sourceUrl!}
              alt="Captured binder page for corner correction"
              className="absolute h-full w-full"
            />
            <svg
              className="absolute h-full w-full touch-none"
              viewBox={`0 0 ${dimensions.width} ${dimensions.height}`}
            >
              {regions.map((region, index) => (
                <g key={region.id}>
                  <polygon
                    points={region.quad.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill={active === region.id ? "#38bdf830" : "transparent"}
                    stroke={region.confirmed ? "#22c55e" : "#f59e0b"}
                    strokeWidth={Math.max(2, dimensions.width / 400)}
                    onClick={() => setActive(region.id)}
                  />
                  <text
                    pointerEvents="none"
                    x={region.quad[0].x + 5}
                    y={region.quad[0].y + 25}
                    fill="white"
                    fontSize={dimensions.width / 35}
                  >
                    {index + 1}
                  </text>
                  {active === region.id &&
                    region.quad.map((point, corner) => (
                      <circle
                        key={corner}
                        cx={point.x}
                        cy={point.y}
                        r={dimensions.width / 65}
                        fill="#38bdf8"
                        onPointerDown={(e) =>
                          e.currentTarget.setPointerCapture(e.pointerId)
                        }
                        onPointerMove={(e) => {
                          if (!e.currentTarget.hasPointerCapture(e.pointerId))
                            return;
                          const rect =
                            e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                          const quad = region.quad.map((p, i) =>
                            i === corner
                              ? {
                                  x: Math.max(
                                    0,
                                    Math.min(
                                      dimensions.width,
                                      ((e.clientX - rect.left) / rect.width) *
                                        dimensions.width,
                                    ),
                                  ),
                                  y: Math.max(
                                    0,
                                    Math.min(
                                      dimensions.height,
                                      ((e.clientY - rect.top) / rect.height) *
                                        dimensions.height,
                                    ),
                                  ),
                                }
                              : p,
                          ) as VideoQuad;
                          patch(region.id, {
                            quad,
                            confirmed: false,
                            candidates: [],
                          });
                        }}
                        onPointerUp={(e) =>
                          e.currentTarget.releasePointerCapture(e.pointerId)
                        }
                      />
                    ))}
                </g>
              ))}
            </svg>
          </div>
          {selected && (
            <div className="space-y-2 rounded border p-3">
              <h3>
                Card {regions.indexOf(selected) + 1} — drag the four blue
                corners to correct its crop
              </h3>
              <label>
                <input
                  type="checkbox"
                  checked={selected.included}
                  onChange={(e) =>
                    patch(selected.id, { included: e.target.checked })
                  }
                />{" "}
                Include this slot
              </label>
              <div className="flex flex-wrap gap-2">
                {selected.quad.map((point, index) => (
                  <label key={index}>
                    Corner {index + 1}
                    {(["x", "y"] as const).map((axis) => (
                      <input
                        key={axis}
                        aria-label={`Corner ${index + 1} ${axis}`}
                        type="number"
                        className="w-20"
                        value={Math.round(point[axis])}
                        onChange={(e) =>
                          patch(selected.id, {
                            quad: selected.quad.map((p, i) =>
                              i === index
                                ? {
                                    ...p,
                                    [axis]: Math.max(
                                      0,
                                      Math.min(
                                        axis === "x"
                                          ? dimensions.width
                                          : dimensions.height,
                                        Number(e.target.value),
                                      ),
                                    ),
                                  }
                                : p,
                            ) as VideoQuad,
                            candidates: [],
                            confirmed: false,
                          })
                        }
                      />
                    ))}
                  </label>
                ))}
              </div>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    recognizeRegions(await fromPhoto(), [selected]),
                  )
                }
              >
                Recognize this crop
              </Button>
              {selected.error && <p>{selected.error}</p>}
              <select
                aria-label="Card match"
                value={selected.selected}
                onChange={(e) =>
                  patch(selected.id, {
                    selected: Number(e.target.value),
                    confirmed: false,
                  })
                }
              >
                {selected.candidates.map((card, index) => (
                  <option key={`${key(card)}:${index}`} value={index}>
                    {card.name} · {card.setName ?? card.setCode} ·{" "}
                    {card.externalId}
                  </option>
                ))}
              </select>
              {selected.candidates[selected.selected]?.printings?.length ? (
                <select
                  aria-label="Exact printing"
                  defaultValue=""
                  onChange={(e) => {
                    const card = selected.candidates[selected.selected]!;
                    const printing = card.printings?.find(
                      (p) => p.externalId === e.target.value,
                    );
                    if (printing)
                      patch(selected.id, {
                        candidates: selected.candidates.map((c, i) =>
                          i === selected.selected
                            ? {
                                ...c,
                                ...printing,
                                requiresPrintingChoice: false,
                                printingResolutionProvenance: "user_selected",
                              }
                            : c,
                        ),
                        confirmed: true,
                      });
                  }}
                >
                  <option value="" disabled>
                    Choose exact printing
                  </option>
                  {selected.candidates[selected.selected]!.printings!.map(
                    (p) => (
                      <option key={p.externalId} value={p.externalId}>
                        {p.setName ?? p.setCode} · {p.externalId}
                      </option>
                    ),
                  )}
                </select>
              ) : null}
              <Button
                disabled={
                  !selected.candidates[selected.selected] ||
                  selected.candidates[selected.selected]?.requiresPrintingChoice
                }
                onClick={() => patch(selected.id, { confirmed: true })}
              >
                Confirm match
              </Button>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const { searchCardsApi } = await import("@/lib/api-client");
                    const cards = await searchCardsApi({
                      query: manualQuery,
                      tcg: filter,
                      token: token ?? undefined,
                    });
                    patch(selected.id, {
                      candidates: cards.map((card) => ({
                        externalId: card.id,
                        tcg: card.tcg,
                        name: card.name,
                        setCode: card.setCode ?? null,
                        setName: card.setName ?? null,
                        rarity: card.rarity ?? null,
                        imageUrl: card.imageUrl ?? null,
                        confidence: 1,
                        distance: 0,
                      })),
                      selected: 0,
                      confirmed: false,
                    });
                  });
                }}
              >
                <input
                  aria-label="Find a replacement card"
                  placeholder="Find a replacement card"
                  value={manualQuery}
                  onChange={(e) => setManualQuery(e.target.value)}
                />
                <Button disabled={busy || !manualQuery.trim()}>Search</Button>
              </form>
            </div>
          )}
          <Button
            disabled={!reviewed.length || busy}
            onClick={() => {
              reviewed
                .filter((region) => !region.saved)
                .forEach((region) => {
                  addToSession(region.candidates[region.selected]!, region.id);
                  patch(region.id, { saved: true });
                });
            }}
          >
            Add {reviewed.filter((region) => !region.saved).length} reviewed
            cards to session
          </Button>
          <label>
            Page number
            <input
              aria-label="Binder page number"
              type="number"
              min={1}
              max={10000}
              value={pageNumber}
              onChange={(e) =>
                setPageNumber(
                  Math.max(1, Math.min(10000, Number(e.target.value) || 1)),
                )
              }
            />
          </label>
          <Button
            disabled={!token || !binderId || busy || !regions.length}
            onClick={() => void run(savePage)}
          >
            Save page &amp; photo
          </Button>
        </>
      )}
      <div className="space-y-2 border-t pt-3">
        <h3 className="font-semibold">Session · {session.length} copies</h3>
        <label>
          Destination binder{" "}
          <select
            aria-label="Scanner destination binder"
            value={binderId}
            onChange={(e) => setBinderId(e.target.value)}
          >
            <option value="">Choose binder</option>
            {binders.map((binder) => (
              <option key={binder.id} value={binder.id}>
                {binder.name}
              </option>
            ))}
          </select>
        </label>
        {savedPages.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <label>
              Saved binder page{" "}
              <select
                aria-label="Saved binder page"
                value={savedPageId}
                onChange={(event) => setSavedPageId(event.target.value)}
              >
                <option value="">Choose a saved page</option>
                {savedPages.map((page) => (
                  <option key={page.id} value={page.id}>
                    Page {page.pageNumber} · revision {page.revision}
                  </option>
                ))}
              </select>
            </label>
            <Button
              disabled={busy || !savedPageId}
              onClick={() => void run(reviewSavedPage)}
            >
              Review saved page
            </Button>
          </div>
        )}
        {!token && (
          <p className="text-sm">
            Recognition and review work locally. Sign in or use the local demo
            to add cards to binders.
          </p>
        )}
        <div className="max-h-80 overflow-auto">
          {session.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-2 border-b py-2"
            >
              <button onClick={() => setDetail(item.card)}>
                {item.card.name} · {item.card.setCode}{" "}
                {item.saved ? "— saved" : ""}
              </button>
              <span>
                {item.price != null
                  ? `${item.currency} ${item.price.toFixed(2)}`
                  : "Price unavailable"}
              </span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  setSession((previous) =>
                    previous.filter((row) => row.id !== item.id),
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
        <p>
          {Object.entries(totals)
            .map(([currency, amount]) => `${currency} ${amount.toFixed(2)}`)
            .join(" · ") || "No session prices yet"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              busy ||
              !token ||
              !binderId ||
              !session.some((item) => !item.saved)
            }
            onClick={() => void run(saveSession)}
          >
            Add session to binder
          </Button>
          <Button
            disabled={busy || !token || !session.length}
            onClick={() =>
              void run(async () => {
                const result = await getTrackedCardPrices(
                  token!,
                  session.map((item) => ({
                    tcg: item.card.tcg,
                    externalId: item.card.externalId,
                  })),
                );
                setSession((previous) =>
                  previous.map((item) => {
                    const quote = result.prices.find(
                      (price) => key(price) === key(item.card),
                    );
                    return quote
                      ? {
                          ...item,
                          price: quote.price ?? undefined,
                          currency: quote.currency ?? undefined,
                        }
                      : item;
                  }),
                );
              })
            }
          >
            Refresh session prices
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Clear the scanner session? Cards already saved in binders are retained.",
                )
              )
                setSession([]);
            }}
          >
            Clear session
          </Button>
          <Button
            variant="outline"
            onClick={() => consensus.current.nextCard()}
          >
            Ready for another copy
          </Button>
        </div>
      </div>
      {detail && (
        <div
          role="dialog"
          aria-label="Scanned card detail"
          className="space-y-2 rounded-lg border p-4"
        >
          <h3 className="font-semibold">{detail.name}</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {detail.imageUrl && (
            <img src={detail.imageUrl} alt={detail.name} className="max-h-80" />
          )}
          <p>
            {detail.tcg} · {detail.setName ?? detail.setCode} ·{" "}
            {detail.externalId} · {detail.rarity}
          </p>
          <Button onClick={() => setDetail(null)}>Close card</Button>
        </div>
      )}
      {developer && (
        <details className="space-y-3 border-t pt-3">
          <summary>Scanner testing tools</summary>
          <div className="flex flex-wrap gap-3">
            <label>
              <input
                type="checkbox"
                checked={recording}
                onChange={(e) => setRecording(e.target.checked)}
              />{" "}
              Record recognition attempts
            </label>
            <label>
              <input
                type="checkbox"
                checked={saveAttemptImages}
                onChange={(e) => setSaveAttemptImages(e.target.checked)}
              />{" "}
              Include every attempt crop
            </label>
            <label>
              <input
                type="checkbox"
                checked={warmStart}
                onChange={(e) => setWarmStart(e.target.checked)}
              />{" "}
              Preload scanner models
            </label>
            <label>
              Analysis interval · {intervalMs} ms
              <input
                type="range"
                min={100}
                max={2000}
                step={100}
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
              />
            </label>
          </div>
          <p>
            {attempts.length} recorded attempts (latest 500) ·{" "}
            {recording ? "recording" : "paused"}. Saving images includes the
            exact corrected crop passed to recognition.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || !attempts.length}
              onClick={() =>
                void run(async () => {
                  const { db, runs } = recordingDatabase();
                  try {
                    await runs.put({
                      id: crypto.randomUUID(),
                      ownerId: draftKey,
                      name: `Scan ${new Date().toLocaleString()}`,
                      createdAt: new Date().toISOString(),
                      attempts,
                    });
                  } finally {
                    db.close();
                  }
                  await loadRuns();
                  setStatus("Recording saved in this browser.");
                })
              }
            >
              Save recorded run
            </Button>
            <Button variant="outline" onClick={() => setAttempts([])}>
              Clear recorded attempts
            </Button>
            <Button variant="outline" onClick={() => void run(loadRuns)}>
              Refresh recorded runs
            </Button>
            <label>
              Import recording
              <input
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file)
                    void run(async () => {
                      const run = {
                        ...importRecordedRun(await file.text()),
                        id: crypto.randomUUID(),
                        ownerId: draftKey,
                      };
                      const { db, runs } = recordingDatabase();
                      try {
                        await runs.put(run);
                      } finally {
                        db.close();
                      }
                      await loadRuns();
                      setSelectedRun(run.id);
                    });
                }}
              />
            </label>
          </div>
          <select
            aria-label="Recorded scanner run"
            value={selectedRun}
            onChange={(e) => setSelectedRun(e.target.value)}
          >
            <option value="">Choose a recorded run</option>
            {runs.map((run) => (
              <option key={run.id} value={run.id}>
                {run.name} · {run.attempts.length} attempts
              </option>
            ))}
          </select>
          {runs.find((run) => run.id === selectedRun) && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    download(
                      await exportRecordedRun(
                        runs.find((run) => run.id === selectedRun)!,
                      ),
                      "tcger-scanner-run.json",
                    ),
                  )
                }
              >
                Export recorded run
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    setRecording(false);
                    setAutomatic(false);
                    const rows = [];
                    for (const attempt of runs.find(
                      (run) => run.id === selectedRun,
                    )!.attempts) {
                      if (!attempt.crop)
                        throw new Error(
                          "This recording has no crop images for replay. Enable attempt images before recording.",
                        );
                      const bitmap = await createImageBitmap(attempt.crop);
                      const crop = document.createElement("canvas");
                      crop.width = bitmap.width;
                      crop.height = bitmap.height;
                      crop.getContext("2d")!.drawImage(bitmap, 0, 0);
                      bitmap.close();
                      const started = performance.now();
                      const result = await recognize(crop);
                      rows.push({
                        expectedId: attempt.expectedId,
                        actualId: result.accepted ? key(result.accepted) : null,
                        elapsedMs: performance.now() - started,
                      });
                    }
                    const report = replaySummary(rows);
                    setReplayReport(
                      `${report.correct}/${report.labeled} labeled attempts correct; ${report.falsePositives} false positives; ${report.misses} misses; mean ${report.meanMs.toFixed(0)} ms, p95 ${report.p95Ms.toFixed(0)} ms. ${report.total - report.labeled} attempts have no expected label.`,
                    );
                  })
                }
              >
                Replay through current engine
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { db, runs } = recordingDatabase();
                    try {
                      await runs.delete(selectedRun);
                    } finally {
                      db.close();
                    }
                    setSelectedRun("");
                    await loadRuns();
                  })
                }
              >
                Delete recorded run
              </Button>
            </div>
          )}
          <p role="status">{replayReport}</p>
          <div className="max-h-64 overflow-auto text-sm">
            {attempts.slice(-30).map((attempt) => (
              <div key={attempt.id} className="border-b py-2">
                {attempt.at} · {attempt.elapsedMs.toFixed(0)} ms ·{" "}
                {attempt.accepted?.name ?? "Abstained"}
                <input
                  aria-label={`Expected ID ${attempt.id}`}
                  placeholder="Expected game:printing ID, or negative"
                  value={
                    attempt.expectedId === null
                      ? "negative"
                      : (attempt.expectedId ?? "")
                  }
                  onChange={(e) =>
                    setAttempts((previous) =>
                      previous.map((item) =>
                        item.id === attempt.id
                          ? {
                              ...item,
                              expectedId:
                                e.target.value === "negative"
                                  ? null
                                  : e.target.value || undefined,
                            }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            onClick={() => {
              setDeveloper(false);
              setRecording(false);
              setDebug(false);
              activations.current = 0;
              localStorage.removeItem("tcger.scanner.developer");
            }}
          >
            Hide developer tools
          </Button>
        </details>
      )}
      <canvas ref={canvas} hidden />
    </section>
  );
}

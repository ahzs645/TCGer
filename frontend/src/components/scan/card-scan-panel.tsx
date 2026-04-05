"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Camera,
  Loader2,
  Sparkles,
  Target,
  Video,
} from "lucide-react";

import { fetchCardByIdApi } from "@/lib/api-client";
import {
  getCardScanDebugCapturesApi,
  getCardScanStatsApi,
  scanCardImageApi,
  updateCardScanDebugCaptureApi,
  type CardScanDebugCaptureSummary,
  type CardScanMatch,
  type CardScanResponse,
  type CardScanStats,
} from "@/lib/api/scan";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn, GAME_LABELS, getCardBackImage } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth";
import { useGameFilterStore } from "@/stores/game-filter";
import type { Card as CardType, TcgCode } from "@/types/card";

type ScanFilter = TcgCode | "all";
type ResolvedCards = Record<string, CardType | null>;
type SelectedFileSource = "file-picker" | "live-camera-frame";

function resultKey(match: Pick<CardScanMatch, "tcg" | "externalId">): string {
  return `${match.tcg}:${match.externalId}`;
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

function confidenceTone(confidence: number): string {
  if (confidence >= 0.9) {
    return "bg-emerald-500/10 text-emerald-700 border-emerald-300";
  }
  if (confidence >= 0.7) {
    return "bg-amber-500/10 text-amber-700 border-amber-300";
  }
  return "bg-rose-500/10 text-rose-700 border-rose-300";
}

function formatQuality(quality?: number): string | null {
  if (quality === undefined || Number.isNaN(quality)) {
    return null;
  }
  return `${Math.round(quality * 100)}%`;
}

function feedbackTone(
  status: CardScanDebugCaptureSummary["feedbackStatus"],
): string {
  switch (status) {
    case "correct":
      return "bg-emerald-500/10 text-emerald-700 border-emerald-300";
    case "incorrect":
      return "bg-rose-500/10 text-rose-700 border-rose-300";
    case "needs_review":
      return "bg-amber-500/10 text-amber-700 border-amber-300";
    default:
      return "bg-slate-500/10 text-slate-700 border-slate-300";
  }
}

function formatFeedbackLabel(
  status: CardScanDebugCaptureSummary["feedbackStatus"],
): string {
  switch (status) {
    case "correct":
      return "Confirmed";
    case "incorrect":
      return "Wrong";
    case "needs_review":
      return "Needs Review";
    default:
      return "Unreviewed";
  }
}

function formatCaptureTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function CardScanPanel() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const liveStreamRef = useRef<MediaStream | null>(null);
  const { token, isAuthenticated } = useAuthStore((state) => ({
    token: state.token,
    isAuthenticated: state.isAuthenticated,
  }));
  const selectedGame = useGameFilterStore((state) => state.selectedGame);
  const [scanFilter, setScanFilter] = useState<ScanFilter>(
    selectedGame === "all" ? "all" : selectedGame,
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFileSource, setSelectedFileSource] =
    useState<SelectedFileSource | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<CardScanStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [result, setResult] = useState<CardScanResponse | null>(null);
  const [resolvedCards, setResolvedCards] = useState<ResolvedCards>({});
  const [scanError, setScanError] = useState<string | null>(null);
  const [debugCaptureError, setDebugCaptureError] = useState<string | null>(
    null,
  );
  const [isScanning, setIsScanning] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isResolvingCards, setIsResolvingCards] = useState(false);
  const [saveDebugCapture, setSaveDebugCapture] = useState(true);
  const [captureNotes, setCaptureNotes] = useState("");
  const [debugCaptures, setDebugCaptures] = useState<
    CardScanDebugCaptureSummary[]
  >([]);
  const [debugCapturesError, setDebugCapturesError] = useState<string | null>(
    null,
  );
  const [isLoadingDebugCaptures, setIsLoadingDebugCaptures] = useState(false);
  const [updatingCaptureId, setUpdatingCaptureId] = useState<string | null>(
    null,
  );
  const [cameraMode, setCameraMode] = useState<"idle" | "starting" | "live">(
    "idle",
  );
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [liveCameraSupported, setLiveCameraSupported] = useState(false);
  const [liveCameraUnavailableReason, setLiveCameraUnavailableReason] =
    useState<string | null>(null);

  useEffect(() => {
    if (selectedGame !== "all") {
      setScanFilter(selectedGame);
    }
  }, [selectedGame]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      if (liveStreamRef.current) {
        liveStreamRef.current.getTracks().forEach((track) => track.stop());
        liveStreamRef.current = null;
      }
    };
  }, [previewUrl]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const hasMediaDevices =
      typeof navigator !== "undefined" &&
      !!navigator.mediaDevices?.getUserMedia;
    const hasSecureContext = window.isSecureContext;

    if (hasMediaDevices && hasSecureContext) {
      setLiveCameraSupported(true);
      setLiveCameraUnavailableReason(null);
      return;
    }

    setLiveCameraSupported(false);
    if (!hasMediaDevices) {
      setLiveCameraUnavailableReason(
        "This browser does not expose a live camera stream. Still-photo capture remains available.",
      );
      return;
    }

    setLiveCameraUnavailableReason(
      "Live camera preview needs HTTPS or localhost. On plain HTTP, use Take Photo / Upload instead.",
    );
  }, []);

  useEffect(() => {
    if (!token || !isAuthenticated) {
      setStats(null);
      setStatsError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingStats(true);
    setStatsError(null);

    getCardScanStatsApi(token)
      .then((nextStats) => {
        if (cancelled) return;
        setStats(nextStats);
      })
      .catch((error) => {
        if (cancelled) return;
        setStatsError(
          error instanceof Error
            ? error.message
            : "Unable to load scan index stats.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingStats(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, isAuthenticated]);

  useEffect(() => {
    if (!token || !isAuthenticated) {
      setDebugCaptures([]);
      setDebugCapturesError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingDebugCaptures(true);
    setDebugCapturesError(null);

    getCardScanDebugCapturesApi({ token, limit: 8 })
      .then((response) => {
        if (cancelled) return;
        setDebugCaptures(response.captures);
      })
      .catch((error) => {
        if (cancelled) return;
        setDebugCapturesError(
          error instanceof Error
            ? error.message
            : "Unable to load saved debug captures.",
        );
      })
      .finally(() => {
        if (cancelled) return;
        setIsLoadingDebugCaptures(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, isAuthenticated]);

  useEffect(() => {
    if (!token || !result?.candidates.length) {
      setResolvedCards({});
      return;
    }

    let cancelled = false;
    setIsResolvingCards(true);

    const uniqueCandidates = Array.from(
      new Map(
        result.candidates.map((candidate) => [resultKey(candidate), candidate]),
      ).values(),
    );

    Promise.all(
      uniqueCandidates.map(async (candidate) => {
        try {
          const card = await fetchCardByIdApi({
            tcg: candidate.tcg,
            cardId: candidate.externalId,
            token,
          });
          return [resultKey(candidate), card] as const;
        } catch {
          return [resultKey(candidate), null] as const;
        }
      }),
    )
      .then((entries) => {
        if (cancelled) return;
        setResolvedCards(Object.fromEntries(entries));
      })
      .finally(() => {
        if (cancelled) return;
        setIsResolvingCards(false);
      });

    return () => {
      cancelled = true;
    };
  }, [result, token]);

  const handleChooseFile = () => {
    inputRef.current?.click();
  };

  const updateSelectedFile = (
    nextFile: File | null,
    source: SelectedFileSource | null = null,
  ) => {
    setSelectedFile(nextFile);
    setSelectedFileSource(source);
    setScanError(null);
    setDebugCaptureError(null);
    setResult(null);
    setResolvedCards({});
    setPreviewUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return nextFile ? URL.createObjectURL(nextFile) : null;
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    if (!nextFile) {
      return;
    }

    updateSelectedFile(nextFile, "file-picker");
  };

  const handleClear = () => {
    stopLiveCamera();
    updateSelectedFile(null, null);
    setCameraError(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const stopLiveCamera = () => {
    if (liveStreamRef.current) {
      liveStreamRef.current.getTracks().forEach((track) => track.stop());
      liveStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraMode("idle");
  };

  const handleStartLiveCamera = async () => {
    if (!liveCameraSupported) {
      return;
    }

    setCameraError(null);
    setCameraMode("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
        },
      });

      if (liveStreamRef.current) {
        liveStreamRef.current.getTracks().forEach((track) => track.stop());
      }

      liveStreamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }

      setCameraMode("live");
    } catch (error) {
      setCameraMode("idle");
      setCameraError(
        error instanceof Error
          ? error.message
          : "Unable to open the camera preview.",
      );
    }
  };

  const handleCaptureFrame = async () => {
    const video = videoRef.current;
    const canvas = captureCanvasRef.current;

    if (
      !video ||
      !canvas ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      setCameraError(
        "The live camera preview is not ready yet. Wait a moment and try again.",
      );
      return;
    }

    const longestSide = Math.max(video.videoWidth, video.videoHeight);
    const scale = longestSide > 1600 ? 1600 / longestSide : 1;

    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));

    const context = canvas.getContext("2d");
    if (!context) {
      setCameraError("Unable to capture a frame from the live preview.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) {
      setCameraError("Unable to encode the captured frame.");
      return;
    }

    const file = new File([blob], `card-scan-${Date.now()}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });

    updateSelectedFile(file, "live-camera-frame");
    stopLiveCamera();
  };

  const handleScan = async () => {
    if (!token || !isAuthenticated) {
      setScanError("Sign in is required before you can scan card photos.");
      return;
    }

    if (!selectedFile) {
      setScanError("Choose a photo or capture one from your camera first.");
      return;
    }

    setIsScanning(true);
    setScanError(null);
    setDebugCaptureError(null);

    try {
      const nextResult = await scanCardImageApi({
        file: selectedFile,
        token,
        tcg: scanFilter,
        saveDebugCapture,
        captureSource: selectedFileSource ?? "file-picker",
        captureNotes,
      });
      setResult(nextResult);
      setDebugCaptureError(nextResult.debugCaptureError ?? null);

      if (nextResult.debugCapture) {
        setDebugCaptures((previous) => {
          const nextItems = [
            nextResult.debugCapture!,
            ...previous.filter(
              (capture) => capture.id !== nextResult.debugCapture!.id,
            ),
          ];
          return nextItems.slice(0, 8);
        });
      }

      const nextStats = await getCardScanStatsApi(token).catch(() => null);
      if (nextStats) {
        setStats(nextStats);
      }
    } catch (error) {
      setResult(null);
      setResolvedCards({});
      setScanError(error instanceof Error ? error.message : "Scanning failed.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleCaptureFeedback = async (
    captureId: string,
    feedbackStatus: CardScanDebugCaptureSummary["feedbackStatus"],
  ) => {
    if (!token) {
      return;
    }

    setUpdatingCaptureId(captureId);
    setDebugCapturesError(null);

    try {
      const response = await updateCardScanDebugCaptureApi({
        captureId,
        token,
        feedbackStatus,
      });

      setDebugCaptures((previous) =>
        previous.map((capture) =>
          capture.id === response.capture.id ? response.capture : capture,
        ),
      );
    } catch (error) {
      setDebugCapturesError(
        error instanceof Error
          ? error.message
          : "Unable to update debug capture feedback.",
      );
    } finally {
      setUpdatingCaptureId(null);
    }
  };

  const bestMatch = result?.match ?? null;
  const bestMatchCard = bestMatch ? resolvedCards[resultKey(bestMatch)] : null;
  const scanMeta = result?.meta ?? null;
  const otherCandidates =
    result?.candidates.filter((candidate) => {
      if (!bestMatch) {
        return true;
      }
      return resultKey(candidate) !== resultKey(bestMatch);
    }) ?? [];

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
      <Card className="overflow-hidden border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="h-5 w-5" />
            Scan Input
          </CardTitle>
          <CardDescription>
            Upload a card photo or open your phone camera. The server compares
            the image against the cached perceptual hash index.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handleFileChange}
          />
          <canvas ref={captureCanvasRef} className="hidden" />

          <div className="overflow-hidden rounded-xl border bg-muted/40">
            {cameraMode === "live" ? (
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                className="h-72 w-full bg-black object-cover"
              />
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="Selected card preview"
                className="h-72 w-full object-contain bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_rgba(244,244,245,0.6)_55%,_rgba(228,228,231,0.9))] p-4"
              />
            ) : (
              <div className="flex h-72 flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.9),_rgba(244,244,245,0.6)_55%,_rgba(228,228,231,0.9))] p-6 text-center">
                <Camera className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium">No photo selected</p>
                  <p className="text-sm text-muted-foreground">
                    Use a straight-on shot with the full card in frame for the
                    best first-pass match.
                  </p>
                </div>
              </div>
            )}
          </div>

          {(liveCameraUnavailableReason || cameraError) && (
            <div className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-950">
              {cameraError ?? liveCameraUnavailableReason}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Scan Scope</label>
            <Select
              value={scanFilter}
              onValueChange={(value) => setScanFilter(value as ScanFilter)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Auto-detect game" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  Auto-detect across all games
                </SelectItem>
                <SelectItem value="yugioh">{GAME_LABELS.yugioh}</SelectItem>
                <SelectItem value="magic">{GAME_LABELS.magic}</SelectItem>
                <SelectItem value="pokemon">{GAME_LABELS.pokemon}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <Label
                  htmlFor="save-debug-capture"
                  className="text-sm font-medium"
                >
                  Save Debug Capture
                </Label>
                <p className="text-sm text-muted-foreground">
                  Store the uploaded image, server guess, candidates, and scan
                  metadata so you can build a training/debug dataset from your
                  phone.
                </p>
              </div>
              <Switch
                id="save-debug-capture"
                checked={saveDebugCapture}
                onCheckedChange={setSaveDebugCapture}
              />
            </div>

            {saveDebugCapture ? (
              <div className="space-y-2">
                <Label
                  htmlFor="capture-notes"
                  className="text-xs uppercase tracking-wide text-muted-foreground"
                >
                  Notes
                </Label>
                <Textarea
                  id="capture-notes"
                  value={captureNotes}
                  onChange={(event) => setCaptureNotes(event.target.value)}
                  placeholder="Optional context, such as video timestamp, lighting issue, or why this sample is interesting."
                  rows={3}
                />
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={handleChooseFile} className="gap-2">
              <Camera className="h-4 w-4" />
              Take Photo / Upload
            </Button>
            {cameraMode === "live" ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleCaptureFrame}
                  className="gap-2"
                >
                  <Target className="h-4 w-4" />
                  Capture Frame
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={stopLiveCamera}
                >
                  Stop Camera
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="secondary"
                onClick={handleStartLiveCamera}
                disabled={!liveCameraSupported || cameraMode === "starting"}
                className="gap-2"
              >
                {cameraMode === "starting" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Video className="h-4 w-4" />
                )}
                Live Camera
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={handleScan}
              disabled={isScanning || !selectedFile}
            >
              {isScanning ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Target className="h-4 w-4" />
              )}
              Scan Card
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={handleClear}
              disabled={!selectedFile && !result}
            >
              Reset
            </Button>
          </div>

          {selectedFile && (
            <div className="rounded-lg border bg-background px-3 py-2 text-sm">
              <p className="font-medium">{selectedFile.name}</p>
              <p className="text-muted-foreground">
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            </div>
          )}

          <div className="rounded-xl border bg-muted/30 p-4 text-sm">
            <p className="font-medium">Phone Testing Notes</p>
            <p className="mt-1 text-muted-foreground">
              Still-photo capture works on the current HTTP test stack. Live
              browser camera preview only becomes available on HTTPS or
              localhost because mobile browsers require a secure context for
              streaming camera access.
            </p>
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Hash Index</p>
                <p className="text-xs text-muted-foreground">
                  Current server-side scan corpus
                </p>
              </div>
              {isLoadingStats && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>
            {stats ? (
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">Magic {stats.magic}</Badge>
                <Badge variant="outline">Pokémon {stats.pokemon}</Badge>
                <Badge variant="outline">Yu-Gi-Oh! {stats.yugioh}</Badge>
                <Badge variant="secondary">Store {stats.storeMode}</Badge>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {statsError ?? "Scan stats will load after sign-in."}
              </p>
            )}
          </div>

          <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Recent Debug Captures</p>
                <p className="text-xs text-muted-foreground">
                  Latest saved samples from this account
                </p>
              </div>
              {isLoadingDebugCaptures && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
            </div>

            {debugCaptures.length ? (
              <div className="space-y-3">
                {debugCaptures.map((capture) => (
                  <div
                    key={capture.id}
                    className="flex gap-3 rounded-lg border bg-background p-3"
                  >
                    <img
                      src={capture.sourceImageUrl}
                      alt={capture.bestMatch?.name ?? "Saved scan capture"}
                      className="h-20 w-16 shrink-0 rounded-md border object-cover"
                    />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className={cn(
                            "border",
                            feedbackTone(capture.feedbackStatus),
                          )}
                        >
                          {formatFeedbackLabel(capture.feedbackStatus)}
                        </Badge>
                        {capture.bestMatch?.confidence !== null &&
                        capture.bestMatch?.confidence !== undefined ? (
                          <Badge variant="outline">
                            {formatConfidence(capture.bestMatch.confidence)}
                          </Badge>
                        ) : null}
                      </div>
                      <div>
                        <p className="truncate text-sm font-medium">
                          {capture.bestMatch?.name ?? "No best match"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {capture.bestMatch?.tcg
                            ? GAME_LABELS[capture.bestMatch.tcg]
                            : "Unknown game"}
                          {capture.bestMatch?.distance !== null &&
                          capture.bestMatch?.distance !== undefined
                            ? ` • Distance ${capture.bestMatch.distance}`
                            : ""}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatCaptureTime(capture.createdAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={updatingCaptureId === capture.id}
                          onClick={() =>
                            handleCaptureFeedback(capture.id, "correct")
                          }
                        >
                          Correct
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={updatingCaptureId === capture.id}
                          onClick={() =>
                            handleCaptureFeedback(capture.id, "incorrect")
                          }
                        >
                          Wrong
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={updatingCaptureId === capture.id}
                          onClick={() =>
                            handleCaptureFeedback(capture.id, "unreviewed")
                          }
                        >
                          Reset
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {debugCapturesError ??
                  "Turn on Save Debug Capture and run a scan to start collecting samples."}
              </p>
            )}
          </div>

          {debugCapturesError && debugCaptures.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {debugCapturesError}
            </div>
          )}

          {(scanError || !isAuthenticated) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {scanError ?? "Sign in to upload and scan card photos."}
            </div>
          )}

          {debugCaptureError && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {debugCaptureError}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Scan Results
          </CardTitle>
          <CardDescription>
            Best match first, followed by alternate candidates ranked by
            perceptual-hash distance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 p-6">
          {!result && !isScanning ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
              <div className="space-y-3">
                <Target className="mx-auto h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium">Ready to scan</p>
                  <p className="max-w-xl text-sm text-muted-foreground">
                    Upload a phone photo, screenshot, or cropped card image and
                    the matcher will compare it against the local hash map.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {isScanning ? (
            <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-muted/20 p-8 text-center">
              <div className="space-y-3">
                <Loader2 className="mx-auto h-10 w-10 animate-spin text-muted-foreground" />
                <div className="space-y-1">
                  <p className="font-medium">Computing match candidates</p>
                  <p className="text-sm text-muted-foreground">
                    Preprocessing the upload, hashing it, and scoring it against
                    the cached index.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {!isScanning && result && bestMatch && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={cn("border", confidenceTone(bestMatch.confidence))}
                >
                  {formatConfidence(bestMatch.confidence)} confidence
                </Badge>
                <Badge variant="outline">{GAME_LABELS[bestMatch.tcg]}</Badge>
                <Badge variant="outline">Distance {bestMatch.distance}</Badge>
                {scanMeta?.perspectiveCorrected ? (
                  <Badge variant="secondary">Perspective corrected</Badge>
                ) : null}
                {formatQuality(scanMeta?.quality) ? (
                  <Badge variant="secondary">
                    Quality {formatQuality(scanMeta?.quality)}
                  </Badge>
                ) : null}
                {isResolvingCards && (
                  <Badge variant="secondary">Refreshing card details…</Badge>
                )}
              </div>

              <div className="grid gap-4 rounded-2xl border bg-muted/20 p-4 lg:grid-cols-[220px_1fr]">
                <div className="overflow-hidden rounded-xl border bg-background">
                  <img
                    src={
                      bestMatchCard?.imageUrlSmall ??
                      bestMatchCard?.imageUrl ??
                      getCardBackImage(bestMatch.tcg)
                    }
                    alt={bestMatch.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">
                      Best Match
                    </p>
                    <h2 className="text-2xl font-heading font-semibold">
                      {bestMatchCard?.name ?? bestMatch.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {bestMatchCard?.setName ??
                        bestMatch.setName ??
                        bestMatch.setCode ??
                        "Set unknown"}
                      {bestMatch.rarity ? ` • ${bestMatch.rarity}` : ""}
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ScanFact label="Card ID" value={bestMatch.externalId} />
                    <ScanFact label="Game" value={GAME_LABELS[bestMatch.tcg]} />
                    <ScanFact
                      label="Set Code"
                      value={bestMatch.setCode ?? "N/A"}
                    />
                    <ScanFact
                      label="Confidence"
                      value={formatConfidence(bestMatch.confidence)}
                    />
                    {scanMeta?.variantUsed ? (
                      <ScanFact
                        label="Scan Variant"
                        value={scanMeta.variantUsed}
                      />
                    ) : null}
                    {scanMeta?.thresholdUsed ? (
                      <ScanFact
                        label="Threshold"
                        value={String(scanMeta.thresholdUsed)}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          )}

          {!isScanning && result && !bestMatch && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <div className="flex items-start gap-3">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                <div>
                  <p className="font-medium">No confident match yet</p>
                  <p className="mt-1 text-sm">
                    The current upload did not land under the confidence
                    threshold. Try a tighter crop, flatter angle, or choose a
                    specific game before rescanning.
                  </p>
                </div>
              </div>
            </div>
          )}

          {!isScanning && otherCandidates.length > 0 && (
            <section className="space-y-3">
              <div>
                <h3 className="text-lg font-heading font-semibold">
                  Alternate Candidates
                </h3>
                <p className="text-sm text-muted-foreground">
                  Useful when the top match is close but not definitive.
                </p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                {otherCandidates.map((candidate) => {
                  const candidateCard = resolvedCards[resultKey(candidate)];
                  const imageSrc =
                    candidateCard?.imageUrlSmall ??
                    candidateCard?.imageUrl ??
                    getCardBackImage(candidate.tcg);

                  return (
                    <div
                      key={resultKey(candidate)}
                      className="flex gap-4 rounded-xl border bg-background p-3"
                    >
                      <div className="h-32 w-24 shrink-0 overflow-hidden rounded-lg border bg-muted/30">
                        <img
                          src={imageSrc}
                          alt={candidate.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">
                            {GAME_LABELS[candidate.tcg]}
                          </Badge>
                          <Badge
                            className={cn(
                              "border",
                              confidenceTone(candidate.confidence),
                            )}
                          >
                            {formatConfidence(candidate.confidence)}
                          </Badge>
                        </div>
                        <div>
                          <p className="truncate font-semibold">
                            {candidateCard?.name ?? candidate.name}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {candidateCard?.setName ??
                              candidate.setName ??
                              candidate.setCode ??
                              "Set unknown"}
                          </p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Distance {candidate.distance}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ScanFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}
